/**
 * P2P UDP tunnel with hole-punching.
 *
 * Binary packet format over direct UDP:
 *   [1 byte op] [4 bytes conn_id LE] [data...]
 *
 * Op codes:
 *   0x01 PING        – keepalive / hole-punch probe
 *   0x02 PONG        – reply to PING
 *   0x03 OPEN        – guest opened a new TCP connection id
 *   0x04 DATA        – game data payload
 *   0x05 CLOSE       – connection closed
 *   0x06 CLOSE_ALL   – all connections for this peer closed
 *
 * Flow:
 *  1. Both sides open a UDP socket and do UDP discovery to learn their
 *     external IP:port (server echoes it back).
 *  2. Relay server exchanges external endpoints via WebSocket P2P_CONNECT.
 *  3. Both sides send PING bursts simultaneously → NAT holes open.
 *  4. First PONG received = P2P active.  Game traffic flows over UDP.
 *  5. If no PONG within P2P_TIMEOUT_MS → fall back to WebSocket relay.
 *  6. Keepalive PINGs maintain the NAT hole.
 */
import * as dgram from 'dgram';
import * as net from 'net';
import type { TunnelMessage, TunnelOp } from './ws-relay-client';

// ── Constants ─────────────────────────────────────────────────────────────────
const OP_PING      = 0x01;
const OP_PONG      = 0x02;
const OP_OPEN      = 0x03;
const OP_DATA      = 0x04;
const OP_CLOSE     = 0x05;
const OP_CLOSE_ALL = 0x06;

const PUNCH_INTERVAL_MS  = 200;   // send a PING every 200ms during punching
const PUNCH_DURATION_MS  = 5000;  // try for 5 seconds
const KEEPALIVE_MS       = 3000;  // send a PING every 3s once connected
const PEER_TIMEOUT_MS    = 10000; // 10s without PONG → fall back to relay
const MAX_PAYLOAD        = 65000; // max UDP payload bytes

// ── Types ─────────────────────────────────────────────────────────────────────
export interface P2POptions {
  serverIp: string;
  serverPort: number;
  jwtToken: string;
  onReady: (externalIp: string, externalPort: number) => void;
  onTunnel: (peerId: number, msg: TunnelMessage) => void;
  onPeerConnected: (peerId: number) => void;
  onPeerFailed: (peerId: number) => void;
}

interface PeerState {
  userId: number;
  ip: string;
  port: number;
  connected: boolean;
  punchTimer: NodeJS.Timeout | null;
  keepaliveTimer: NodeJS.Timeout | null;
  failTimer: NodeJS.Timeout | null;
  lastPongAt: number;
}

// ── P2PTunnel class ───────────────────────────────────────────────────────────
export class P2PTunnel {
  private socket: dgram.Socket | null = null;
  private peers = new Map<number, PeerState>();
  // key: "ip:port" → userId (for routing incoming packets)
  private peerByAddr = new Map<string, number>();
  private externalIp = '';
  private externalPort = 0;
  private discoveryTimer: NodeJS.Timeout | null = null;

  constructor(private options: P2POptions) {}

  // ── Public API ──────────────────────────────────────────────────────────────

  /** Open UDP socket and discover external endpoint via server. */
  start(): void {
    if (this.socket) return;
    const sock = dgram.createSocket('udp4');
    this.socket = sock;

    sock.on('error', (err) => console.error('[P2P] UDP error:', err.message));
    sock.on('message', (msg, rinfo) => this.handlePacket(msg, rinfo));

    sock.bind(0, '0.0.0.0', () => {
      const localPort = (sock.address() as net.AddressInfo).port;
      console.log(`[P2P] UDP socket bound on port ${localPort}`);
      this.sendDiscovery();
    });
  }

  /** Stop everything and close the UDP socket. */
  stop(): void {
    if (this.discoveryTimer) { clearTimeout(this.discoveryTimer); this.discoveryTimer = null; }
    for (const peer of this.peers.values()) this.clearPeerTimers(peer);
    this.peers.clear();
    this.peerByAddr.clear();
    const sock = this.socket;
    this.socket = null;
    if (sock) { try { sock.close(); } catch { /* ignore */ } }
  }

