import { GameRoom, ConnectedClient, ChatMessage } from '../types/index.js';
export declare const rooms: Map<string, GameRoom>;
export declare const clients: Map<number, ConnectedClient>;
export declare const roomGameInfo: Map<string, string>;
export declare const roomChat: Map<string, ChatMessage[]>;
export declare const roomChatJoinedAt: Map<string, Map<number, number>>;
export declare const CHAT_MAX_MESSAGES = 50;
export declare const CHAT_MAX_LENGTH = 512;
export declare function generateRoomId(): string;
export declare function createRoom(name: string, map: string, hostUserId: number, maxPlayers?: number): GameRoom;
export declare function joinRoom(roomId: string): GameRoom | null;
export declare function leaveRoom(roomId: string, userId: number): void;
export declare function closeRoom(roomId: string): void;
export declare function getRoomList(): GameRoom[];
export declare function getClientsInRoom(roomId: string): ConnectedClient[];
export declare function getConnectedClientsInRoom(roomId: string): ConnectedClient[];
//# sourceMappingURL=rooms.d.ts.map