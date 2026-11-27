export interface User {
  id: number;
  username: string;
  password_hash: string;
  email: string | null;
  email_verified: number; // 0 | 1
  created_at: number;
  last_ip: string | null;
}

export interface PendingRegistration {
  id: number;
  username: string;
  password_hash: string;
  email: string;
  ip: string | null;
  created_at: number;
}

export type GameSessionStatus = 'not_created' | 'available' | 'unavailable' | 'relay_paused';

export interface GameRoom {
  id: string;
  name: string;
  map: string;
  host_user_id: number;
  max_players: number;
  current_players: number;
  created_at: number;
  status: 'waiting' | 'started' | 'finished';
  game_session_status: GameSessionStatus;
  game_info_updated_at?: number;
}

export interface ConnectedClient {
  user_id: number;
  username: string;
  ws: any | null;
  room_id?: string;
  is_host: boolean;
  connected: boolean;
  disconnect_deadline?: number;
  disconnect_timer?: ReturnType<typeof setTimeout>;
  expired_room_id?: string;
}

export interface AuthPayload {
  userId: number;
  username: string;
}

export interface WSMessage {
  type: string;
  protocolVersion?: number;
  payload?: any;
}

export enum WSMessageType {
  AUTH = 'auth', AUTH_SUCCESS = 'auth_success', AUTH_ERROR = 'auth_error',
  CREATE_ROOM = 'create_room', ROOM_CREATED = 'room_created',
  JOIN_ROOM = 'join_room', ROOM_JOINED = 'room_joined', ROOM_RESTORED = 'room_restored',
  LEAVE_ROOM = 'leave_room', ROOM_LIST = 'room_list', ROOM_UPDATE = 'room_update',
  GAME_DATA = 'game_data', ROOM_GAMEINFO = 'room_gameinfo',
  ROOM_GAMEINFO_LOST = 'room_gameinfo_lost', ROOM_CLOSED = 'room_closed', TUNNEL = 'tunnel',
  GAME_RELAY_PAUSED = 'game_relay_paused', GAME_RELAY_RESUMED = 'game_relay_resumed',
  GAME_ENDED = 'game_ended',
  ERROR = 'error',
}
