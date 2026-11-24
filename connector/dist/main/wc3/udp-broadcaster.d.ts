import { ParsedGameInfo } from './protocol';
export declare class UDPBroadcaster {
    private wc3Port;
    private socket;
    private timer;
    private gamePacket;
    private proxyPort;
    private createSent;
    private onGameInfo;
    private onGameInfoLost;
    private lastGameInfoAt;
    private gameWasFound;
    private hostCounter;
    constructor(wc3Port?: number);
    private ensureSocket;
    private startTimer;
    private stopTimer;
    private sendToWc3;
    probe(onGameInfo: (packet: Buffer, info: ParsedGameInfo) => void, onGameInfoLost?: () => void): void;
    announce(hostGameInfo: Buffer, proxyPort: number): void;
    private announceTick;
    updateGame(hostGameInfo: Buffer): void;
    /** Stop probing/announcing without closing the reusable UDP socket. */
    reset(): void;
    stop(): void;
}
