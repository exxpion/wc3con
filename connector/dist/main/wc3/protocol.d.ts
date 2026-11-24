/** W3GS packet helpers for Warcraft III 1.26. */
export declare const W3GS_HEADER = 247;
export declare const W3GS_SEARCHGAME = 47;
export declare const W3GS_GAMEINFO = 48;
export declare const W3GS_CREATEGAME = 49;
export declare const WC3_VERSION = 26;
export declare function isW3gsPacket(data: Buffer, expectedType?: number): boolean;
export declare function buildSearchGame(version?: number): Buffer;
export declare function buildCreateGame(version?: number, hostCounter?: number): Buffer;
export interface ParsedGameInfo {
    version: number;
    hostCounter: number;
    gameName: string;
    slotsTotal: number;
    slotsOpen: number;
    port: number;
}
/** Parse only structurally valid W3GS_GAMEINFO packets. */
export declare function parseGameInfo(data: Buffer): ParsedGameInfo | null;
export declare function rewriteGameInfoPort(data: Buffer, port: number): Buffer;