  /** Register a peer endpoint received from relay server via P2P_CONNECT. */
  connectToPeer(userId: number, ip: string, port: number): void {
    if (this.peers.has(userId)) {
      // Already connecting/connected — update endpoint
      const peer = this.peers.get(userId)!;
      this.peerByAddr.delete(`${peer.ip}:${peer.port}`);
      peer.ip = ip;
      peer.port = port;
      this.peerByAddr.set(`${ip}:${port}`, userId);
      return;
    }
    console.log(`[P2P] Starting hole-punch to peer ${userId} @ ${ip}:${port}`);
    const peer: PeerState = {
      userId, ip, port,
      connected: false,
      punchTimer: null, keepaliveTimer: null, failTimer: null,
      lastPongAt: 0,
    };
    this.peers.set(userId, peer);
    this.peerByAddr.set(`${ip}:${port}`, userId);
    this.startPunching(peer);
  }

  /** Remove a peer (e.g. they left the room). */
  removePeer(userId: number): void {
    const peer = this.peers.get(userId);
    if (!peer) return;
    this.clearPeerTimers(peer);
    this.peerByAddr.delete(`${peer.ip}:${peer.port}`);
    this.peers.delete(userId);
  }

  /** Is the P2P connection to this peer active? */
  isP2PActive(userId: number): boolean {
    const peer = this.peers.get(userId);
    return !!peer?.connected;
  }

  /** Send a tunnel message to a peer over direct UDP. */
  sendTunnel(peerId: number, msg: TunnelMessage): void {
    const peer = this.peers.get(peerId);
    if (!peer?.connected || !this.socket) return;

    let opCode: number;
    switch (msg.op) {
      case 'open':      opCode = OP_OPEN;      break;
      case 'data':      opCode = OP_DATA;      break;
      case 'close':     opCode = OP_CLOSE;     break;
      case 'close_all': opCode = OP_CLOSE_ALL; break;
      default: return;
    }

    const connBuf = Buffer.allocUnsafe(4);
    connBuf.writeUInt32LE(msg.conn, 0);
    const payload = msg.data ?? Buffer.alloc(0);

    const packet = Buffer.concat([Buffer.from([opCode]), connBuf, payload]);
    if (packet.length > MAX_PAYLOAD) {
      console.warn(`[P2P] Dropping oversized packet (${packet.length} bytes) to peer ${peerId}`);
      return;
    }
    this.socket.send(packet, peer.port, peer.ip);
  }

