import { WebSocket } from 'ws';
import { WSMessageType } from '../types.js';
import { parseGameInfo } from './protocol';

export const WS_PROTOCOL_VERSION = 1;
export type TunnelOp = 'open' | 'data' | 'close' | 'close_all';
export interface TunnelMessage {
  from?: number;
  to?: number;
  conn: number;
  op: TunnelOp;
  data?: Buffer;
}

export interface WSClientOptions {
  serverUrl: string;
  token: string;
  onConnected: () => void;
  onDisconnected: () => void;
  onReconnectExpired?: () => void;
  onRoomCreated: (roomId: string, room: any) => void;
  onRoomJoined: (roomId: string, room: any, gameInfo: Buffer | null) => void;
  onRoomRestored?: (roomId: string, room: any, gameInfo: Buffer | null) => void;
  onRoomClosed: () => void;
  onRoomList: (rooms: any[]) => void;
  onGameInfo: (gameInfo: Buffer) => void;
  onGameInfoLost?: () => void;
  onGameEnded?: () => void;
  onChatMessage?: (msg: { userId: number; username: string; text: string; ts: number }) => void;
  onChatHistory?: (messages: Array<{ userId: number; username: string; text: string; ts: number }>) => void;
  onRoomUpdate?: (action: string, userId: number, username: string) => void;
  onRelayState?: (state: 'paused' | 'resumed', payload: any) => void;
  onPingResult?: (rtt: number) => void;
  onTunnel: (msg: TunnelMessage) => void;
  onError: (error: string) => void;
}

// Binary tunnel frame: [1 op][4 conn LE][4 userId LE][data?]
const BIN_OP: Record<TunnelOp, number> = { open: 1, data: 2, close: 3, close_all: 4 };
const BIN_OP_TO_STR: Record<number, TunnelOp> = { 1: 'open', 2: 'data', 3: 'close', 4: 'close_all' };
const BIN_HEADER = 9;
const MAX_QUEUED_TUNNEL_BYTES = 8 * 1024 * 1024;

export class WSRelayClient {
  private ws: WebSocket | null = null;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private reconnectGraceTimeout: NodeJS.Timeout | null = null;
  private isConnecting = false;
  private stopped = false;
  private authenticated = false;
  private currentRoomId: string | null = null;
  private pendingLeave = false;
  private relayPaused = false;
  private tunnelQueue: Buffer[] = [];
  private queuedTunnelBytes = 0;
  private reportedUnknownTypes = new Set<string>();
  private pingTimestamp: number | null = null;

  constructor(private options: WSClientOptions) {}

  connect(): void {
    if (this.ws || this.isConnecting || this.stopped) return;
    this.isConnecting = true;
    console.log(`[WS] connecting to ${this.options.serverUrl}`);
    const ws = new WebSocket(this.options.serverUrl, { perMessageDeflate: false } as any);
    this.ws = ws;

    ws.on('open', () => {
      this.isConnecting = false;
      this.sendRaw({ type: WSMessageType.AUTH, payload: { token: this.options.token } });
    });

    ws.on('message', (data: Buffer | ArrayBuffer | Buffer[], isBinary: boolean) => {
      try {
        const raw = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as any);
        if (isBinary) {
          this.handleBinaryMessage(raw);
          return;
        }
        const message = JSON.parse(raw.toString('utf8'));
        if (!message || typeof message !== 'object' || typeof message.type !== 'string') {
          throw new Error('Malformed server message');
        }
        this.handleMessage(message);
      } catch (err) {
        console.error('[WS] rejected server message:', err);
        this.options.onError(err instanceof Error ? err.message : 'Invalid server message');
      }
    });

    ws.on('close', (code: number) => {
      this.isConnecting = false;
      this.authenticated = false;
      if (this.ws === ws) this.ws = null;
      if (code === 4001) {
        this.stopped = true;
        this.currentRoomId = null;
        if (this.reconnectGraceTimeout) clearTimeout(this.reconnectGraceTimeout);
        this.reconnectGraceTimeout = null;
        this.options.onError('This account is connected from another connector instance');
        return;
      }
      if (this.stopped) return;
      if (this.currentRoomId && !this.reconnectGraceTimeout) {
        this.reconnectGraceTimeout = setTimeout(() => {
          this.reconnectGraceTimeout = null;
          if (!this.authenticated && this.currentRoomId) {
            this.currentRoomId = null;
            this.relayPaused = false;
            this.tunnelQueue = [];
            this.queuedTunnelBytes = 0;
            this.options.onReconnectExpired?.();
          }
        }, 180_000);
      }
      // Keep currentRoomId and local TCP sockets: the server retains the room for 180s.
      this.options.onDisconnected();
      this.scheduleReconnect();
    });

