export declare const WS_PROTOCOL_VERSION = 1;
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
    onRelayState?: (state: 'paused' | 'resumed', payload: any) => void;
    onTunnel: (msg: TunnelMessage) => void;
    onError: (error: string) => void;
}
export declare class WSRelayClient {
    private options;
    private ws;
    private reconnectTimeout;
    private reconnectGraceTimeout;
    private isConnecting;
    private stopped;
    private authenticated;
    private currentRoomId;
    private pendingLeave;
    private relayPaused;
    private tunnelQueue;
    private queuedTunnelBytes;
    private reportedUnknownTypes;
    constructor(options: WSClientOptions);
    connect(): void;
    disconnect(): void;
    createRoom(name: string, map: string, maxPlayers?: number): boolean;
    joinRoom(roomId: string): boolean;
    leaveRoom(): void;
    requestRoomList(): void;
    sendGameInfo(packet: Buffer): void;
    sendGameInfoLost(): void;
    sendGameEnded(): void;
    sendTunnel(msg: TunnelMessage): void;
    isConnected(): boolean;
    private buildBinaryFrame;
    private sendBinaryFrame;
    private handleBinaryMessage;
    private sendRaw;
    private send;
    private flushTunnelQueue;
    private decodeBase64;
    private handleMessage;
    private scheduleReconnect;
}
