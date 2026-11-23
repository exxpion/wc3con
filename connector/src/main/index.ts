import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import { UDPBroadcaster } from './wc3/udp-broadcaster';
import { TCPProxy } from './wc3/tcp-proxy';
import { WSRelayClient } from './wc3/ws-relay-client';
import { GameInfo } from './wc3/protocol';
import * as net from 'net';

let mainWindow: BrowserWindow | null = null;
let udpBroadcaster: UDPBroadcaster | null = null;
let tcpProxy: TCPProxy | null = null;
let wsClient: WSRelayClient | null = null;

// Pending room info for when room is created (host stores name/map)
let pendingRoomInfo: { name: string; map: string } | null = null;

const SERVER_URL = process.env.SERVER_URL || 'ws://localhost:3000/ws';
const API_URL = process.env.API_URL || 'http://localhost:3000';
const WC3_PORT = 6112;

// Active TCP connections from WC3
const socketMap = new Map<string, net.Socket>();

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 850,
    height: 650,
    resizable: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
    cleanup();
  });
}

function sendToRenderer(channel: string, data?: any) {
  mainWindow?.webContents.send(channel, data);
}

function cleanup() {
  udpBroadcaster?.stop();
  udpBroadcaster = null;

  tcpProxy?.stop();
  tcpProxy = null;

  wsClient?.disconnect();
  wsClient = null;

  socketMap.clear();
}

// Initialize UDP broadcaster + TCP proxy (called once at login)
async function startNetworkStack(): Promise<{ success: boolean; error?: string }> {
  try {
    udpBroadcaster = new UDPBroadcaster(WC3_PORT);

    tcpProxy = new TCPProxy({
      localPort: WC3_PORT,
      onConnection: (socket) => {
        console.log('WC3 connected to TCP proxy');
        const socketId = `${socket.remoteAddress}:${socket.remotePort}`;
        socketMap.set(socketId, socket);
      },
      onData: (socket, data) => {
        // Forward WC3 TCP data to relay server via WebSocket
        if (wsClient?.isConnected()) {
          wsClient.sendGameData(data, socket);
        }
      },
      onClose: (socket) => {
        const socketId = `${socket.remoteAddress}:${socket.remotePort}`;
        socketMap.delete(socketId);
        wsClient?.unregisterSocket(socket);
      },
    });

    udpBroadcaster.start();
    await tcpProxy.start();

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

// Connect to relay server via WebSocket after login
function connectWSClient(token: string) {
  wsClient = new WSRelayClient({
    serverUrl: SERVER_URL,
    token,

    onConnected: () => {
      console.log('Connected to relay server');
      sendToRenderer('connector:status', { connected: true });
    },

    onDisconnected: () => {
      console.log('Disconnected from relay server');
      udpBroadcaster?.clearGames();
      sendToRenderer('connector:status', { connected: false });
      sendToRenderer('connector:room-list', []);
    },

    onRoomCreated: (roomId, room) => {
      console.log('Room created:', roomId);
      // Automatically add this game to UDP broadcaster
      // so WC3 LAN sees it immediately on the host machine too
      if (udpBroadcaster && pendingRoomInfo) {
        const gameInfo: GameInfo = {
          gameId: hashRoomId(roomId),
          name: pendingRoomInfo.name,
          map: pendingRoomInfo.map,
          slots: room.max_players,
          slotsUsed: room.current_players,
          gameType: 0,
          gameState: 1,
        };
        udpBroadcaster.addGame(roomId, gameInfo);
        pendingRoomInfo = null;
      }
      sendToRenderer('connector:room-created', roomId);
    },

    onRoomJoined: (roomId, room) => {
      console.log('Joined room:', roomId);
      // Automatically add game to UDP so WC3 LAN sees it
      if (udpBroadcaster) {
        const gameInfo: GameInfo = {
          gameId: hashRoomId(roomId),
          name: room.name,
          map: room.map,
          slots: room.max_players,
          slotsUsed: room.current_players,
          gameType: 0,
          gameState: 1,
        };
        udpBroadcaster.addGame(roomId, gameInfo);
      }
      sendToRenderer('connector:room-joined', roomId);
    },

    onRoomList: (rooms) => {
      // Push full list to UI
      sendToRenderer('connector:room-list', rooms);
    },

    onGameData: (data) => {
      // Forward relay data to WC3 via TCP
      socketMap.forEach(socket => {
        tcpProxy?.send(socket, data);
      });
    },

    onError: (error) => {
      console.error('WS error:', error);
      sendToRenderer('connector:error', error);
    },
  });

  wsClient.connect();
}

function hashRoomId(roomId: string): number {
  let hash = 0;
  for (let i = 0; i < roomId.length; i++) {
    hash = (hash << 5) - hash + roomId.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) % 100000;
}

// ─── IPC Handlers ─────────────────────────────────────────────────────────────

ipcMain.handle('connector:register', async (_e, username: string, password: string) => {
  try {
    const res = await fetch(`${API_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data: any = await res.json();
    if (!res.ok) return { success: false, error: data.error };
    return { success: true, user: data.user };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('connector:login', async (_e, username: string, password: string) => {
  try {
    const res = await fetch(`${API_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data: any = await res.json();
    if (!res.ok) return { success: false, error: data.error };

    const { token, user } = data;

    // Start network stack (UDP + TCP)
    const networkResult = await startNetworkStack();
    if (!networkResult.success) {
      return { success: false, error: `Port 6112 is busy: ${networkResult.error}. Close WC3 and try again.` };
    }

    // Connect to relay server
    connectWSClient(token);

    return { success: true, user };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('connector:logout', async () => {
  cleanup();
  return { success: true };
});

ipcMain.handle('connector:create-room', async (_e, name: string, map: string) => {
  if (!wsClient?.isConnected()) {
    return { success: false, error: 'Not connected to server' };
  }
  pendingRoomInfo = { name, map };
  wsClient.createRoom(name, map, 12);
  return { success: true };
});

ipcMain.handle('connector:join-room', async (_e, roomId: string) => {
  if (!wsClient?.isConnected()) {
    return { success: false, error: 'Not connected to server' };
  }
  wsClient.joinRoom(roomId);
  return { success: true };
});

ipcMain.handle('connector:leave-room', async () => {
  wsClient?.leaveRoom();
  udpBroadcaster?.clearGames();
  sendToRenderer('connector:room-left');
  return { success: true };
});

// ─── App lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  cleanup();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
