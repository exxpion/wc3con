import { randomBytes } from 'crypto';
import { GameRoom, ConnectedClient, ChatMessage } from '../types/index.js';

export const rooms = new Map<string, GameRoom>();
export const clients = new Map<number, ConnectedClient>();
export const roomGameInfo = new Map<string, string>();
// Чат комнаты: хранится пока комната жива, удаляется при закрытии
export const roomChat = new Map<string, ChatMessage[]>();
// Время входа каждого пользователя в комнату: chat виден только с этого момента
export const roomChatJoinedAt = new Map<string, Map<number, number>>();

export const CHAT_MAX_MESSAGES = 50;
export const CHAT_MAX_LENGTH = 512;

export function generateRoomId(): string {
  return randomBytes(8).toString('hex');
}

export function createRoom(name: string, map: string, hostUserId: number, maxPlayers = 12): GameRoom {
  const room: GameRoom = {
    id: generateRoomId(), name, map, host_user_id: hostUserId,
    max_players: maxPlayers, current_players: 1, created_at: Date.now(),
    status: 'waiting', game_session_status: 'not_created',
  };
  rooms.set(room.id, room);
  return room;
}

export function joinRoom(roomId: string): GameRoom | null {
  const room = rooms.get(roomId);
  if (!room || room.current_players >= room.max_players) return null;
  room.current_players++;
  return room;
}

export function leaveRoom(roomId: string, userId: number): void {
  const room = rooms.get(roomId);
  if (!room) return;
  if (room.host_user_id === userId) {
    closeRoom(roomId);
    return;
  }
  room.current_players = Math.max(0, room.current_players - 1);
  if (room.current_players === 0) closeRoom(roomId);
}

export function closeRoom(roomId: string): void {
  rooms.delete(roomId);
  roomGameInfo.delete(roomId);
  roomChat.delete(roomId);
  roomChatJoinedAt.delete(roomId);
}

export function getRoomList(): GameRoom[] {
  return Array.from(rooms.values()).filter((room) => room.status === 'waiting');
}

export function getClientsInRoom(roomId: string): ConnectedClient[] {
  return Array.from(clients.values()).filter((client) => client.room_id === roomId);
}

export function getConnectedClientsInRoom(roomId: string): ConnectedClient[] {
  return getClientsInRoom(roomId).filter((client) => client.connected && client.ws);
}
