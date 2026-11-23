export interface User {
  id: number;
  username: string;
  password_hash: string;
  created_at: number;
}

export interface GameRoom {
  id: string;
  name: string;
  map: string;
  host_user_id: number;
  max_players: number;
  current_players: number;
  created_at: number;
  status: 'waiting' | 'started' | 'finished';
}

export interface ConnectedClient {
  user_id: number;
  username: string;
  ws: any;
  room_id?: string;
  is_host: boolean;
}

export interface AuthPayload {
  userId: number;
  username: string;
}

export interface WSMessage {
  type: string;
  payload?: any;
}

// WebSocket message types
export enum WSMessageType {
  // Auth
  AUTH = 'auth',
  AUTH_SUCCESS = 'auth_success',
  AUTH_ERROR = 'auth_error',
  
  // Game rooms
  CREATE_ROOM = 'create_room',
  ROOM_CREATED = 'room_created',
  JOIN_ROOM = 'join_room',
  ROOM_JOINED = 'room_joined',
  LEAVE_ROOM = 'leave_room',
  ROOM_LIST = 'room_list',
  ROOM_UPDATE = 'room_update',
  
  // Game traffic relay
  GAME_DATA = 'game_data',
  
  // Errors
  ERROR = 'error',
}