  /** Local port of the UDP socket (to register with relay). */
  get localPort(): number {
    if (!this.socket) return 0;
    const addr = this.socket.address() as net.AddressInfo;
    return addr.port || 0;
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  private sendDiscovery(): void {
    if (!this.socket) return;
    const pkt = Buffer.from(JSON.stringify({ token: this.options.jwtToken }));
    this.socket.send(pkt, this.options.serverPort, this.options.serverIp);
    // Retry every 2s until we get an ack
    this.discoveryTimer = setTimeout(() => {
      this.discoveryTimer = null;
      if (!this.externalIp) this.sendDiscovery();
    }, 2000);
  }

  private startPunching(peer: PeerState): void {
    // Send a burst of PINGs to open the NAT hole
    let attempts = 0;
    const maxAttempts = Math.ceil(PUNCH_DURATION_MS / PUNCH_INTERVAL_MS);
    peer.punchTimer = setInterval(() => {
      if (!this.socket || peer.connected) {
        this.clearTimer(peer, 'punch');
        return;
      }
      this.sendPing(peer);
      attempts++;
      if (attempts >= maxAttempts) {
        this.clearTimer(peer, 'punch');
        if (!peer.connected) {
          console.warn(`[P2P] Hole-punch to peer ${peer.userId} timed out — falling back to relay`);
          this.options.onPeerFailed(peer.userId);
        }
      }
    }, PUNCH_INTERVAL_MS);
  }

  private sendPing(peer: PeerState): void {
    if (!this.socket) return;
    // PING: [0x01][4 bytes zero conn]
    const pkt = Buffer.from([OP_PING, 0, 0, 0, 0]);
    this.socket.send(pkt, peer.port, peer.ip);
  }

  private sendPong(ip: string, port: number): void {
    if (!this.socket) return;
    const pkt = Buffer.from([OP_PONG, 0, 0, 0, 0]);
    this.socket.send(pkt, port, ip);
  }

  private handlePacket(msg: Buffer, rinfo: dgram.RemoteInfo): void {
    // ── Server UDP discovery ack ──
    if (msg[0] === 0x7b) { // '{' — JSON
      try {
        const pkt = JSON.parse(msg.toString('utf8'));
        if (pkt.type === 'p2p_udp_ack' && typeof pkt.ip === 'string' && typeof pkt.port === 'number') {
          if (!this.externalIp) {
            this.externalIp = pkt.ip;
            this.externalPort = pkt.port;
            if (this.discoveryTimer) { clearTimeout(this.discoveryTimer); this.discoveryTimer = null; }
            console.log(`[P2P] External endpoint discovered: ${this.externalIp}:${this.externalPort}`);
            this.options.onReady(this.externalIp, this.externalPort);
          }
        }
      } catch { /* ignore */ }
      return;
    }

    if (msg.length < 5) return; // need at least op + conn_id
    const op = msg[0];
    const addr = `${rinfo.address}:${rinfo.port}`;
    const userId = this.peerByAddr.get(addr);
    if (userId === undefined) return; // unknown peer

    const peer = this.peers.get(userId);
    if (!peer) return;

    if (op === OP_PING) {
      this.sendPong(rinfo.address, rinfo.port);
      this.onPeerActivity(peer);
      return;
    }

    if (op === OP_PONG) {
      this.onPeerActivity(peer);
      return;
    }

    // Tunnel data
    const connId = msg.readUInt32LE(1);
    const data = msg.length > 5 ? msg.slice(5) : undefined;

    let tunnelOp: TunnelOp;
    switch (op) {
      case OP_OPEN:      tunnelOp = 'open';      break;
      case OP_DATA:      tunnelOp = 'data';      break;
      case OP_CLOSE:     tunnelOp = 'close';     break;
      case OP_CLOSE_ALL: tunnelOp = 'close_all'; break;
      default: return;
    }

    this.options.onTunnel(userId, { conn: connId, op: tunnelOp, data });
  }

  private onPeerActivity(peer: PeerState): void {
    peer.lastPongAt = Date.now();
    if (!peer.connected) {
      peer.connected = true;
      this.clearTimer(peer, 'punch');
      console.log(`[P2P] Direct connection established with peer ${peer.userId}`);
      this.options.onPeerConnected(peer.userId);
      this.startKeepalive(peer);
      this.startFailTimer(peer);
    } else {
      // Reset the fail timer on each received packet
      this.clearTimer(peer, 'fail');
      this.startFailTimer(peer);
    }
  }

  private startKeepalive(peer: PeerState): void {
    peer.keepaliveTimer = setInterval(() => {
      if (!peer.connected) { this.clearTimer(peer, 'keepalive'); return; }
      this.sendPing(peer);
    }, KEEPALIVE_MS);
  }

  private startFailTimer(peer: PeerState): void {
    peer.failTimer = setTimeout(() => {
      if (Date.now() - peer.lastPongAt >= PEER_TIMEOUT_MS) {
        console.warn(`[P2P] Peer ${peer.userId} timed out — falling back to relay`);
        peer.connected = false;
        this.clearTimer(peer, 'keepalive');
        this.options.onPeerFailed(peer.userId);
      }
    }, PEER_TIMEOUT_MS);
  }

  private clearTimer(peer: PeerState, which: 'punch' | 'keepalive' | 'fail'): void {
    const key = `${which}Timer` as keyof PeerState;
    const t = peer[key] as NodeJS.Timeout | null;
    if (t) { clearInterval(t); clearTimeout(t); (peer as any)[key] = null; }
  }

  private clearPeerTimers(peer: PeerState): void {
    this.clearTimer(peer, 'punch');
    this.clearTimer(peer, 'keepalive');
    this.clearTimer(peer, 'fail');
  }
}
