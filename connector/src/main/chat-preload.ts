import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('chat', {
  sendMessage: (text: string) =>
    ipcRenderer.invoke('chat:send', text),

  onMessage: (cb: (msg: { userId: number; username: string; text: string; ts: number }) => void) =>
    ipcRenderer.on('chat:message', (_e, msg) => cb(msg)),

  onHistory: (cb: (messages: Array<{ userId: number; username: string; text: string; ts: number }>) => void) =>
    ipcRenderer.on('chat:history', (_e, messages) => cb(messages)),

  onPlayersUpdate: (cb: (players: Array<{ userId: number; username: string }>) => void) =>
    ipcRenderer.on('chat:players', (_e, players) => cb(players)),

  onRoomClosed: (cb: () => void) =>
    ipcRenderer.on('chat:room-closed', () => cb()),
});
