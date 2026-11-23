import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import { UDPBroadcaster } from './wc3/udp-broadcaster';
import { TCPProxy, HostTunnel } from './wc3/tcp-proxy';
import { WSRelayClient, TunnelMessage } from './wc3/ws-relay-client';

let mainWindow: BrowserWindow | null = null;
let udpBroadcaster: UDPBroadcaster | null = null;
let tcpProxy: TCPProxy | null = null;
let hostTunnel: HostTunnel | null = null;
let wsClient: WSRelayClient | null = null;

// Роль в текущей комнате
let role: 'host' | 'guest' | null = null;
// Хост: нашли ли мы уже игру в локальном WC3
let hostGameFound = false;
// Гость: показываем ли мы уже игру хоста в локальном WC3
let guestAnnounced = false;

const SERVER_URL = 'ws://130.78.13.15:3000/ws';
const API_URL = 'http://130.78.13.15:3000';
// Порт самого Warcraft III. Коннектор его НЕ занимает — он только обращается к WC3 по этому порту.
const WC3_PORT = 6112;

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

  // Always load from public/index.html
  const htmlPath = path.join(__dirname, '../../public/index.html');
  mainWindow.loadFile(htmlPath);
  mainWindow.webContents.openDevTools(); // для отладки

  mainWindow.on('closed', () => {
    mainWindow = null;
    cleanup();
  });
}

function sendToRenderer(channel: string, data?: any) {
  mainWindow?.webContents.send(channel, data);
}

function notice(text: string) {
  console.log('NOTICE:', text);
  sendToRenderer('connector:notice', text);
}

/** Сбросить всё, что связано с текущей комнатой (сетевой стек остаётся) */
function resetRoomState() {
  udpBroadcaster?.reset();
  tcpProxy?.closeAll();
  hostTunnel?.closeAll();
  role = null;
  hostGameFound = false;
  guestAnnounced = false;
}

function cleanup() {
  resetRoomState();

  udpBroadcaster?.stop();
  udpBroadcaster = null;

  tcpProxy?.stop();
  tcpProxy = null;

  hostTunnel = null;

  wsClient?.disconnect();
  wsClient = null;
}

// ─── Сетевой стек (создаётся при входе) ──────────────────────────────────────

