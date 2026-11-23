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
} from '../game/rooms.js';

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
        if (client.room_id) {
          leaveRoom(client.room_id, client.user_id);
          broadcastRoomList();
        }
        clients.delete(client.user_id);
      }
    });
  });

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
        const { roomId } = payload;
        const room = joinRoom(roomId);
        if (!room) {
          return sendError(ws, 'Room not found or full');
        }
        client.room_id = roomId;
        send(ws, { type: WSMessageType.ROOM_JOINED, payload: room });
        broadcastRoomList();
        notifyRoomClients(roomId, {
          type: WSMessageType.ROOM_UPDATE,
          payload: { action: 'player_joined', username: client.username },
        });
        break;
      }

      case WSMessageType.LEAVE_ROOM: {
        if (!client || !client.room_id) return;
        const roomId = client.room_id;
        leaveRoom(roomId, client.user_id);
        client.room_id = undefined;
        client.is_host = false;
        broadcastRoomList();
        notifyRoomClients(roomId, {
          type: WSMessageType.ROOM_UPDATE,
          payload: { action: 'player_left', username: client.username },
        });
        break;
      }

      case WSMessageType.ROOM_LIST: {
        const roomList = getRoomList();
        send(ws, { type: WSMessageType.ROOM_LIST, payload: roomList });
        break;
      }

      case WSMessageType.GAME_DATA: {
        if (!client || !client.room_id) return;
        // Relay game data to all other clients in the room
        const roomClients = getClientsInRoom(client.room_id);
        roomClients.forEach((c) => {
          if (c.user_id !== client.user_id) {
            send(c.ws, {
              type: WSMessageType.GAME_DATA,
              payload: { from: client.username, data: payload.data },
            });
          }
        });
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
