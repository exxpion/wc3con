"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
electron_1.contextBridge.exposeInMainWorld('chat', {
    sendMessage: (text) => electron_1.ipcRenderer.invoke('chat:send', text),
    onMessage: (cb) => electron_1.ipcRenderer.on('chat:message', (_e, msg) => cb(msg)),
    onHistory: (cb) => electron_1.ipcRenderer.on('chat:history', (_e, messages) => cb(messages)),
    onPlayersUpdate: (cb) => electron_1.ipcRenderer.on('chat:players', (_e, players) => cb(players)),
    onRoomClosed: (cb) => electron_1.ipcRenderer.on('chat:room-closed', () => cb()),
});
//# sourceMappingURL=chat-preload.js.map