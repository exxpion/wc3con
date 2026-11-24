import * as net from 'net';

/**
 * TCP-прокси гостя.
 *
 * Слушает СВОЙ порт (не 6112!) на 127.0.0.1. Именно этот порт коннектор
 * прописывает в GAMEINFO, поэтому Warcraft III гостя подключается сюда.
 * Каждое TCP-подключение получает числовой id, чтобы хост мог отличать игроков.
 */
export interface TCPProxyOptions {
  onOpen: (connId: number) => void;
  onData: (connId: number, data: Buffer) => void;
  onClose: (connId: number) => void;
}

export class TCPProxy {
  private server: net.Server | null = null;
  private sockets = new Map<number, net.Socket>();
  private nextId = 1;
  private _port = 0;

  constructor(private options: TCPProxyOptions) {}

  get port(): number {
    return this._port;
  }

  /** Запуститься на свободном порту, выбранном системой. Возвращает порт. */
  start(): Promise<number> {
    return new Promise((resolve, reject) => {
      if (this.server) return resolve(this._port);

      const server = net.createServer((socket) => {
        const connId = this.nextId++;
        this.sockets.set(connId, socket);
        socket.setNoDelay(true);
        console.log(`WC3 connected to proxy (conn ${connId})`);
        this.options.onOpen(connId);

        socket.on('data', (data) => this.options.onData(connId, Buffer.isBuffer(data) ? data : Buffer.from(data)));

        socket.on('close', () => {
          if (this.sockets.delete(connId)) {
            console.log(`WC3 proxy connection closed (conn ${connId})`);
            this.options.onClose(connId);
          }
        });

        socket.on('error', (err) => {
          console.error(`Proxy socket error (conn ${connId}):`, err.message);
          socket.destroy();
        });
      });

      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        server.removeListener('error', reject);
        server.on('error', (err) => console.error('TCP proxy error:', err));
        this.server = server;
        this._port = (server.address() as net.AddressInfo).port;
        console.log(`TCP proxy listening on 127.0.0.1:${this._port}`);
        resolve(this._port);
      });
    });
  }

  write(connId: number, data: Buffer): void {
    const s = this.sockets.get(connId);
    if (s && s.writable) s.write(data);
  }

  /** Закрыть соединение по просьбе хоста (без обратного уведомления) */
  close(connId: number): void {
    const s = this.sockets.get(connId);
    if (s) {
      this.sockets.delete(connId);
      s.destroy();
    }
  }

  closeAll(): void {
    this.sockets.forEach((s) => s.destroy());
    this.sockets.clear();
  }

  stop(): void {
    this.closeAll();
    if (this.server) {
      this.server.close();
      this.server = null;
    }
    this._port = 0;
    console.log('TCP proxy stopped');
  }
}

/**
 * Туннели хоста.
 *
 * Когда гость подключается к своему прокси, хост получает «open» и открывает
 * обычное TCP-соединение к СВОЕМУ Warcraft III (127.0.0.1:6112) — для WC3
 * хоста это выглядит как обычный игрок из локальной сети.
 */
export interface HostTunnelOptions {
  wc3Port: number;
  /** данные от WC3 хоста к конкретному гостю */
  onData: (userId: number, connId: number, data: Buffer) => void;
  /** WC3 хоста закрыл соединение */
  onClose: (userId: number, connId: number) => void;
}

export class HostTunnel {
  private sockets = new Map<string, net.Socket>();

  constructor(private options: HostTunnelOptions) {}

  private key(userId: number, connId: number): string {
    return `${userId}:${connId}`;
  }

  open(userId: number, connId: number, gamePort = this.options.wc3Port): void {
    const key = this.key(userId, connId);
    this.close(userId, connId);

    if (!Number.isInteger(gamePort) || gamePort < 1 || gamePort > 65535) {
      console.error(`Refusing host tunnel with invalid WC3 port: ${gamePort}`);
      return;
    }
    const socket = net.connect({ host: '127.0.0.1', port: gamePort });
    socket.setNoDelay(true);
    this.sockets.set(key, socket);

    socket.on('connect', () => console.log(`Host tunnel ${key} -> WC3 :${gamePort}`));
    socket.on('data', (data) => this.options.onData(userId, connId, Buffer.isBuffer(data) ? data : Buffer.from(data)));
    socket.on('close', () => {
      if (this.sockets.get(key) === socket) {
        this.sockets.delete(key);
        this.options.onClose(userId, connId);
      }
    });
    socket.on('error', (err) => {
      console.error(`Host tunnel ${key} error:`, err.message);
      socket.destroy();
    });
  }

  write(userId: number, connId: number, data: Buffer): void {
    const s = this.sockets.get(this.key(userId, connId));
    // запись до установки соединения Node буферизует сама
    if (s && !s.destroyed) s.write(data);
  }

  close(userId: number, connId: number): void {
    const key = this.key(userId, connId);
    const s = this.sockets.get(key);
    if (s) {
      this.sockets.delete(key);
      s.destroy();
    }
  }

  closeAllForUser(userId: number): void {
    const prefix = `${userId}:`;
    for (const [key, s] of this.sockets) {
      if (key.startsWith(prefix)) {
        this.sockets.delete(key);
        s.destroy();
      }
    }
  }

  closeAll(): void {
    this.sockets.forEach((s) => s.destroy());
    this.sockets.clear();
  }
}
