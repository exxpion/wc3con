import type { TunnelMessage } from './ws-relay-client';
export interface P2POptions {
    serverIp: string;
    serverPort: number;
    jwtToken: string;
    onReady: (externalIp: string, externalPort: number) => void;
    onTunnel: (peerId: number, msg: TunnelMessage) => void;
    onPeerConnected: (peerId: number) => void;
    onPeerFailed: (peerId: number) => void;
}
export declare class P2PTunnel {
    private options;
    private socket;
    private peers;
    private peerByAddr;
    private externalIp;
    private externalPort;
    private discoveryTimer;
    constructor(options: P2POptions);
    /** Open UDP socket and discover external endpoint via server. */
    start(): void;
    /** Stop everything and close the UDP socket. */
    stop(): void;
    /** Register a peer endpoint received from relay server via P2P_CONNECT. */
    connectToPeer(userId: number, ip: string, port: number): void;
    /** Remove a peer (e.g. they left the room). */
    removePeer(userId: number): void;
    /** Is the P2P connection to this peer active? */
    isP2PActive(userId: number): boolean;
    /** Send a tunnel message to a peer over direct UDP. */
    sendTunnel(peerId: number, msg: TunnelMessage): void;
    /** Local port of the UDP socket (to register with relay). */
    get localPort(): number;
    private sendDiscovery;
    private startPunching;
    private sendPing;
    private sendPong;
    private handlePacket;
    private onPeerActivity;
    private startKeepalive;
    private startFailTimer;
    private clearTimer;
    private clearPeerTimers;
}
