"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WSMessageType = void 0;
// WebSocket protocol version and message names shared with the relay server.
var WSMessageType;
(function (WSMessageType) {
    WSMessageType["AUTH"] = "auth";
    WSMessageType["AUTH_SUCCESS"] = "auth_success";
    WSMessageType["AUTH_ERROR"] = "auth_error";
    WSMessageType["CREATE_ROOM"] = "create_room";
    WSMessageType["ROOM_CREATED"] = "room_created";
    WSMessageType["JOIN_ROOM"] = "join_room";
    WSMessageType["ROOM_JOINED"] = "room_joined";
    WSMessageType["ROOM_RESTORED"] = "room_restored";
    WSMessageType["LEAVE_ROOM"] = "leave_room";
    WSMessageType["ROOM_LIST"] = "room_list";
    WSMessageType["ROOM_UPDATE"] = "room_update";
    WSMessageType["GAME_DATA"] = "game_data";
    WSMessageType["ROOM_GAMEINFO"] = "room_gameinfo";
    WSMessageType["ROOM_GAMEINFO_LOST"] = "room_gameinfo_lost";
    WSMessageType["ROOM_CLOSED"] = "room_closed";
    WSMessageType["TUNNEL"] = "tunnel";
    WSMessageType["GAME_RELAY_PAUSED"] = "game_relay_paused";
    WSMessageType["GAME_RELAY_RESUMED"] = "game_relay_resumed";
    // P2P hole punching
    WSMessageType["P2P_REGISTER"] = "p2p_register";
    WSMessageType["P2P_CONNECT"] = "p2p_connect";
    WSMessageType["P2P_STATUS"] = "p2p_status";
    WSMessageType["ERROR"] = "error";
})(WSMessageType || (exports.WSMessageType = WSMessageType = {}));
//# sourceMappingURL=types.js.map