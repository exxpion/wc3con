import * as dgram from 'dgram';
import {
  buildCreateGame, buildSearchGame, parseGameInfo, rewriteGameInfoPort,
  ParsedGameInfo, WC3_VERSION,
} from './protocol';

const PROBE_INTERVAL_MS = 2000;
const GAMEINFO_TIMEOUT_MS = 9000;

export class UDPBroadcaster {
  private socket: dgram.Socket | null = null;
  private timer: NodeJS.Timeout | null = null;
  private gamePacket: Buffer | null = null;
  private proxyPort = 0;
  private createSent = false;
  private onGameInfo: ((packet: Buffer, info: ParsedGameInfo) => void) | null = null;
  private onGameInfoLost: (() => void) | null = null;
  private lastGameInfoAt = 0;
  private gameWasFound = false;
  private hostCounter = 1;

  constructor(private wc3Port = 6112) {}

  private ensureSocket(): void {
    if (this.socket) return;
    const socket = dgram.createSocket('udp4');
    this.socket = socket;
    socket.on('error', (err) => console.error('[UDP] socket error:', err.message));
    socket.on('message', (msg) => {
      if (!this.onGameInfo) return;
      const info = parseGameInfo(msg);
      if (!info || info.version !== WC3_VERSION) return;
      this.lastGameInfoAt = Date.now();
      this.gameWasFound = true;
      this.onGameInfo(Buffer.from(msg), info);
    });
    socket.bind(0, '0.0.0.0', () => {
      try { socket.setBroadcast(true); } catch { /* optional */ }
      console.log(`[UDP] bound ${socket.address().port}; WC3 UDP ${this.wc3Port} remains free`);
    });
  }

  private startTimer(fn: () => void, intervalMs: number): void {
    this.stopTimer();
    fn();
    this.timer = setInterval(fn, intervalMs);
  }

  private stopTimer(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private sendToWc3(packet: Buffer): void {
    this.socket?.send(packet, this.wc3Port, '127.0.0.1', (err) => {
      if (err) console.error('[UDP] send to WC3 failed:', err.message);
    });
  }

  probe(
    onGameInfo: (packet: Buffer, info: ParsedGameInfo) => void,
    onGameInfoLost?: () => void,
  ): void {
    this.reset();
    this.onGameInfo = onGameInfo;
    this.onGameInfoLost = onGameInfoLost ?? null;
    this.lastGameInfoAt = 0;
    this.gameWasFound = false;
    this.ensureSocket();
    const search = buildSearchGame();
    this.startTimer(() => {
      this.sendToWc3(search);
      if (this.gameWasFound && Date.now() - this.lastGameInfoAt > GAMEINFO_TIMEOUT_MS) {
        this.gameWasFound = false;
        this.onGameInfoLost?.();
      }
    }, PROBE_INTERVAL_MS);
  }

  announce(hostGameInfo: Buffer, proxyPort: number): void {
    const parsed = parseGameInfo(hostGameInfo);
    if (!parsed || parsed.version !== WC3_VERSION) {
      throw new Error('Host supplied an invalid or incompatible WC3 1.26 GAMEINFO packet');
    }
    if (!Number.isInteger(proxyPort) || proxyPort < 1 || proxyPort > 65535) {
      throw new RangeError(`Invalid local proxy port: ${proxyPort}`);
    }
    this.onGameInfo = null;
    this.onGameInfoLost = null;
    this.proxyPort = proxyPort;
    this.ensureSocket();
    this.gamePacket = rewriteGameInfoPort(hostGameInfo, proxyPort);
    if (!this.timer) {
      this.createSent = false;
      this.startTimer(() => this.announceTick(), PROBE_INTERVAL_MS);
    } else {
      this.announceTick();
    }
  }

  private announceTick(): void {
    if (!this.gamePacket) return;
    if (!this.createSent) {
      this.sendToWc3(buildCreateGame(WC3_VERSION, this.hostCounter++));
      this.createSent = true;
    }
    this.sendToWc3(this.gamePacket);
  }

  updateGame(hostGameInfo: Buffer): void {
    if (!this.gamePacket) return;
    this.gamePacket = rewriteGameInfoPort(hostGameInfo, this.proxyPort);
  }

  /** Stop probing/announcing without closing the reusable UDP socket. */
  reset(): void {
    this.stopTimer();
    this.gamePacket = null;
    this.onGameInfo = null;
    this.onGameInfoLost = null;
    this.createSent = false;
    this.gameWasFound = false;
    this.lastGameInfoAt = 0;
  }

  stop(): void {
    this.reset();
    if (this.socket) {
      const socket = this.socket;
      this.socket = null;
      try { socket.close(); } catch { /* already closed */ }
    }
  }
}
