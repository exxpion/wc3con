import { WebSocketServer, WebSocket } from 'ws';
import { FastifyInstance } from 'fastify';
import { IncomingMessage } from 'http';
import {
  WSMessage, WSMessageType, ConnectedClient, AuthPayload,
} from '../types/index.js';
import {
  createRoom, joinRoom, leaveRoom, closeRoom, getRoomList,
  getClientsInRoom, getConnectedClientsInRoom, clients, rooms, roomGameInfo,
  roomChat, roomChatJoinedAt, CHAT_MAX_MESSAGES, CHAT_MAX_LENGTH,
} from '../game/rooms.js';

const PROTOCOL_VERSION = 1;
const RECONNECT_GRACE_MS = 180_000;
const GAMEINFO_MAX_AGE_MS = 9_000;
const expiredRoomByUser = new Map<number, string>();
const MAX_TUNNEL_CHUNK = 700_000;
const MAX_GAMEINFO_BASE64 = 4096;

// Binary tunnel frame: [1 op][4 conn LE][4 userId LE][data?]
const BIN_OP_OPEN      = 1;
const BIN_OP_DATA      = 2;
const BIN_OP_CLOSE     = 3;
const BIN_OP_CLOSE_ALL = 4;
const BIN_HEADER       = 9;

export function setupWebSocketServer(app: FastifyInstance) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 800_000, perMessageDeflate: false });

  app.server.on('upgrade', (request: IncomingMessage, socket, head) => {
    if (request.url === '/ws') {
      wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, request));
    } else socket.destroy();
  });

  wss.on('connection', (ws: WebSocket) => {
    let client: ConnectedClient | null = null;

    ws.on('message', async (data, isBinary) => {
      try {
        const raw = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as any);
        if (isBinary) {
          if (client) handleBinaryTunnel(ws, raw, client);
          return;
        }
        const message = JSON.parse(raw.toString('utf8')) as WSMessage;
        if (!message || typeof message.type !== 'string') throw new Error('Message must contain a type');
        await handleMessage(ws, message, client, (next) => { client = next; });
      } catch (err) {
        app.log.warn({ err }, 'Rejected malformed WebSocket message');
        send(ws, { type: WSMessageType.ERROR, payload: { error: 'Invalid message format' } });
      }
    });

    ws.on('close', (code) => {
      if (!client || client.ws !== ws || clients.get(client.user_id) !== client) return;
      if (code === 1000) {
        // Explicit client logout/normal close is intentional, not a transient network loss.
        removeFromRoom(client, true);
        clients.delete(client.user_id);
      } else {
        markUnexpectedDisconnect(client);
      }
    });

    ws.on('error', (err) => app.log.warn({ err }, 'WebSocket transport error'));
  });

  function sendBinaryTunnel(target: WebSocket | null | undefined, op: number, conn: number, userId: number, data?: Buffer): void {
    if (!target || target.readyState !== WebSocket.OPEN) return;
    const header = Buffer.allocUnsafe(BIN_HEADER);
    header[0] = op;
    header.writeUInt32LE(conn, 1);
    header.writeUInt32LE(userId, 5);
    target.send(data ? Buffer.concat([header, data]) : header);
  }

  function handleBinaryTunnel(ws: WebSocket, buf: Buffer, currentClient: ConnectedClient): void {
    if (!currentClient.connected || currentClient.ws !== ws) return;
    if (buf.length < BIN_HEADER) return;
    const op = buf[0];
    if (op < BIN_OP_OPEN || op > BIN_OP_CLOSE_ALL) return;
    const conn = buf.readUInt32LE(1);
    const userId = buf.readUInt32LE(5);
    const data = buf.length > BIN_HEADER ? buf.subarray(BIN_HEADER) : undefined;
    if (op === BIN_OP_DATA && (!data || data.length > MAX_TUNNEL_CHUNK)) return;

    const roomId = currentClient.room_id;
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room || room.game_session_status === 'relay_paused') return;

    if (currentClient.is_host) {
      if (!userId) return;
      const target = clients.get(userId);
      if (!target?.connected || target.room_id !== roomId || target.is_host) return;
      sendBinaryTunnel(target.ws, op, conn, 0, data);
    } else {
      const host = clients.get(room.host_user_id);
      if (!host?.connected || host.room_id !== roomId || !host.is_host) return;
      sendBinaryTunnel(host.ws, op, conn, currentClient.user_id, data);
    }
  }

  function send(ws: WebSocket | null | undefined, message: WSMessage): void {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ ...message, protocolVersion: PROTOCOL_VERSION }));
    }
  }

  function sendError(ws: WebSocket, error: string): void {
    send(ws, { type: WSMessageType.ERROR, payload: { error } });
  }

  function sendAuthError(ws: WebSocket, error: string): void {
    send(ws, { type: WSMessageType.AUTH_ERROR, payload: { error } });
  }

  function notifyRoomClients(roomId: string, message: WSMessage): void {
    for (const member of getConnectedClientsInRoom(roomId)) send(member.ws, message);
  }

  function broadcastRoomList(): void {
    const message: WSMessage = { type: WSMessageType.ROOM_LIST, payload: getRoomList() };
    for (const member of clients.values()) if (member.connected) send(member.ws, message);
  }

  function closeRoomAndNotify(roomId: string, reason: string): void {
    const members = getClientsInRoom(roomId);
    for (const member of members) {
      if (!member.connected) {
        expiredRoomByUser.set(member.user_id, roomId);
        setTimeout(() => expiredRoomByUser.delete(member.user_id), 10 * 60_000).unref?.();
      }
      if (member.disconnect_timer) clearTimeout(member.disconnect_timer);
      member.disconnect_timer = undefined;
      member.disconnect_deadline = undefined;
      member.room_id = undefined;
      member.is_host = false;
      send(member.ws, { type: WSMessageType.ROOM_CLOSED, payload: { roomId, reason } });
    }
    closeRoom(roomId);
    broadcastRoomList();
  }

  function maybeResumeRelay(roomId: string): void {    const room = rooms.get(roomId);
    if (!room || room.game_session_status !== 'relay_paused') return;
    const members = getClientsInRoom(roomId);
    if (members.some((member) => !member.connected)) return;
    const infoIsFresh = !!room.game_info_updated_at && Date.now() - room.game_info_updated_at <= GAMEINFO_MAX_AGE_MS;
    if (!infoIsFresh) roomGameInfo.delete(roomId);
    room.game_session_status = infoIsFresh ? 'available' : 'unavailable';
    notifyRoomClients(roomId, {
      type: WSMessageType.GAME_RELAY_RESUMED,
      payload: { roomId, gameSessionStatus: room.game_session_status },
    });
    const freshGameInfo = infoIsFresh ? roomGameInfo.get(roomId) : undefined;
    if (freshGameInfo) {
      for (const guest of getConnectedClientsInRoom(roomId)) {
        if (!guest.is_host) send(guest.ws, { type: WSMessageType.ROOM_GAMEINFO, payload: { data: freshGameInfo } });
      }
    }
  }

  function removeFromRoom(member: ConnectedClient, intentional = false): void {
    const roomId = member.room_id;
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room) {
      member.room_id = undefined;
      member.is_host = false;
      return;
    }

    if (room.host_user_id === member.user_id) {
      closeRoomAndNotify(roomId, intentional ? 'host_left' : 'host_timeout');
      return;
    }

    const username = member.username;
    const host = clients.get(room.host_user_id);
    if (host?.connected && host.room_id === roomId) {
      sendBinaryTunnel(host.ws, BIN_OP_CLOSE_ALL, 0, member.user_id);
    }
    leaveRoom(roomId, member.user_id);
    member.room_id = undefined;
    member.is_host = false;
    notifyRoomClients(roomId, {
      type: WSMessageType.ROOM_UPDATE,
      payload: { action: 'player_left', userId: member.user_id, username },
    });
    maybeResumeRelay(roomId);
    broadcastRoomList();
  }

  function markUnexpectedDisconnect(member: ConnectedClient): void {
    if (member.disconnect_timer) clearTimeout(member.disconnect_timer);
    member.connected = false;
    member.ws = null;
    member.disconnect_deadline = Date.now() + RECONNECT_GRACE_MS;

    const roomId = member.room_id;
    if (roomId) {
      const room = rooms.get(roomId);
      if (room && (room.game_session_status === 'available' || room.game_session_status === 'relay_paused')) {
        room.game_session_status = 'relay_paused';
        notifyRoomClients(roomId, {
          type: WSMessageType.GAME_RELAY_PAUSED,
          payload: {
            roomId, userId: member.user_id, username: member.username,
            isHost: member.is_host, reconnectDeadline: member.disconnect_deadline,
            gracePeriodMs: RECONNECT_GRACE_MS,
            disconnectedPlayers: getClientsInRoom(roomId).filter((entry) => !entry.connected).length,
          },
        });
      }
      notifyRoomClients(roomId, {
        type: WSMessageType.ROOM_UPDATE,
        payload: {
          action: 'player_disconnected', userId: member.user_id,
          username: member.username, reconnectDeadline: member.disconnect_deadline,
        },
      });
    }

    member.disconnect_timer = setTimeout(() => {
      if (clients.get(member.user_id) !== member || member.connected) return;
      if (member.room_id) {
        const expiredRoomId = member.room_id;
        removeFromRoom(member, false);
        expiredRoomByUser.set(member.user_id, expiredRoomId);
        setTimeout(() => expiredRoomByUser.delete(member.user_id), 10 * 60_000).unref?.();
      }
      clients.delete(member.user_id);
      broadcastRoomList();
    }, RECONNECT_GRACE_MS);
    broadcastRoomList();
  }

  function validBase64(value: unknown, maxLength: number): value is string {
    return typeof value === 'string' && value.length > 0 && value.length <= maxLength &&
      /^[A-Za-z0-9+/]*={0,2}$/.test(value) && value.length % 4 === 0;
  }

  async function handleMessage(
    ws: WebSocket,
    message: WSMessage,
    currentClient: ConnectedClient | null,
    setClient: (next: ConnectedClient) => void,
  ): Promise<void> {
    const { type, payload } = message;
    if (type !== WSMessageType.TUNNEL) {
      app.log.debug({ direction: 'client_to_server', type, protocolVersion: message.protocolVersion, payloadKeys: payload && typeof payload === 'object' ? Object.keys(payload) : [] }, 'WebSocket message');
    }

    if (type === WSMessageType.AUTH) {
      if (!payload || typeof payload.token !== 'string' || payload.token.length > 8192) {
        sendAuthError(ws, 'Invalid authentication payload');
        return;
      }
      try {
        const decoded = app.jwt.verify(payload.token) as AuthPayload;
        if (!Number.isInteger(decoded.userId) || typeof decoded.username !== 'string') throw new Error('Invalid token claims');

        let restored = clients.get(decoded.userId);
        const wasDisconnected = !!restored && !restored.connected;
        if (restored?.disconnect_timer) clearTimeout(restored.disconnect_timer);

        if (restored?.connected && restored.ws && restored.ws !== ws) {
          // A newer authenticated connection replaces the previous one.
          const oldSocket = restored.ws;
          restored.ws = ws;
          restored.connected = true;
          oldSocket.close(4001, 'replaced by a newer session');
        } else if (restored) {
          restored.ws = ws;
          restored.connected = true;
        } else {
          restored = {
            user_id: decoded.userId, username: decoded.username,
            ws, is_host: false, connected: true,
          };
          clients.set(decoded.userId, restored);
        }
        restored.disconnect_timer = undefined;
        restored.disconnect_deadline = undefined;
        setClient(restored);
        send(ws, { type: WSMessageType.AUTH_SUCCESS, payload: { username: restored.username } });
        const expiredRoomId = expiredRoomByUser.get(restored.user_id);
        if (expiredRoomId) {
          expiredRoomByUser.delete(restored.user_id);
          send(ws, { type: WSMessageType.ROOM_CLOSED, payload: { roomId: expiredRoomId, reason: 'reconnect_timeout' } });
        }

        if (restored.room_id) {
          const room = rooms.get(restored.room_id);
          if (room) {
            const info = roomGameInfo.get(room.id);
            const freshInfo = info && room.game_info_updated_at && Date.now() - room.game_info_updated_at <= GAMEINFO_MAX_AGE_MS
              ? info : undefined;
            send(ws, {
              type: WSMessageType.ROOM_RESTORED,
              payload: {
                room, role: restored.is_host ? 'host' : 'guest', game_info: freshInfo,
                members: getClientsInRoom(room.id).map((m) => ({ userId: m.user_id, username: m.username })),
              },
            });
            // Отправить сообщения которые пришли пока пользователь был в комнате (включая disconnect)
            const userJoinedAt = roomChatJoinedAt.get(room.id)?.get(restored.user_id) ?? 0;
            const missed = (roomChat.get(room.id) ?? []).filter((m) => m.ts > userJoinedAt);
            if (missed.length > 0) {
              send(ws, { type: WSMessageType.CHAT_HISTORY, payload: { messages: missed } });
            }
            notifyRoomClients(room.id, {
              type: WSMessageType.ROOM_UPDATE,
              payload: { action: 'player_reconnected', userId: restored.user_id, username: restored.username },
            });
            if (wasDisconnected) maybeResumeRelay(room.id);
          } else {
            restored.room_id = undefined;
            restored.is_host = false;
          }
        }
        broadcastRoomList();
      } catch {
        sendAuthError(ws, 'Invalid or expired token');
      }
      return;
    }

    if (!currentClient || !currentClient.connected || currentClient.ws !== ws) {
      sendError(ws, 'Authentication required');
      return;
    }

    switch (type) {
      case WSMessageType.CREATE_ROOM: {
        if (!payload || typeof payload.name !== 'string' || payload.name.trim().length < 1 || payload.name.length > 64 ||
            typeof payload.map !== 'string' || payload.map.trim().length < 1 || payload.map.length > 128 ||
            !Number.isInteger(payload.maxPlayers) || payload.maxPlayers < 2 || payload.maxPlayers > 12) {
          sendError(ws, 'Invalid create_room payload'); return;
        }
        if (currentClient.room_id) removeFromRoom(currentClient, true);
        const room = createRoom(payload.name.trim(), payload.map.trim(), currentClient.user_id, payload.maxPlayers);
        currentClient.room_id = room.id;
        currentClient.is_host = true;
        // Хост тоже участник чата — фиксируем время входа
        if (!roomChatJoinedAt.has(room.id)) roomChatJoinedAt.set(room.id, new Map());
        roomChatJoinedAt.get(room.id)!.set(currentClient.user_id, room.created_at);
        send(ws, { type: WSMessageType.ROOM_CREATED, payload: room });
        broadcastRoomList();
        break;
      }
      case WSMessageType.JOIN_ROOM: {
        if (!payload || typeof payload.roomId !== 'string' || payload.roomId.length > 64) {
          sendError(ws, 'Invalid join_room payload'); return;
        }
        if (currentClient.room_id) removeFromRoom(currentClient, true);
        const room = joinRoom(payload.roomId);
        if (!room) { sendError(ws, 'Room not found or full'); return; }
        currentClient.room_id = room.id;
        currentClient.is_host = false;
        // Запомнить момент входа, чтобы при reconnect отправить пропущенные сообщения
        if (!roomChatJoinedAt.has(room.id)) roomChatJoinedAt.set(room.id, new Map());
        roomChatJoinedAt.get(room.id)!.set(currentClient.user_id, Date.now());
        const info = roomGameInfo.get(room.id);
        const freshInfo = info && room.game_info_updated_at && Date.now() - room.game_info_updated_at <= GAMEINFO_MAX_AGE_MS
          ? info : undefined;
        const members = getClientsInRoom(room.id).map((m) => ({ userId: m.user_id, username: m.username }));
        send(ws, { type: WSMessageType.ROOM_JOINED, payload: { ...room, game_info: freshInfo, members } });
        notifyRoomClients(room.id, {
          type: WSMessageType.ROOM_UPDATE,
          payload: { action: 'player_joined', userId: currentClient.user_id, username: currentClient.username },
        });
        broadcastRoomList();
        break;
      }
      case WSMessageType.LEAVE_ROOM:
        removeFromRoom(currentClient, true);
        break;
      case WSMessageType.ROOM_LIST:
        send(ws, { type: WSMessageType.ROOM_LIST, payload: getRoomList() });
        break;
      case WSMessageType.ROOM_GAMEINFO: {
        if (!currentClient.room_id || !currentClient.is_host || !payload || !validBase64(payload.data, MAX_GAMEINFO_BASE64)) {
          sendError(ws, 'Invalid room_gameinfo payload or host role'); return;
        }
        const packet = Buffer.from(payload.data, 'base64');
        if (packet.length < 42 || packet.length > 3072 || packet[0] !== 0xf7 || packet[1] !== 0x30 || packet.readUInt16LE(2) !== packet.length || packet.readUInt32LE(8) !== 26) {
          sendError(ws, 'Invalid W3GS GAMEINFO packet'); return;
        }
        const room = rooms.get(currentClient.room_id);
        if (!room) return;
        roomGameInfo.set(room.id, payload.data);
        room.game_info_updated_at = Date.now();
        const hasDisconnectedMember = getClientsInRoom(room.id).some((member) => !member.connected);
        room.game_session_status = hasDisconnectedMember ? 'relay_paused' : 'available';
        if (room.game_session_status === 'available') {
          for (const guest of getConnectedClientsInRoom(room.id)) {
            if (!guest.is_host) send(guest.ws, { type: WSMessageType.ROOM_GAMEINFO, payload: { data: payload.data } });
          }
        }
        break;
      }
      case WSMessageType.ROOM_GAMEINFO_LOST: {
        if (!currentClient.room_id || !currentClient.is_host) { sendError(ws, 'Host role required'); return; }
        const room = rooms.get(currentClient.room_id);
        if (!room) return;
        roomGameInfo.delete(room.id);
        room.game_info_updated_at = undefined;
        room.game_session_status = getClientsInRoom(room.id).some((member) => !member.connected) ? 'relay_paused' : 'unavailable';
        notifyRoomClients(room.id, { type: WSMessageType.ROOM_GAMEINFO_LOST, payload: { roomId: room.id } });
        break;
      }
      case WSMessageType.GAME_ENDED: {
        if (!currentClient.room_id || !currentClient.is_host) { sendError(ws, 'Host role required'); return; }
        const room = rooms.get(currentClient.room_id);
        if (!room) return;
        const roomId = room.id;
        notifyRoomClients(roomId, { type: WSMessageType.GAME_ENDED, payload: { roomId } });
        setTimeout(() => {
          closeRoomAndNotify(roomId, 'game_ended');
        }, 10_000);
        break;
      }
      case WSMessageType.CHAT_MESSAGE: {
        if (!currentClient.room_id) { sendError(ws, 'You are not in a room'); return; }
        const text = typeof payload?.text === 'string' ? payload.text.trim() : '';
        if (!text || text.length > CHAT_MAX_LENGTH) { sendError(ws, 'Invalid chat message'); return; }
        const roomId = currentClient.room_id;
        const room = rooms.get(roomId);
        if (!room) return;
        const history = roomChat.get(roomId) ?? [];
        history.push({ userId: currentClient.user_id, username: currentClient.username, text, ts: Date.now() });
        if (history.length > CHAT_MAX_MESSAGES) history.splice(0, history.length - CHAT_MAX_MESSAGES);
        roomChat.set(roomId, history);
        notifyRoomClients(roomId, {
          type: WSMessageType.CHAT_MESSAGE,
          payload: { userId: currentClient.user_id, username: currentClient.username, text, ts: Date.now() },
        });
        break;
      }
      case WSMessageType.PING: {
        if (typeof payload?.ts !== 'number') { sendError(ws, 'Invalid ping payload'); return; }
        send(ws, { type: WSMessageType.PONG, payload: { ts: payload.ts } });
        break;
      }
      default:
        sendError(ws, `Unknown message type: ${type}`);
    }
  }
}
