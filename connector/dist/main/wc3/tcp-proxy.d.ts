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
export declare class TCPProxy {
    private options;
    private server;
    private sockets;
    private nextId;
    private _port;
    constructor(options: TCPProxyOptions);
    get port(): number;
    /** Запуститься на свободном порту, выбранном системой. Возвращает порт. */
    start(): Promise<number>;
    write(connId: number, data: Buffer): void;
    /** Закрыть соединение по просьбе хоста (без обратного уведомления) */
    close(connId: number): void;
    closeAll(): void;
    stop(): void;
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
export declare class HostTunnel {
    private options;
    private sockets;
    constructor(options: HostTunnelOptions);
    private key;
    open(userId: number, connId: number, gamePort?: number): void;
    write(userId: number, connId: number, data: Buffer): void;
    close(userId: number, connId: number): void;
    closeAllForUser(userId: number): void;
    closeAll(): void;
}
