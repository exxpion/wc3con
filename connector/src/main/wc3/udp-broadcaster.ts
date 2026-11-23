import * as dgram from 'dgram';
import {
  buildCreateGame,
  buildSearchGame,
  parseGameInfo,
  rewriteGameInfoPort,
  ParsedGameInfo,
} from './protocol';

/**
 * UDP-часть коннектора.
 *
 * ВАЖНО: сокет привязан к СЛУЧАЙНОМУ порту, а не к 6112.
 * Порты 6112 (UDP и TCP) должен занимать сам Warcraft III, иначе он
 * не сможет открыть «Локальную сеть» и покажет «Не удалось подключиться к сети».
 *
 * Два режима (взаимоисключающие):
 *  • хост   — probe(): раз в пару секунд спрашивает локальный WC3 (127.0.0.1:6112)
 *             «какие игры у тебя есть?» и отдаёт настоящий GAMEINFO наружу;
 *  • гость  — announce(): раз в пару секунд «подкидывает» локальному WC3
 *             GAMEINFO хоста с портом нашего TCP-прокси, и игра появляется в списке.
 */
export class UDPBroadcaster {
  private socket: dgram.Socket | null = null;
  private timer: NodeJS.Timeout | null = null;

  // режим гостя
  private gamePacket: Buffer | null = null;
  private proxyPort = 0;
  private createSent = false;

  // режим хоста
  private onGameInfo: ((packet: Buffer, info: ParsedGameInfo) => void) | null = null;

  constructor(private wc3Port: number = 6112) {}

  private ensureSocket(): void {
    if (this.socket) return;

    const socket = dgram.createSocket({ type: 'udp4' });
    this.socket = socket;

    socket.on('error', (err) => {
      console.error('UDP socket error:', err.message);
    });

    socket.on('message', (msg) => {
      if (!this.onGameInfo) return;
      const info = parseGameInfo(msg);
      if (info) this.onGameInfo(msg, info);
    });

    socket.bind(0, '0.0.0.0', () => {
      try {
        socket.setBroadcast(true);
      } catch {
        /* не критично */
      }
      console.log(`UDP socket on port ${socket.address().port} (WC3 port ${this.wc3Port} is left free)`);
    });
  }

  private startTimer(fn: () => void, intervalMs: number): void {
    this.stopTimer();
    fn();
    this.timer = setInterval(fn, intervalMs);
  }

  private stopTimer(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private sendToWc3(packet: Buffer): void {
    this.socket?.send(packet, this.wc3Port, '127.0.0.1', (err) => {
      if (err) console.error('UDP send to WC3 failed:', err.message);
    });
  }

  // ─── Режим хоста ───────────────────────────────────────────────────────────

  /** Искать хостящуюся на этом ПК игру WC3 и сообщать её GAMEINFO */
  probe(onGameInfo: (packet: Buffer, info: ParsedGameInfo) => void): void {
    this.gamePacket = null;
    this.onGameInfo = onGameInfo;
    this.ensureSocket();

    const search = buildSearchGame();
    this.startTimer(() => this.sendToWc3(search), 2000);
  }

  // ─── Режим гостя ───────────────────────────────────────────────────────────

  /** Показывать в локальном WC3 игру хоста (порт подменяется на порт нашего прокси) */
  announce(hostGameInfo: Buffer, proxyPort: number): void {
    this.onGameInfo = null;
    this.proxyPort = proxyPort;
    this.ensureSocket();

    const first = !this.gamePacket;
    this.gamePacket = rewriteGameInfoPort(hostGameInfo, proxyPort);

    console.log(`[UDP ANNOUNCE] Starting announce mode: proxyPort=${proxyPort}, firstTime=${first}, packetSize=${this.gamePacket.length}`);

    if (first || !this.timer) {
      this.createSent = false;
      this.startTimer(() => this.announceTick(), 2000);
    } else {
      this.announceTick();
    }
  }

  private announceTick(): void {
    if (!this.gamePacket) return;
    if (!this.createSent) {
      console.log('[UDP ANNOUNCE] Sending CREATEGAME to WC3 at 127.0.0.1:6112');
      this.sendToWc3(buildCreateGame());
      this.createSent = true;
    }
    console.log(`[UDP ANNOUNCE] Broadcasting GAMEINFO to WC3 (${this.gamePacket.length} bytes)`);
    this.sendToWc3(this.gamePacket);
  }

  /** Обновить пакет на лету (хост прислал свежий GAMEINFO) */
  updateGame(hostGameInfo: Buffer): void {
    if (!this.gamePacket) return;
    this.gamePacket = rewriteGameInfoPort(hostGameInfo, this.proxyPort);
  }

  // ─── Общее ─────────────────────────────────────────────────────────────────

  /** Остановить объявления/поиск, сокет оставить открытым */
  reset(): void {
    this.stopTimer();
    this.gamePacket = null;
    this.onGameInfo = null;
    this.createSent = false;
  }

  stop(): void {
    this.reset();
    if (this.socket) {
      try {
        this.socket.close();
      } catch {
        /* уже закрыт */
      }
      this.socket = null;
    }
    console.log('UDP broadcaster stopped');
  }
}
