"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const path = __importStar(require("path"));
const udp_broadcaster_1 = require("./wc3/udp-broadcaster");
const tcp_proxy_1 = require("./wc3/tcp-proxy");
const ws_relay_client_1 = require("./wc3/ws-relay-client");
let mainWindow = null;
let udpBroadcaster = null;
let tcpProxy = null;
let hostTunnel = null;
let wsClient = null;
// Роль в текущей комнате
let role = null;
// Хост: нашли ли мы уже игру в локальном WC3
let hostGameFound = false;
// Гость: показываем ли мы уже игру хоста в локальном WC3
let guestAnnounced = false;
let hostGamePort = 0;
let currentUserId = null;
const API_URL = process.env.WC3_SERVER_HTTP_URL || 'http://130.78.13.15:3000';
const SERVER_URL = process.env.WC3_SERVER_WS_URL || API_URL.replace(/^http/, 'ws') + '/ws';
// Порт самого Warcraft III. Коннектор его НЕ занимает — он только обращается к WC3 по этому порту.
const WC3_PORT = 6112;
function createWindow() {
    mainWindow = new electron_1.BrowserWindow({
        width: 850,
        height: 650,
        resizable: false,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js'),
        },
    });
    // Load renderer HTML
    const htmlPath = path.join(__dirname, '../renderer/index.html');
    mainWindow.loadFile(htmlPath);
    if (!electron_1.app.isPackaged)
        mainWindow.webContents.openDevTools();
    mainWindow.on('closed', () => {
        mainWindow = null;
        cleanup();
    });
}
function sendToRenderer(channel, data) {
    mainWindow?.webContents.send(channel, data);
}
function notice(text) {
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
    hostGamePort = 0;
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
async function startNetworkStack() {
    try {
        udpBroadcaster = new udp_broadcaster_1.UDPBroadcaster(WC3_PORT);
        // Режим гостя: WC3 подключается к нашему прокси (порт выбирает система, НЕ 6112)
        tcpProxy = new tcp_proxy_1.TCPProxy({
            onOpen: (conn) => wsClient?.sendTunnel({ conn, op: 'open' }),
            onData: (conn, data) => wsClient?.sendTunnel({ conn, op: 'data', data }),
            onClose: (conn) => wsClient?.sendTunnel({ conn, op: 'close' }),
        });
        await tcpProxy.start();
        // Режим хоста: туннели к нашему собственному WC3
        hostTunnel = new tcp_proxy_1.HostTunnel({
            wc3Port: WC3_PORT,
            onData: (userId, conn, data) => wsClient?.sendTunnel({ to: userId, conn, op: 'data', data }),
            onClose: (userId, conn) => wsClient?.sendTunnel({ to: userId, conn, op: 'close' }),
        });
        return { success: true };
    }
    catch (err) {
        return { success: false, error: err.message };
    }
}
// ─── Обработка туннельного трафика ───────────────────────────────────────────
function handleTunnel(msg) {
    if (role === 'host') {
        // гость -> наш WC3
        const userId = msg.from;
        if (userId === undefined)
            return;
        switch (msg.op) {
            case 'open':
                if (hostGamePort > 0)
                    hostTunnel?.open(userId, msg.conn, hostGamePort);
                else
                    console.warn('[TUNNEL] guest tried to connect before host GAMEINFO was discovered');
                break;
            case 'data':
                if (msg.data)
                    hostTunnel?.write(userId, msg.conn, msg.data);
                break;
            case 'close':
                hostTunnel?.close(userId, msg.conn);
                break;
            case 'close_all':
                hostTunnel?.closeAllForUser(userId);
                break;
        }
    }
    else if (role === 'guest') {
        // хост -> наш WC3
        switch (msg.op) {
            case 'data':
                if (msg.data)
                    tcpProxy?.write(msg.conn, msg.data);
                break;
            case 'close':
                tcpProxy?.close(msg.conn);
                break;
        }
    }
}
// ─── Подключение к серверу после входа ───────────────────────────────────────
function connectWSClient(token) {
    wsClient = new ws_relay_client_1.WSRelayClient({
        serverUrl: SERVER_URL,
        token,
        onConnected: () => {
            console.log('Connected to relay server');
            sendToRenderer('connector:status', { connected: true });
        },
        onReconnectExpired: () => {
            console.warn('Relay reconnect grace period expired locally');
            resetRoomState();
            sendToRenderer('connector:room-left');
            notice('Время переподключения истекло. Вы исключены из комнаты');
        },
        onDisconnected: () => {
            console.log('Disconnected from relay server; preserving room and TCP sockets during reconnect grace period');
            // Stop advertising stale GAMEINFO, but keep TCP endpoints alive so queued relay data
            // can be flushed if the WebSocket returns within the server's 180s grace period.
            udpBroadcaster?.reset();
            guestAnnounced = false;
            sendToRenderer('connector:status', { connected: false });
            notice('Связь с игровым relay потеряна. Ожидаем переподключения (до 180 секунд)');
        },
        // ── Мы создали комнату: мы ХОСТ ──
        onRoomCreated: (roomId) => {
            console.log('Room created:', roomId);
            role = 'host';
            hostGameFound = false;
            // Ищем игру, которую хост создаст в своём Warcraft III
            udpBroadcaster?.probe((packet, info) => {
                hostGamePort = info.port;
                wsClient?.sendGameInfo(packet);
                if (!hostGameFound) {
                    hostGameFound = true;
                    notice(`Игра «${info.gameName}» найдена — гости могут подключаться`);
                }
            }, () => {
                hostGameFound = false;
                hostGamePort = 0;
                wsClient?.sendGameInfoLost();
                notice('Игра Warcraft III больше не обнаруживается. Комната остаётся открытой');
            });
            sendToRenderer('connector:banner', {
                title: 'Комната создана — теперь создайте игру в Warcraft III',
                hint: 'Создайте LAN-игру вручную с выбранной картой. Автопроверка несовпадения карты пока не включена.',
            });
            sendToRenderer('connector:room-created', roomId);
        },
        // ── Мы вошли в чужую комнату: мы ГОСТЬ ──
        onRoomJoined: (roomId, room, gameInfo) => {
            console.log('Joined room:', roomId);
            role = 'guest';
            guestAnnounced = false;
            if (room.game_session_status !== 'relay_paused' && gameInfo && tcpProxy && udpBroadcaster) {
                udpBroadcaster.announce(gameInfo, tcpProxy.port);
                guestAnnounced = true;
                sendToRenderer('connector:banner', {
                    title: 'Вы в комнате — запустите Warcraft III',
                    hint: 'Warcraft III → Локальная сеть → игра уже в списке (появится через пару секунд)',
                });
            }
            else {
                sendToRenderer('connector:banner', {
                    title: room.game_session_status === 'relay_paused' ? 'Игровой relay временно приостановлен' : 'Вы в комнате — ждём, пока хост создаст игру',
                    hint: 'Когда хост создаст игру в Warcraft III, она сама появится в вашем списке «Локальная сеть»',
                });
            }
            sendToRenderer('connector:room-joined', roomId);
        },
        onRoomRestored: (roomId, room, gameInfo) => {
            console.log('[ROOM] restored after relay reconnect:', roomId);
            role = room.host_user_id === currentUserId ? 'host' : 'guest';
            if (role === 'host') {
                hostGameFound = false;
                hostGamePort = 0;
                udpBroadcaster?.probe((packet, info) => {
                    hostGamePort = info.port;
                    wsClient?.sendGameInfo(packet);
                    if (!hostGameFound) {
                        hostGameFound = true;
                        notice(`Связь восстановлена. Игра «${info.gameName}» снова доступна`);
                    }
                }, () => {
                    hostGameFound = false;
                    hostGamePort = 0;
                    wsClient?.sendGameInfoLost();
                });
            }
            else if (room.game_session_status !== 'relay_paused' && gameInfo && tcpProxy && udpBroadcaster) {
                try {
                    udpBroadcaster.announce(gameInfo, tcpProxy.port);
                    guestAnnounced = true;
                }
                catch (err) {
                    notice(`Не удалось восстановить объявление игры: ${err.message}`);
                }
            }
            sendToRenderer('connector:room-restored', { roomId, role });
            notice('Соединение с relay восстановлено');
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
            console.log(`[GAMEINFO RECEIVED] role=${role}, tcpProxy=${!!tcpProxy}, udpBroadcaster=${!!udpBroadcaster}, guestAnnounced=${guestAnnounced}, gameInfoSize=${gameInfo.length}`);
            if (role !== 'guest' || !tcpProxy || !udpBroadcaster) {
                console.warn('[GAMEINFO SKIP] Not in guest mode or network stack not ready');
                return;
            }
            if (!guestAnnounced) {
                console.log(`[GAMEINFO] First announce: proxy port=${tcpProxy.port}`);
                udpBroadcaster.announce(gameInfo, tcpProxy.port);
                guestAnnounced = true;
                sendToRenderer('connector:banner', {
                    title: 'Вы в комнате — запустите Warcraft III',
                    hint: 'Warcraft III → Локальная сеть → игра уже в списке (появится через пару секунд)',
                });
                notice('Хост создал игру — она появится в списке «Локальная сеть»');
            }
            else {
                console.log('[GAMEINFO] Updating game info');
                udpBroadcaster.updateGame(gameInfo);
            }
        },
        onGameInfoLost: () => {
            if (role === 'guest') {
                udpBroadcaster?.reset();
                guestAnnounced = false;
                notice('Хост закрыл или перезапустил игру. Ожидаем новую LAN-сессию');
            }
        },
        onRelayState: (state, payload) => {
            if (state === 'paused') {
                udpBroadcaster?.reset();
                guestAnnounced = false;
                const seconds = Math.max(0, Math.ceil(((payload?.reconnectDeadline ?? Date.now() + 180000) - Date.now()) / 1000));
                notice(`Потеряна связь с игровым relay. Ожидание переподключения: до ${seconds} сек.`);
            }
            else {
                notice('Связь участников с игровым relay восстановлена');
                if (role === 'host') {
                    hostGameFound = false;
                    hostGamePort = 0;
                    udpBroadcaster?.probe((packet, info) => {
                        hostGamePort = info.port;
                        wsClient?.sendGameInfo(packet);
                        hostGameFound = true;
                    }, () => {
                        hostGameFound = false;
                        hostGamePort = 0;
                        wsClient?.sendGameInfoLost();
                    });
                }
            }
        },
        onTunnel: handleTunnel,
        onError: (error) => {
            console.error('WS error:', error);
            if (/invalid|expired token|connected from another connector instance/i.test(error)) {
                resetRoomState();
                sendToRenderer('connector:room-left');
            }
            sendToRenderer('connector:error', error);
        },
    });
    wsClient.connect();
}
// ─── IPC Handlers ─────────────────────────────────────────────────────────────
electron_1.ipcMain.handle('connector:register', async (_e, username, password) => {
    try {
        const res = await fetch(`${API_URL}/api/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password }),
        });
        const data = await res.json();
        if (!res.ok)
            return { success: false, error: data.error };
        return { success: true, user: data.user };
    }
    catch (err) {
        return { success: false, error: err.message };
    }
});
electron_1.ipcMain.handle('connector:login', async (_e, username, password) => {
    try {
        const res = await fetch(`${API_URL}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password }),
        });
        const data = await res.json();
        if (!res.ok)
            return { success: false, error: data.error };
        const { token, user } = data;
        // Если уже были подключены — аккуратно всё остановить
        cleanup();
        const networkResult = await startNetworkStack();
        if (!networkResult.success) {
            return { success: false, error: `Не удалось запустить локальный прокси: ${networkResult.error}` };
        }
        currentUserId = user.id;
        connectWSClient(token);
        return { success: true, user };
    }
    catch (err) {
        return { success: false, error: err.message };
    }
});
electron_1.ipcMain.handle('connector:logout', async () => {
    cleanup();
    currentUserId = null;
    return { success: true };
});
electron_1.ipcMain.handle('connector:create-room', async (_e, name, map) => {
    if (!wsClient?.isConnected()) {
        return { success: false, error: 'Not connected to server' };
    }
    // name/map — только подпись в списке комнат; реальную игру хост создаёт в самом WC3
    const sent = wsClient.createRoom(name, map, 12);
    return sent ? { success: true } : { success: false, error: 'Relay authentication is not complete yet' };
});
electron_1.ipcMain.handle('connector:join-room', async (_e, roomId) => {
    if (!wsClient?.isConnected()) {
        return { success: false, error: 'Not connected to server' };
    }
    const sent = wsClient.joinRoom(roomId);
    return sent ? { success: true } : { success: false, error: 'Relay authentication is not complete yet' };
});
electron_1.ipcMain.handle('connector:leave-room', async () => {
    wsClient?.leaveRoom();
    resetRoomState();
    sendToRenderer('connector:room-left');
    return { success: true };
});
electron_1.ipcMain.handle('connector:select-map-path', async () => {
    const { dialog } = require('electron');
    const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Выберите карту Warcraft III',
        filters: [{ name: 'Карты Warcraft III', extensions: ['w3x', 'w3m'] }],
        properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0)
        return { success: false };
    return { success: true, path: result.filePaths[0], name: path.basename(result.filePaths[0]) };
});
electron_1.ipcMain.handle('connector:select-wc3-path', async () => {
    const { dialog } = require('electron');
    const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Выберите Warcraft III.exe',
        filters: [{ name: 'Warcraft III', extensions: ['exe'] }],
        properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) {
        return { success: false };
    }
    return { success: true, path: result.filePaths[0] };
});
electron_1.ipcMain.handle('connector:launch-wc3', async (_e, wc3Path) => {
    const { spawn } = require('child_process');
    const fs = require('fs');
    if (!fs.existsSync(wc3Path)) {
        return { success: false, error: 'Файл Warcraft III.exe не найден' };
    }
    try {
        spawn(wc3Path, [], { detached: true, stdio: 'ignore' }).unref();
        return { success: true };
    }
    catch (err) {
        return { success: false, error: err.message };
    }
});
// ─── App lifecycle ─────────────────────────────────────────────────────────────
electron_1.app.whenReady().then(createWindow);
electron_1.app.on('window-all-closed', () => {
    cleanup();
    if (process.platform !== 'darwin')
        electron_1.app.quit();
});
electron_1.app.on('activate', () => {
    if (electron_1.BrowserWindow.getAllWindows().length === 0)
        createWindow();
});
//# sourceMappingURL=index.js.map