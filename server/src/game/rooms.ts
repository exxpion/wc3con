import { randomBytes } from 'crypto';
import { GameRoom, ConnectedClient } from '../types/index.js';

// In-memory storage for game rooms and connected clients
export const rooms = new Map<string, GameRoom>();
export const clients = new Map<number, ConnectedClient>();

// GAMEINFO (base64) настоящей игры WC3 хоста, по id комнаты
export const roomGameInfo = new Map<string, string>();

export function generateRoomId(): string {
  return randomBytes(8).toString('hex');
}

export function createRoom(
  name: string,
  map: string,
  hostUserId: number,
  maxPlayers: number = 12
): GameRoom {
  const roomId = generateRoomId();
  const room: GameRoom = {
    id: roomId,
    name,
    map,
    host_user_id: hostUserId,
    max_players: maxPlayers,
    current_players: 1,
    created_at: Date.now(),
    status: 'waiting',
  };
  rooms.set(roomId, room);
  return room;
}

export function joinRoom(roomId: string): GameRoom | null {
  const room = rooms.get(roomId);
  if (!room) return null;
  
  if (room.current_players >= room.max_players) {
    return null;
  }

  room.current_players++;
  return room;
}

export function leaveRoom(roomId: string, userId: number): void {
  const room = rooms.get(roomId);
  if (!room) return;

  room.current_players--;

  // If host leaves or no players left, delete room
  if (room.host_user_id === userId || room.current_players === 0) {
    rooms.delete(roomId);
    roomGameInfo.delete(roomId);
  }
}

export function getRoomList(): GameRoom[] {
  return Array.from(rooms.values()).filter(room => room.status === 'waiting');
}

export function getClientsInRoom(roomId: string): ConnectedClient[] {
  return Array.from(clients.values()).filter(client => client.room_id === roomId);
}
