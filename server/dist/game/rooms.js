import { randomBytes } from 'crypto';
export const rooms = new Map();
export const clients = new Map();
export const roomGameInfo = new Map();
// Чат комнаты: хранится пока комната жива, удаляется при закрытии
export const roomChat = new Map();
// Время входа каждого пользователя в комнату: chat виден только с этого момента
export const roomChatJoinedAt = new Map();
export const CHAT_MAX_MESSAGES = 50;
export const CHAT_MAX_LENGTH = 512;
export function generateRoomId() {
    return randomBytes(8).toString('hex');
}
export function createRoom(name, map, hostUserId, maxPlayers = 12) {
    const room = {
        id: generateRoomId(), name, map, host_user_id: hostUserId,
        max_players: maxPlayers, current_players: 1, created_at: Date.now(),
        status: 'waiting', game_session_status: 'not_created',
    };
    rooms.set(room.id, room);
    return room;
}
export function joinRoom(roomId) {
    const room = rooms.get(roomId);
    if (!room || room.current_players >= room.max_players)
        return null;
    room.current_players++;
    return room;
}
export function leaveRoom(roomId, userId) {
    const room = rooms.get(roomId);
    if (!room)
        return;
    if (room.host_user_id === userId) {
        closeRoom(roomId);
        return;
    }
    room.current_players = Math.max(0, room.current_players - 1);
    if (room.current_players === 0)
        closeRoom(roomId);
}
export function closeRoom(roomId) {
    rooms.delete(roomId);
    roomGameInfo.delete(roomId);
    roomChat.delete(roomId);
    roomChatJoinedAt.delete(roomId);
}
export function getRoomList() {
    return Array.from(rooms.values()).filter((room) => room.status === 'waiting');
}
export function getClientsInRoom(roomId) {
    return Array.from(clients.values()).filter((client) => client.room_id === roomId);
}
export function getConnectedClientsInRoom(roomId) {
    return getClientsInRoom(roomId).filter((client) => client.connected && client.ws);
}
//# sourceMappingURL=rooms.js.map