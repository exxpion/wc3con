import { WebSocket } from 'ws';

export type TunnelOp = 'open' | 'data' | 'close' | 'close_all';

export interface TunnelMessage {
  /** от кого (сервер заполняет для сообщений, идущих к хосту) */
  from?: number;
  /** кому (заполняет хост для сообщений, идущих к гостю) */
  to?: number;
  conn: number;
  op: TunnelOp;
  data?: Buffer;
}

export interface WSClientOptions {
  serverUrl: string;
  token: string;
  onConnected: () => void;
  onDisconnected: () => void;
  onRoomCreated: (roomId: string, room: any) => void;
  onRoomJoined: (roomId: string, room: any, gameInfo: Buffer | null) => void;
  onRoomClosed: () => void;
  onRoomList: (rooms: any[]) => void;
  /** хост прислал свежий GAMEINFO своей игры (для гостей) */
  onGameInfo: (gameInfo: Buffer) => void;
  /** туннельный трафик: гость -> хост (есть from) или хост -> гость */
  onTunnel: (msg: TunnelMessage) => void;
  onError: (error: string) => void;
}

export class WSRelayClient {
  private ws: WebSocket | null = null;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private isConnecting = false;
  private stopped = false;
  private currentRoomId: string | null = null;

  constructor(private options: WSClientOptions) {}

  connect(): void {
    if (this.ws || this.isConnecting) return;

    this.isConnecting = true;
    console.log(`Connecting to ${this.options.serverUrl}...`);
    const ws = new WebSocket(this.options.serverUrl);
    this.ws = ws;

    ws.on('open', () => {
      this.isConnecting = false;
      this.send({ type: 'auth', payload: { token: this.options.token } });
    });

    ws.on('message', (data: Buffer) => {
      try {
        this.handleMessage(JSON.parse(data.toString()));
      } catch (err) {
        console.error('Failed to handle message:', err);
      }
    });

    ws.on('close', () => {
      this.isConnecting = false;
      if (this.ws === ws) this.ws = null;
      this.currentRoomId = null;
      this.options.onDisconnected();
      this.scheduleReconnect();
    });

    ws.on('error', (err) => {
      console.error('WebSocket error:', err);
      this.isConnecting = false;
    });
  }

  disconnect(): void {
    this.stopped = true;
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    this.ws?.close();
    this.ws = null;
    this.currentRoomId = null;
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

  /** Хост: отправить GAMEINFO своей игры */
  sendGameInfo(packet: Buffer): void {
    this.send({ type: 'room_gameinfo', payload: { data: packet.toString('base64') } });
  }

  /** Отправить кусок туннельного трафика */
  sendTunnel(msg: TunnelMessage): void {
    this.send({
      type: 'tunnel',
      payload: {
        to: msg.to,
        conn: msg.conn,
        op: msg.op,
        data: msg.data ? msg.data.toString('base64') : undefined,
      },
    });
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
        this.options.onRoomJoined(
          payload.id,
          payload,
          payload.game_info ? Buffer.from(payload.game_info, 'base64') : null
        );
        break;

      case 'room_closed':
        this.currentRoomId = null;
        this.options.onRoomClosed();
        break;

      case 'room_list':
        this.options.onRoomList(payload);
        break;

      case 'room_update':
        this.requestRoomList();
        break;

      case 'room_gameinfo':
        this.options.onGameInfo(Buffer.from(payload.data, 'base64'));
        break;

      case 'tunnel':
        this.options.onTunnel({
          from: payload.from,
          conn: payload.conn,
          op: payload.op,
          data: payload.data ? Buffer.from(payload.data, 'base64') : undefined,
        });
        break;

      case 'error':
        this.options.onError(payload.error);
        break;

      default:
        console.warn('Unknown message type:', type);
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimeout) return;
    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      this.connect();
    }, 5000);
  }
}
