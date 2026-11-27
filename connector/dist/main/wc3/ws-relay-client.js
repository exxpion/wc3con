"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WSRelayClient = exports.WS_PROTOCOL_VERSION = void 0;
const ws_1 = require("ws");
const types_js_1 = require("../types.js");
const protocol_1 = require("./protocol");
exports.WS_PROTOCOL_VERSION = 1;
// Binary tunnel frame: [1 op][4 conn LE][4 userId LE][data?]
const BIN_OP = { open: 1, data: 2, close: 3, close_all: 4 };
const BIN_OP_TO_STR = { 1: 'open', 2: 'data', 3: 'close', 4: 'close_all' };
const BIN_HEADER = 9;
const MAX_QUEUED_TUNNEL_BYTES = 8 * 1024 * 1024;
class WSRelayClient {
    options;
    ws = null;
    reconnectTimeout = null;
    reconnectGraceTimeout = null;
    isConnecting = false;
    stopped = false;
    authenticated = false;
    currentRoomId = null;
    pendingLeave = false;
    relayPaused = false;
    tunnelQueue = [];
    queuedTunnelBytes = 0;
    reportedUnknownTypes = new Set();
    constructor(options) {
        this.options = options;
    }
    connect() {
        if (this.ws || this.isConnecting || this.stopped)
            return;
        this.isConnecting = true;
        console.log(`[WS] connecting to ${this.options.serverUrl}`);
        const ws = new ws_1.WebSocket(this.options.serverUrl);
        this.ws = ws;
        ws.on('open', () => {
            this.isConnecting = false;
            this.sendRaw({ type: types_js_1.WSMessageType.AUTH, payload: { token: this.options.token } });
        });
        ws.on('message', (data, isBinary) => {
            try {
                const raw = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data);
                if (isBinary) {
                    this.handleBinaryMessage(raw);
                    return;
                }
                const message = JSON.parse(raw.toString('utf8'));
                if (!message || typeof message !== 'object' || typeof message.type !== 'string') {
                    throw new Error('Malformed server message');
                }
                this.handleMessage(message);
            }
            catch (err) {
                console.error('[WS] rejected server message:', err);
                this.options.onError(err instanceof Error ? err.message : 'Invalid server message');
            }
        });
        ws.on('close', (code) => {
            this.isConnecting = false;
            this.authenticated = false;
            if (this.ws === ws)
                this.ws = null;
            if (code === 4001) {
                this.stopped = true;
                this.currentRoomId = null;
                if (this.reconnectGraceTimeout)
                    clearTimeout(this.reconnectGraceTimeout);
                this.reconnectGraceTimeout = null;
                this.options.onError('This account is connected from another connector instance');
                return;
            }
            if (this.stopped)
                return;
            if (this.currentRoomId && !this.reconnectGraceTimeout) {
                this.reconnectGraceTimeout = setTimeout(() => {
                    this.reconnectGraceTimeout = null;
                    if (!this.authenticated && this.currentRoomId) {
                        this.currentRoomId = null;
                        this.relayPaused = false;
                        this.tunnelQueue = [];
                        this.queuedTunnelBytes = 0;
                        this.options.onReconnectExpired?.();
                    }
                }, 180_000);
            }
            // Keep currentRoomId and local TCP sockets: the server retains the room for 180s.
            this.options.onDisconnected();
            this.scheduleReconnect();
        });
        ws.on('error', (err) => {
            console.error('[WS] error:', err.message);
            this.isConnecting = false;
        });
    }
    disconnect() {
        this.stopped = true;
        this.authenticated = false;
        if (this.reconnectGraceTimeout)
            clearTimeout(this.reconnectGraceTimeout);
        this.reconnectGraceTimeout = null;
        if (this.reconnectTimeout)
            clearTimeout(this.reconnectTimeout);
        this.reconnectTimeout = null;
        const ws = this.ws;
        this.ws = null;
        this.currentRoomId = null;
        this.pendingLeave = false;
        this.relayPaused = false;
        this.tunnelQueue = [];
        this.queuedTunnelBytes = 0;
        ws?.close(1000, 'client logout');
    }
    createRoom(name, map, maxPlayers = 12) {
        return this.send({ type: types_js_1.WSMessageType.CREATE_ROOM, payload: { name, map, maxPlayers } });
    }
    joinRoom(roomId) {
        return this.send({ type: types_js_1.WSMessageType.JOIN_ROOM, payload: { roomId } });
    }
    leaveRoom() {
        if (!this.currentRoomId)
            return;
        if (this.send({ type: types_js_1.WSMessageType.LEAVE_ROOM, payload: {} })) {
            this.currentRoomId = null;
            this.pendingLeave = false;
            this.relayPaused = false;
            this.tunnelQueue = [];
            this.queuedTunnelBytes = 0;
        }
        else {
            // The user explicitly left while offline. Complete the leave after auth/room restore.
            this.pendingLeave = true;
            this.relayPaused = false;
            this.tunnelQueue = [];
            this.queuedTunnelBytes = 0;
        }
    }
    requestRoomList() {
        this.send({ type: types_js_1.WSMessageType.ROOM_LIST, payload: {} });
    }
    sendGameInfo(packet) {
        this.send({ type: types_js_1.WSMessageType.ROOM_GAMEINFO, payload: { data: packet.toString('base64') } });
    }
    sendGameInfoLost() {
        this.send({ type: types_js_1.WSMessageType.ROOM_GAMEINFO_LOST, payload: {} });
    }
    sendGameEnded() {
        this.send({ type: types_js_1.WSMessageType.GAME_ENDED, payload: {} });
    }
    sendTunnel(msg) {
        const frame = this.buildBinaryFrame(msg);
        const size = frame.length;
        if (this.relayPaused || !this.authenticated || !this.sendBinaryFrame(frame)) {
            if (this.queuedTunnelBytes + size > MAX_QUEUED_TUNNEL_BYTES) {
                this.options.onError('Relay reconnect buffer is full; a game connection may be lost');
                return;
            }
            this.tunnelQueue.push(frame);
            this.queuedTunnelBytes += size;
        }
    }
    isConnected() {
        return this.authenticated && this.ws !== null && this.ws.readyState === ws_1.WebSocket.OPEN;
    }
    buildBinaryFrame(msg) {
        const op = BIN_OP[msg.op];
        const header = Buffer.allocUnsafe(BIN_HEADER);
        header[0] = op;
        header.writeUInt32LE(msg.conn, 1);
        header.writeUInt32LE(msg.to ?? msg.from ?? 0, 5);
        return msg.data ? Buffer.concat([header, msg.data]) : header;
    }
    sendBinaryFrame(frame) {
        if (!this.ws || this.ws.readyState !== ws_1.WebSocket.OPEN)
            return false;
        this.ws.send(frame);
        return true;
    }
    handleBinaryMessage(buf) {
        if (buf.length < BIN_HEADER)
            return;
        const op = buf[0];
        const tunnelOp = BIN_OP_TO_STR[op];
        if (!tunnelOp)
            return;
        const conn = buf.readUInt32LE(1);
        const userId = buf.readUInt32LE(5);
        const data = buf.length > BIN_HEADER ? buf.subarray(BIN_HEADER) : undefined;
        this.options.onTunnel({
            from: userId || undefined,
            conn,
            op: tunnelOp,
            data,
        });
    }
    sendRaw(message) {
        if (this.ws?.readyState !== ws_1.WebSocket.OPEN)
            return false;
        this.ws.send(JSON.stringify({ ...message, protocolVersion: exports.WS_PROTOCOL_VERSION }));
        return true;
    }
    send(message) {
        if (!this.authenticated)
            return false;
        return this.sendRaw(message);
    }
    flushTunnelQueue() {
        if (!this.authenticated || this.relayPaused)
            return;
        const pending = this.tunnelQueue;
        this.tunnelQueue = [];
        this.queuedTunnelBytes = 0;
        for (let i = 0; i < pending.length; i++) {
            if (!this.sendBinaryFrame(pending[i])) {
                const remainder = pending.slice(i);
                this.tunnelQueue.push(...remainder);
                this.queuedTunnelBytes += remainder.reduce((sum, f) => sum + f.length, 0);
                break;
            }
        }
    }
    decodeBase64(value, maxEncodedLength) {
        if (typeof value !== 'string' || value.length > maxEncodedLength || !/^[A-Za-z0-9+/]*={0,2}$/.test(value))
            return null;
        const packet = Buffer.from(value, 'base64');
        return packet.length > 0 ? packet : null;
    }
    handleMessage(message) {
        const { type, payload } = message;
        switch (type) {
            case types_js_1.WSMessageType.AUTH_SUCCESS:
                this.authenticated = true;
                if (this.reconnectGraceTimeout)
                    clearTimeout(this.reconnectGraceTimeout);
                this.reconnectGraceTimeout = null;
                this.options.onConnected();
                this.requestRoomList();
                break;
            case types_js_1.WSMessageType.AUTH_ERROR:
                this.options.onError(payload?.error || 'Authentication failed');
                this.disconnect();
                break;
            case types_js_1.WSMessageType.ROOM_CREATED:
                if (typeof payload?.id !== 'string')
                    return;
                this.currentRoomId = payload.id;
                this.options.onRoomCreated(payload.id, payload);
                break;
            case types_js_1.WSMessageType.ROOM_JOINED: {
                if (typeof payload?.id !== 'string')
                    return;
                this.currentRoomId = payload.id;
                this.relayPaused = payload.game_session_status === 'relay_paused';
                if (!this.relayPaused)
                    this.flushTunnelQueue();
                this.options.onRoomJoined(payload.id, payload, this.decodeBase64(payload.game_info, 4096));
                break;
            }
            case types_js_1.WSMessageType.ROOM_RESTORED: {
                if (typeof payload?.room?.id !== 'string')
                    return;
                this.currentRoomId = payload.room.id;
                this.relayPaused = payload.room.game_session_status === 'relay_paused';
                if (this.pendingLeave) {
                    this.pendingLeave = false;
                    this.relayPaused = false;
                    this.send({ type: types_js_1.WSMessageType.LEAVE_ROOM, payload: {} });
                    this.currentRoomId = null;
                    break;
                }
                if (!this.relayPaused)
                    this.flushTunnelQueue();
                this.options.onRoomRestored?.(payload.room.id, payload.room, this.decodeBase64(payload.game_info, 4096));
                break;
            }
            case types_js_1.WSMessageType.ROOM_CLOSED:
                this.currentRoomId = null;
                this.pendingLeave = false;
                this.relayPaused = false;
                this.tunnelQueue = [];
                this.queuedTunnelBytes = 0;
                this.options.onRoomClosed();
                break;
            case types_js_1.WSMessageType.ROOM_LIST:
                if (Array.isArray(payload))
                    this.options.onRoomList(payload);
                break;
            case types_js_1.WSMessageType.ROOM_UPDATE:
                this.requestRoomList();
                break;
            case types_js_1.WSMessageType.ROOM_GAMEINFO: {
                const packet = this.decodeBase64(payload?.data, 4096);
                if (packet && (0, protocol_1.parseGameInfo)(packet))
                    this.options.onGameInfo(packet);
                break;
            }
            case types_js_1.WSMessageType.ROOM_GAMEINFO_LOST:
                this.options.onGameInfoLost?.();
                break;
            case types_js_1.WSMessageType.GAME_ENDED:
                this.options.onGameEnded?.();
                break;
            case types_js_1.WSMessageType.GAME_RELAY_PAUSED:
                this.relayPaused = true;
                this.options.onRelayState?.('paused', payload);
                break;
            case types_js_1.WSMessageType.GAME_RELAY_RESUMED:
                this.relayPaused = false;
                this.flushTunnelQueue();
                this.options.onRelayState?.('resumed', payload);
                break;
            case types_js_1.WSMessageType.ERROR:
                this.options.onError(payload?.error || 'Relay server error');
                break;
            default:
                if (!this.reportedUnknownTypes.has(type)) {
                    this.reportedUnknownTypes.add(type);
                    console.error('[WS] unknown server message type:', type, 'payload keys:', payload && typeof payload === 'object' ? Object.keys(payload) : []);
                    this.options.onError(`Unknown relay message type: ${type} (see client logs)`);
                }
        }
    }
    scheduleReconnect() {
        if (this.stopped || this.reconnectTimeout)
            return;
        this.reconnectTimeout = setTimeout(() => {
            this.reconnectTimeout = null;
            this.connect();
        }, 3000);
    }
}
exports.WSRelayClient = WSRelayClient;
//# sourceMappingURL=ws-relay-client.js.map