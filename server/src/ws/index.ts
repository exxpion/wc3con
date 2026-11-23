import { WebSocketServer, WebSocket } from 'ws';
import { FastifyInstance } from 'fastify';
import { IncomingMessage } from 'http';
import {
  WSMessage,
  WSMessageType,
  ConnectedClient,
  AuthPayload,
} from '../types/index.js';
import {
  createRoom,
  joinRoom,
  leaveRoom,
  getRoomList,
  getClientsInRoom,
  clients,
  rooms,
  roomGameInfo,
} from '../game/rooms.js';

// Защита от мусора: один кусок туннельного трафика не больше ~512 КБ (base64)
const MAX_TUNNEL_CHUNK = 700_000;

export function setupWebSocketServer(app: FastifyInstance) {
  const wss = new WebSocketServer({ noServer: true });

  app.server.on('upgrade', (request: IncomingMessage, socket, head) => {
    if (request.url === '/ws') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    } else {
      socket.destroy();
    }
  });

  wss.on('connection', (ws: WebSocket) => {
    let client: ConnectedClient | null = null;

    ws.on('message', async (data: Buffer) => {
      try {
        const message: WSMessage = JSON.parse(data.toString());
        await handleMessage(ws, message, client, (newClient) => {
          client = newClient;
        });
      } catch (err) {
        sendError(ws, 'Invalid message format');
      }
    });

    ws.on('close', () => {
      if (client) {
        removeFromRoom(client);
        // Не удаляем запись, если за это время тот же пользователь уже вошёл с другого соединения
        if (clients.get(client.user_id) === client) {
          clients.delete(client.user_id);
        }
      }
    });
  });

  /** Убрать клиента из его комнаты и корректно уведомить остальных */
  function removeFromRoom(client: ConnectedClient) {
    const roomId = client.room_id;
    if (!roomId) return;

    const room = rooms.get(roomId);
    const wasHost = !!room && room.host_user_id === client.user_id;
    const others = getClientsInRoom(roomId).filter((c) => c.user_id !== client.user_id);

    leaveRoom(roomId, client.user_id);
    client.room_id = undefined;
    client.is_host = false;

    if (wasHost) {
      // Хост ушёл — комната удалена, гостей выводим
      others.forEach((c) => {
        c.room_id = undefined;
        c.is_host = false;
        send(c.ws, { type: WSMessageType.ROOM_CLOSED, payload: { roomId } });
      });
    } else if (room) {
      // Гость ушёл — хост должен закрыть все его туннели к своему WC3
      const host = clients.get(room.host_user_id);
      if (host && host.room_id === roomId) {
        send(host.ws, {
          type: WSMessageType.TUNNEL,
          payload: { from: client.user_id, conn: 0, op: 'close_all' },
        });
      }
      notifyRoomClients(roomId, {
        type: WSMessageType.ROOM_UPDATE,
        payload: { action: 'player_left', username: client.username },
      });
    }

    broadcastRoomList();
  }

  async function handleMessage(
    ws: WebSocket,
    message: WSMessage,
    client: ConnectedClient | null,
    setClient: (c: ConnectedClient) => void
  ) {
    const { type, payload } = message;

    // Auth required for most messages
    if (type !== WSMessageType.AUTH && !client) {
      return sendError(ws, 'Authentication required');
    }

    switch (type) {
      case WSMessageType.AUTH: {
        const { token } = payload;
        try {
          const decoded = app.jwt.verify(token) as AuthPayload;
          const newClient: ConnectedClient = {
            user_id: decoded.userId,
            username: decoded.username,
            ws,
            is_host: false,
          };
          clients.set(decoded.userId, newClient);
          setClient(newClient);
          send(ws, { type: WSMessageType.AUTH_SUCCESS, payload: { username: decoded.username } });
        } catch (err) {
          sendError(ws, 'Invalid token');
        }
        break;
      }

      case WSMessageType.CREATE_ROOM: {
        if (!client) return;
        if (client.room_id) removeFromRoom(client);
        const { name, map, maxPlayers } = payload;
        const room = createRoom(name, map, client.user_id, maxPlayers);
        client.room_id = room.id;
        client.is_host = true;
        send(ws, { type: WSMessageType.ROOM_CREATED, payload: room });
        broadcastRoomList();
        break;
      }

      case WSMessageType.JOIN_ROOM: {
        if (!client) return;
        if (client.room_id) removeFromRoom(client);
        const { roomId } = payload;
        const room = joinRoom(roomId);
        if (!room) {
          return sendError(ws, 'Room not found or full');
        }
        client.room_id = roomId;
        // вместе с комнатой отдаём GAMEINFO игры хоста (если хост уже создал игру в WC3)
        send(ws, {
          type: WSMessageType.ROOM_JOINED,
          payload: { ...room, game_info: roomGameInfo.get(roomId) },
        });
        broadcastRoomList();
        notifyRoomClients(roomId, {
          type: WSMessageType.ROOM_UPDATE,
          payload: { action: 'player_joined', username: client.username },
        });
        break;
      }

      case WSMessageType.LEAVE_ROOM: {
        if (!client || !client.room_id) return;
        removeFromRoom(client);
        break;
      }

      case WSMessageType.ROOM_LIST: {
        const roomList = getRoomList();
        send(ws, { type: WSMessageType.ROOM_LIST, payload: roomList });
        break;
      }

      // Хост присылает GAMEINFO своей игры WC3 -> запоминаем и рассылаем гостям
      case WSMessageType.ROOM_GAMEINFO: {
        if (!client || !client.room_id || !client.is_host) return;
        if (typeof payload?.data !== 'string' || payload.data.length > 4096) return;
        roomGameInfo.set(client.room_id, payload.data);
        getClientsInRoom(client.room_id).forEach((c) => {
          if (c.user_id !== client.user_id) {
            send(c.ws, { type: WSMessageType.ROOM_GAMEINFO, payload: { data: payload.data } });
          }
        });
        break;
      }

      // TCP-туннель: гость -> хост (to не нужен) и хост -> конкретный гость (to = user_id гостя)
      case WSMessageType.TUNNEL: {
        if (!client || !client.room_id) return;
        if (!payload || typeof payload.conn !== 'number') return;
        if (typeof payload.data === 'string' && payload.data.length > MAX_TUNNEL_CHUNK) return;

        const room = rooms.get(client.room_id);
        if (!room) return;

        if (client.is_host) {
          const target = typeof payload.to === 'number' ? clients.get(payload.to) : undefined;
          if (!target || target.room_id !== client.room_id) return;
          send(target.ws, {
            type: WSMessageType.TUNNEL,
            payload: { conn: payload.conn, op: payload.op, data: payload.data },
          });
        } else {
          const host = clients.get(room.host_user_id);
          if (!host || host.room_id !== client.room_id) return;
          send(host.ws, {
            type: WSMessageType.TUNNEL,
            payload: { from: client.user_id, conn: payload.conn, op: payload.op, data: payload.data },
          });
        }
        break;
      }

      default:
        sendError(ws, 'Unknown message type');
    }
  }

  function send(ws: WebSocket, message: WSMessage) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  function sendError(ws: WebSocket, error: string) {
    send(ws, { type: WSMessageType.ERROR, payload: { error } });
  }

  function broadcastRoomList() {
    const roomList = getRoomList();
    const message = { type: WSMessageType.ROOM_LIST, payload: roomList };
    clients.forEach((client) => {
      send(client.ws, message);
    });
  }

  function notifyRoomClients(roomId: string, message: WSMessage) {
    const roomClients = getClientsInRoom(roomId);
    roomClients.forEach((client) => {
      send(client.ws, message);
    });
  }
}
