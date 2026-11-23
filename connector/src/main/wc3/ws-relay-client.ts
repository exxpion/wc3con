import { WebSocket } from 'ws';
import * as net from 'net';

export interface WSClientOptions {
  serverUrl: string;
  token: string;
  onConnected: () => void;
  onDisconnected: () => void;
  onRoomCreated: (roomId: string, room: any) => void;
  onRoomJoined: (roomId: string, room: any) => void;
  onRoomList: (rooms: any[]) => void;
  onGameData: (data: Buffer) => void;
  onError: (error: string) => void;
}

export class WSRelayClient {
  private ws: WebSocket | null = null;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private isConnecting = false;
  private currentRoomId: string | null = null;
  private socketToRoom = new Map<net.Socket, string>();

  constructor(private options: WSClientOptions) {}

  connect(): void {
    if (this.ws || this.isConnecting) return;

    this.isConnecting = true;
    console.log(`Connecting to ${this.options.serverUrl}...`);
    this.ws = new WebSocket(this.options.serverUrl);

    this.ws.on('open', () => {
      this.isConnecting = false;
      this.send({ type: 'auth', payload: { token: this.options.token } });
    });

    this.ws.on('message', (data: Buffer) => {
      try {
        this.handleMessage(JSON.parse(data.toString()));
      } catch (err) {
        console.error('Failed to parse message:', err);
      }
    });

    this.ws.on('close', () => {
      this.isConnecting = false;
      this.ws = null;
      this.options.onDisconnected();
      this.scheduleReconnect();
    });

    this.ws.on('error', (err) => {
      console.error('WebSocket error:', err);
      this.isConnecting = false;
    });
  }

  disconnect(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    this.ws?.close();
    this.ws = null;
    this.currentRoomId = null;
    this.socketToRoom.clear();
  }

  createRoom(name: string, map: string, maxPlayers = 12): void {
    this.send({ type: 'create_room', payload: { name, map, maxPlayers } });
  }

  joinRoom(roomId: string): void {
    this.send({ type: 'join_room', payload: { roomId } });
  }

  leaveRoom(): void {
    if (this.currentRoomId) {
      this.send({ type: 'leave_room' });
      this.currentRoomId = null;
    }
  }

  requestRoomList(): void {
    this.send({ type: 'room_list' });
  }

  sendGameData(data: Buffer, _socket: net.Socket): void {
    if (!this.currentRoomId) return;
    this.send({ type: 'game_data', payload: { data: data.toString('base64') } });
  }

  registerSocket(socket: net.Socket, roomId: string): void {
    this.socketToRoom.set(socket, roomId);
  }

  unregisterSocket(socket: net.Socket): void {
    this.socketToRoom.delete(socket);
  }

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  private send(message: any): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  private handleMessage(message: any): void {
    const { type, payload } = message;

    switch (type) {
      case 'auth_success':
        this.options.onConnected();
        this.requestRoomList();
        break;

      case 'auth_error':
        this.options.onError(payload.error);
        break;

      case 'room_created':
        this.currentRoomId = payload.id;
        this.options.onRoomCreated(payload.id, payload);
        break;

      case 'room_joined':
        this.currentRoomId = payload.id;
        this.options.onRoomJoined(payload.id, payload);
        break;

      case 'room_list':
        this.options.onRoomList(payload);
        break;

      case 'room_update':
        // Re-request list to get fresh player count
        this.requestRoomList();
        break;

      case 'game_data':
        this.options.onGameData(Buffer.from(payload.data, 'base64'));
        break;

      case 'error':
        this.options.onError(payload.error);
        break;

      default:
        console.warn('Unknown message type:', type);
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimeout) return;
    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      this.connect();
    }, 5000);
  }
}
