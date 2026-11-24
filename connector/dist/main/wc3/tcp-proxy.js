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
exports.HostTunnel = exports.TCPProxy = void 0;
const net = __importStar(require("net"));
class TCPProxy {
    options;
    server = null;
    sockets = new Map();
    nextId = 1;
    _port = 0;
    constructor(options) {
        this.options = options;
    }
    get port() {
        return this._port;
    }
    /** Запуститься на свободном порту, выбранном системой. Возвращает порт. */
    start() {
        return new Promise((resolve, reject) => {
            if (this.server)
                return resolve(this._port);
            const server = net.createServer((socket) => {
                const connId = this.nextId++;
                this.sockets.set(connId, socket);
                socket.setNoDelay(true);
                console.log(`WC3 connected to proxy (conn ${connId})`);
                this.options.onOpen(connId);
                socket.on('data', (data) => this.options.onData(connId, Buffer.isBuffer(data) ? data : Buffer.from(data)));
                socket.on('close', () => {
                    if (this.sockets.delete(connId)) {
                        console.log(`WC3 proxy connection closed (conn ${connId})`);
                        this.options.onClose(connId);
                    }
                });
                socket.on('error', (err) => {
                    console.error(`Proxy socket error (conn ${connId}):`, err.message);
                    socket.destroy();
                });
            });
            server.once('error', reject);
            server.listen(0, '127.0.0.1', () => {
                server.removeListener('error', reject);
                server.on('error', (err) => console.error('TCP proxy error:', err));
                this.server = server;
                this._port = server.address().port;
                console.log(`TCP proxy listening on 127.0.0.1:${this._port}`);
                resolve(this._port);
            });
        });
    }
    write(connId, data) {
        const s = this.sockets.get(connId);
        if (s && s.writable)
            s.write(data);
    }
    /** Закрыть соединение по просьбе хоста (без обратного уведомления) */
    close(connId) {
        const s = this.sockets.get(connId);
        if (s) {
            this.sockets.delete(connId);
            s.destroy();
        }
    }
    closeAll() {
        this.sockets.forEach((s) => s.destroy());
        this.sockets.clear();
    }
    stop() {
        this.closeAll();
        if (this.server) {
            this.server.close();
            this.server = null;
        }
        this._port = 0;
        console.log('TCP proxy stopped');
    }
}
exports.TCPProxy = TCPProxy;
class HostTunnel {
    options;
    sockets = new Map();
    constructor(options) {
        this.options = options;
    }
    key(userId, connId) {
        return `${userId}:${connId}`;
    }
    open(userId, connId, gamePort = this.options.wc3Port) {
        const key = this.key(userId, connId);
        this.close(userId, connId);
        if (!Number.isInteger(gamePort) || gamePort < 1 || gamePort > 65535) {
            console.error(`Refusing host tunnel with invalid WC3 port: ${gamePort}`);
            return;
        }
        const socket = net.connect({ host: '127.0.0.1', port: gamePort });
        socket.setNoDelay(true);
        this.sockets.set(key, socket);
        socket.on('connect', () => console.log(`Host tunnel ${key} -> WC3 :${gamePort}`));
        socket.on('data', (data) => this.options.onData(userId, connId, Buffer.isBuffer(data) ? data : Buffer.from(data)));
        socket.on('close', () => {
            if (this.sockets.get(key) === socket) {
                this.sockets.delete(key);
                this.options.onClose(userId, connId);
            }
        });
        socket.on('error', (err) => {
            console.error(`Host tunnel ${key} error:`, err.message);
            socket.destroy();
        });
    }
    write(userId, connId, data) {
        const s = this.sockets.get(this.key(userId, connId));
        // запись до установки соединения Node буферизует сама
        if (s && !s.destroyed)
            s.write(data);
    }
    close(userId, connId) {
        const key = this.key(userId, connId);
        const s = this.sockets.get(key);
        if (s) {
            this.sockets.delete(key);
            s.destroy();
        }
    }
    closeAllForUser(userId) {
        const prefix = `${userId}:`;
        for (const [key, s] of this.sockets) {
            if (key.startsWith(prefix)) {
                this.sockets.delete(key);
                s.destroy();
            }
        }
    }
    closeAll() {
        this.sockets.forEach((s) => s.destroy());
        this.sockets.clear();
    }
}
exports.HostTunnel = HostTunnel;
//# sourceMappingURL=tcp-proxy.js.map