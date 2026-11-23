import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('connector', {
  register: (username: string, password: string) =>
    ipcRenderer.invoke('connector:register', username, password),

  login: (username: string, password: string) =>
    ipcRenderer.invoke('connector:login', username, password),

  logout: () =>
    ipcRenderer.invoke('connector:logout'),

  createRoom: (name: string, map: string) =>
    ipcRenderer.invoke('connector:create-room', name, map),

  joinRoom: (roomId: string) =>
    ipcRenderer.invoke('connector:join-room', roomId),

  leaveRoom: () =>
    ipcRenderer.invoke('connector:leave-room'),

  selectWC3Path: () =>
    ipcRenderer.invoke('connector:select-wc3-path'),

  launchWC3: (path: string) =>
    ipcRenderer.invoke('connector:launch-wc3', path),

  // Events from main process
  onStatus: (cb: (data: { connected: boolean }) => void) =>
    ipcRenderer.on('connector:status', (_e, data) => cb(data)),

  onRoomList: (cb: (rooms: any[]) => void) =>
    ipcRenderer.on('connector:room-list', (_e, rooms) => cb(rooms)),

  onRoomCreated: (cb: (roomId: string) => void) =>
    ipcRenderer.on('connector:room-created', (_e, roomId) => cb(roomId)),

  onRoomJoined: (cb: (roomId: string) => void) =>
    ipcRenderer.on('connector:room-joined', (_e, roomId) => cb(roomId)),

  onRoomLeft: (cb: () => void) =>
    ipcRenderer.on('connector:room-left', () => cb()),

  onError: (cb: (error: string) => void) =>
    ipcRenderer.on('connector:error', (_e, error) => cb(error)),
});
