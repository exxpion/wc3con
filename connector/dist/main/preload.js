"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
electron_1.contextBridge.exposeInMainWorld('connector', {
    // ── Auth ──────────────────────────────────────────────────────────────────
    registerStart: (username, password, email) => electron_1.ipcRenderer.invoke('connector:register-start', username, password, email),
    registerConfirm: (username, code) => electron_1.ipcRenderer.invoke('connector:register-confirm', username, code),
    login: (username, password) => electron_1.ipcRenderer.invoke('connector:login', username, password),
    logout: () => electron_1.ipcRenderer.invoke('connector:logout'),
    forgotPassword: (email) => electron_1.ipcRenderer.invoke('connector:forgot-password', email),
    resetPassword: (email, code, newPassword) => electron_1.ipcRenderer.invoke('connector:reset-password', email, code, newPassword),
    // ── Rooms ─────────────────────────────────────────────────────────────────
    createRoom: (name, map) => electron_1.ipcRenderer.invoke('connector:create-room', name, map),
    joinRoom: (roomId) => electron_1.ipcRenderer.invoke('connector:join-room', roomId),
    leaveRoom: () => electron_1.ipcRenderer.invoke('connector:leave-room'),
    // ── File / Launch ─────────────────────────────────────────────────────────
    selectWC3Path: () => electron_1.ipcRenderer.invoke('connector:select-wc3-path'),
    selectMapPath: () => electron_1.ipcRenderer.invoke('connector:select-map-path'),
    launchWC3: (path) => electron_1.ipcRenderer.invoke('connector:launch-wc3', path),
    openChat: () => electron_1.ipcRenderer.invoke('chat:open'),
    sendPing: () => electron_1.ipcRenderer.invoke('connector:send-ping'),
    // ── Events from main process ──────────────────────────────────────────────
    onStatus: (cb) => electron_1.ipcRenderer.on('connector:status', (_e, data) => cb(data)),
    onRoomList: (cb) => electron_1.ipcRenderer.on('connector:room-list', (_e, rooms) => cb(rooms)),
    onRoomCreated: (cb) => electron_1.ipcRenderer.on('connector:room-created', (_e, roomId) => cb(roomId)),
    onRoomJoined: (cb) => electron_1.ipcRenderer.on('connector:room-joined', (_e, roomId) => cb(roomId)),
    onRoomRestored: (cb) => electron_1.ipcRenderer.on('connector:room-restored', (_e, data) => cb(data)),
    onNotice: (cb) => electron_1.ipcRenderer.on('connector:notice', (_e, message) => cb(message)),
    onBanner: (cb) => electron_1.ipcRenderer.on('connector:banner', (_e, data) => cb(data)),
    onRoomLeft: (cb) => electron_1.ipcRenderer.on('connector:room-left', () => cb()),
    onPing: (cb) => electron_1.ipcRenderer.on('connector:ping', (_e, rtt) => cb(rtt)),
    onError: (cb) => electron_1.ipcRenderer.on('connector:error', (_e, error) => cb(error)),
});
//# sourceMappingURL=preload.js.map