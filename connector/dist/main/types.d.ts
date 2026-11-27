export declare enum WSMessageType {
    AUTH = "auth",
    AUTH_SUCCESS = "auth_success",
    AUTH_ERROR = "auth_error",
    CREATE_ROOM = "create_room",
    ROOM_CREATED = "room_created",
    JOIN_ROOM = "join_room",
    ROOM_JOINED = "room_joined",
    ROOM_RESTORED = "room_restored",
    LEAVE_ROOM = "leave_room",
    ROOM_LIST = "room_list",
    ROOM_UPDATE = "room_update",
    GAME_DATA = "game_data",
    ROOM_GAMEINFO = "room_gameinfo",
    ROOM_GAMEINFO_LOST = "room_gameinfo_lost",
    ROOM_CLOSED = "room_closed",
    TUNNEL = "tunnel",
    GAME_RELAY_PAUSED = "game_relay_paused",
    GAME_RELAY_RESUMED = "game_relay_resumed",
    GAME_ENDED = "game_ended",
    ERROR = "error"
}
export interface WSMessage {
    type: WSMessageType;
    protocolVersion: number;
    payload?: unknown;
}