    ws.on('error', (err) => {
      console.error('[WS] error:', err.message);
      this.isConnecting = false;
    });
  }

  disconnect(): void {
    this.stopped = true;
    this.authenticated = false;
    if (this.reconnectGraceTimeout) clearTimeout(this.reconnectGraceTimeout);
    this.reconnectGraceTimeout = null;
    if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
    this.reconnectTimeout = null;
    const ws = this.ws;
    this.ws = null;
    this.currentRoomId = null;
    this.pendingLeave = false;
    this.relayPaused = false;
    this.tunnelQueue = [];
    this.queuedTunnelBytes = 0;
    ws?.close(1000, 'client logout');
  }

  createRoom(name: string, map: string, maxPlayers = 12): boolean {
    return this.send({ type: WSMessageType.CREATE_ROOM, payload: { name, map, maxPlayers } });
  }

  joinRoom(roomId: string): boolean {
    return this.send({ type: WSMessageType.JOIN_ROOM, payload: { roomId } });
  }

  leaveRoom(): void {
    if (!this.currentRoomId) return;
    if (this.send({ type: WSMessageType.LEAVE_ROOM, payload: {} })) {
      this.currentRoomId = null;
      this.pendingLeave = false;
      this.relayPaused = false;
      this.tunnelQueue = [];
      this.queuedTunnelBytes = 0;
    } else {
      // The user explicitly left while offline. Complete the leave after auth/room restore.
      this.pendingLeave = true;
      this.relayPaused = false;
      this.tunnelQueue = [];
      this.queuedTunnelBytes = 0;
    }
  }

  requestRoomList(): void {
    this.send({ type: WSMessageType.ROOM_LIST, payload: {} });
  }

  sendGameInfo(packet: Buffer): void {
    this.send({ type: WSMessageType.ROOM_GAMEINFO, payload: { data: packet.toString('base64') } });
  }

  sendGameInfoLost(): void {
    this.send({ type: WSMessageType.ROOM_GAMEINFO_LOST, payload: {} });
  }

  sendGameEnded(): void {
    this.send({ type: WSMessageType.GAME_ENDED, payload: {} });
  }

  sendChatMessage(text: string): void {
    this.send({ type: WSMessageType.CHAT_MESSAGE, payload: { text } });
  }

  sendPing(): void {
    this.pingTimestamp = Date.now();
    this.send({ type: WSMessageType.PING, payload: { ts: this.pingTimestamp } });
  }

  sendTunnel(msg: TunnelMessage): void {
    const frame = this.buildBinaryFrame(msg);
    const size = frame.length;
    if (this.relayPaused || !this.authenticated || !this.sendBinaryFrame(frame)) {
      if (this.queuedTunnelBytes + size > MAX_QUEUED_TUNNEL_BYTES) {
        this.options.onError('Relay reconnect buffer is full; a game connection may be lost');
        return;
      }
      this.tunnelQueue.push(frame);
      this.queuedTunnelBytes += size;
    }
  }

  isConnected(): boolean {
    return this.authenticated && this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  private buildBinaryFrame(msg: TunnelMessage): Buffer {
    const op = BIN_OP[msg.op];
    const header = Buffer.allocUnsafe(BIN_HEADER);
    header[0] = op;
    header.writeUInt32LE(msg.conn, 1);
    header.writeUInt32LE(msg.to ?? msg.from ?? 0, 5);
    return msg.data ? Buffer.concat([header, msg.data]) : header;
  }

  private sendBinaryFrame(frame: Buffer): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(frame);
    return true;
  }

  private handleBinaryMessage(buf: Buffer): void {
    if (buf.length < BIN_HEADER) return;
    const op = buf[0];
    const tunnelOp = BIN_OP_TO_STR[op];
    if (!tunnelOp) return;
    const conn = buf.readUInt32LE(1);
    const userId = buf.readUInt32LE(5);
    const data = buf.length > BIN_HEADER ? buf.subarray(BIN_HEADER) : undefined;
    this.options.onTunnel({
      from: userId || undefined,
      conn,
      op: tunnelOp,
      data,
    });
  }

  private sendRaw(message: Record<string, unknown>): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify({ ...message, protocolVersion: WS_PROTOCOL_VERSION }));
    return true;
  }

  private send(message: Record<string, unknown>): boolean {
    if (!this.authenticated) return false;
    return this.sendRaw(message);
  }

  private flushTunnelQueue(): void {
    if (!this.authenticated || this.relayPaused) return;
    const pending = this.tunnelQueue;
    this.tunnelQueue = [];
    this.queuedTunnelBytes = 0;
    for (let i = 0; i < pending.length; i++) {
      if (!this.sendBinaryFrame(pending[i])) {
        const remainder = pending.slice(i);
        this.tunnelQueue.push(...remainder);
        this.queuedTunnelBytes += remainder.reduce((sum, f) => sum + f.length, 0);
        break;
      }
    }
  }

  private decodeBase64(value: unknown, maxEncodedLength: number): Buffer | null {
    if (typeof value !== 'string' || value.length > maxEncodedLength || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) return null;
    const packet = Buffer.from(value, 'base64');
    return packet.length > 0 ? packet : null;
  }

  private handleMessage(message: any): void {
    const { type, payload } = message;
    switch (type) {
      case WSMessageType.AUTH_SUCCESS:
        this.authenticated = true;
        if (this.reconnectGraceTimeout) clearTimeout(this.reconnectGraceTimeout);
        this.reconnectGraceTimeout = null;
        this.options.onConnected();
        this.requestRoomList();
        break;
      case WSMessageType.AUTH_ERROR:
        this.options.onError(payload?.error || 'Authentication failed');
        this.disconnect();
        break;
      case WSMessageType.ROOM_CREATED:
        if (typeof payload?.id !== 'string') return;
        this.currentRoomId = payload.id;
        this.options.onRoomCreated(payload.id, payload);
        break;
      case WSMessageType.ROOM_JOINED: {
        if (typeof payload?.id !== 'string') return;
        this.currentRoomId = payload.id;
        this.relayPaused = payload.game_session_status === 'relay_paused';
        if (!this.relayPaused) this.flushTunnelQueue();
        this.options.onRoomJoined(payload.id, payload, this.decodeBase64(payload.game_info, 4096));
        break;
      }
      case WSMessageType.ROOM_RESTORED: {
        if (typeof payload?.room?.id !== 'string') return;
        this.currentRoomId = payload.room.id;
        this.relayPaused = payload.room.game_session_status === 'relay_paused';
        if (this.pendingLeave) {
          this.pendingLeave = false;
          this.relayPaused = false;
          this.send({ type: WSMessageType.LEAVE_ROOM, payload: {} });
          this.currentRoomId = null;
          break;
        }
        if (!this.relayPaused) this.flushTunnelQueue();
        this.options.onRoomRestored?.(
          payload.room.id, payload.room, this.decodeBase64(payload.game_info, 4096),
        );
        break;
      }
      case WSMessageType.ROOM_CLOSED:
        this.currentRoomId = null;
        this.pendingLeave = false;
        this.relayPaused = false;
        this.tunnelQueue = [];
        this.queuedTunnelBytes = 0;
        this.options.onRoomClosed();
        break;
      case WSMessageType.ROOM_LIST:
        if (Array.isArray(payload)) this.options.onRoomList(payload);
        break;
      case WSMessageType.ROOM_UPDATE:
        this.requestRoomList();
        if (payload && typeof payload.action === 'string') {
          this.options.onRoomUpdate?.(payload.action, payload.userId, payload.username);
        }
        break;
      case WSMessageType.ROOM_GAMEINFO: {
        const packet = this.decodeBase64(payload?.data, 4096);
        if (packet && parseGameInfo(packet)) this.options.onGameInfo(packet);
        break;
      }
      case WSMessageType.ROOM_GAMEINFO_LOST:
        this.options.onGameInfoLost?.();
        break;
      case WSMessageType.GAME_ENDED:
        this.options.onGameEnded?.();
        break;
      case WSMessageType.CHAT_MESSAGE:
        if (payload && typeof payload.userId === 'number' && typeof payload.username === 'string' && typeof payload.text === 'string') {
          this.options.onChatMessage?.({ userId: payload.userId, username: payload.username, text: payload.text, ts: payload.ts ?? Date.now() });
        }
        break;
      case WSMessageType.CHAT_HISTORY:
        if (payload && Array.isArray(payload.messages)) {
          this.options.onChatHistory?.(payload.messages);
        }
        break;
      case WSMessageType.PONG:
        if (typeof payload?.ts === 'number' && this.pingTimestamp !== null) {
          const rtt = Date.now() - this.pingTimestamp;
          this.pingTimestamp = null;
          this.options.onPingResult?.(rtt);
        }
        break;
      case WSMessageType.GAME_RELAY_PAUSED:
        this.relayPaused = true;
        this.options.onRelayState?.('paused', payload);
        break;
      case WSMessageType.GAME_RELAY_RESUMED:
        this.relayPaused = false;
        this.flushTunnelQueue();
        this.options.onRelayState?.('resumed', payload);
        break;
      case WSMessageType.ERROR:
        this.options.onError(payload?.error || 'Relay server error');
        break;
      default:
        if (!this.reportedUnknownTypes.has(type)) {
          this.reportedUnknownTypes.add(type);
          console.error('[WS] unknown server message type:', type, 'payload keys:', payload && typeof payload === 'object' ? Object.keys(payload) : []);
          this.options.onError(`Unknown relay message type: ${type} (see client logs)`);
        }
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimeout) return;
    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      this.connect();
    }, 3000);
  }
}