async function startNetworkStack(): Promise<{ success: boolean; error?: string }> {
  try {
    udpBroadcaster = new UDPBroadcaster(WC3_PORT);

    // Режим гостя: WC3 подключается к нашему прокси (порт выбирает система, НЕ 6112)
    tcpProxy = new TCPProxy({
      onOpen: (conn) => wsClient?.sendTunnel({ conn, op: 'open' }),
      onData: (conn, data) => wsClient?.sendTunnel({ conn, op: 'data', data }),
      onClose: (conn) => wsClient?.sendTunnel({ conn, op: 'close' }),
    });
    await tcpProxy.start();

    // Режим хоста: туннели к нашему собственному WC3
    hostTunnel = new HostTunnel({
      wc3Port: WC3_PORT,
      onData: (userId, conn, data) => wsClient?.sendTunnel({ to: userId, conn, op: 'data', data }),
      onClose: (userId, conn) => wsClient?.sendTunnel({ to: userId, conn, op: 'close' }),
    });

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

// ─── Обработка туннельного трафика ───────────────────────────────────────────

function handleTunnel(msg: TunnelMessage) {
  if (role === 'host') {
    // гость -> наш WC3
    const userId = msg.from;
    if (userId === undefined) return;
    switch (msg.op) {
      case 'open':
        hostTunnel?.open(userId, msg.conn);
        break;
      case 'data':
        if (msg.data) hostTunnel?.write(userId, msg.conn, msg.data);
        break;
      case 'close':
        hostTunnel?.close(userId, msg.conn);
        break;
      case 'close_all':
        hostTunnel?.closeAllForUser(userId);
        break;
    }
  } else if (role === 'guest') {
    // хост -> наш WC3
    switch (msg.op) {
      case 'data':
        if (msg.data) tcpProxy?.write(msg.conn, msg.data);
        break;
      case 'close':
        tcpProxy?.close(msg.conn);
        break;
    }
  }
}

// ─── Подключение к серверу после входа ───────────────────────────────────────

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
      const wasInRoom = role !== null;
      resetRoomState();
      sendToRenderer('connector:status', { connected: false });
      sendToRenderer('connector:room-list', []);
      if (wasInRoom) sendToRenderer('connector:room-left');
    },

    // ── Мы создали комнату: мы ХОСТ ──
    onRoomCreated: (roomId) => {
      console.log('Room created:', roomId);
      role = 'host';
      hostGameFound = false;

      // Ищем игру, которую хост создаст в своём Warcraft III
      udpBroadcaster?.probe((packet, info) => {
        wsClient?.sendGameInfo(packet);
        if (!hostGameFound) {
          hostGameFound = true;
          notice(`Игра «${info.gameName}» найдена — гости могут подключаться`);
        }
      });

      sendToRenderer('connector:banner', {
        title: 'Комната создана — теперь создайте игру в Warcraft III',
        hint: 'Warcraft III → Локальная сеть → Создать игру. Коннектор найдёт её сам.',
      });
      sendToRenderer('connector:room-created', roomId);
    },

    // ── Мы вошли в чужую комнату: мы ГОСТЬ ──
    onRoomJoined: (roomId, _room, gameInfo) => {
      console.log('Joined room:', roomId);
      role = 'guest';
      guestAnnounced = false;

      if (gameInfo && tcpProxy && udpBroadcaster) {
        udpBroadcaster.announce(gameInfo, tcpProxy.port);
        guestAnnounced = true;
        sendToRenderer('connector:banner', {
          title: 'Вы в комнате — запустите Warcraft III',
          hint: 'Warcraft III → Локальная сеть → игра уже в списке (появится через пару секунд)',
        });
      } else {
        sendToRenderer('connector:banner', {
          title: 'Вы в комнате — ждём, пока хост создаст игру',
          hint: 'Когда хост создаст игру в Warcraft III, она сама появится в вашем списке «Локальная сеть»',
        });
      }
      sendToRenderer('connector:room-joined', roomId);
    },

    onRoomClosed: () => {
      resetRoomState();
      notice('Хост закрыл комнату');
      sendToRenderer('connector:room-left');
    },

    onRoomList: (rooms) => {
      sendToRenderer('connector:room-list', rooms);
    },

    // Хост прислал (свежий) GAMEINFO
    onGameInfo: (gameInfo) => {
      if (role !== 'guest' || !tcpProxy || !udpBroadcaster) return;
      if (!guestAnnounced) {
        udpBroadcaster.announce(gameInfo, tcpProxy.port);
        guestAnnounced = true;
        sendToRenderer('connector:banner', {
          title: 'Вы в комнате — запустите Warcraft III',
          hint: 'Warcraft III → Локальная сеть → игра уже в списке (появится через пару секунд)',
        });
        notice('Хост создал игру — она появится в списке «Локальная сеть»');
      } else {
        udpBroadcaster.updateGame(gameInfo);
      }
    },

    onTunnel: handleTunnel,

    onError: (error) => {
      console.error('WS error:', error);
      sendToRenderer('connector:error', error);
    },
  });

  wsClient.connect();
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

    // Если уже были подключены — аккуратно всё остановить
    cleanup();

    const networkResult = await startNetworkStack();
    if (!networkResult.success) {
      return { success: false, error: `Не удалось запустить локальный прокси: ${networkResult.error}` };
    }

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
  // name/map — только подпись в списке комнат; реальную игру хост создаёт в самом WC3
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
  resetRoomState();
  sendToRenderer('connector:room-left');
  return { success: true };
});

ipcMain.handle('connector:select-wc3-path', async () => {
  const { dialog } = require('electron');
  const result = await dialog.showOpenDialog(mainWindow!, {
    title: 'Выберите Warcraft III.exe',
    filters: [{ name: 'Warcraft III', extensions: ['exe'] }],
    properties: ['openFile'],
  });
  if (result.canceled || result.filePaths.length === 0) {
    return { success: false };
  }
  return { success: true, path: result.filePaths[0] };
});

ipcMain.handle('connector:launch-wc3', async (_e, wc3Path: string) => {
  const { spawn } = require('child_process');
  const fs = require('fs');

  if (!fs.existsSync(wc3Path)) {
    return { success: false, error: 'Файл Warcraft III.exe не найден' };
  }

  try {
    spawn(wc3Path, [], { detached: true, stdio: 'ignore' }).unref();
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
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
