// WebSocket message types - MUST match server/src/types/index.ts
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
  ROOM_GAMEINFO = 'room_gameinfo',
  ROOM_CLOSED = 'room_closed',
  TUNNEL = 'tunnel',
  
  // Errors
  ERROR = 'error',
}

export interface WSMessage {
  type: WSMessageType;
  payload?: any;
}
