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
exports.UDPBroadcaster = void 0;
const dgram = __importStar(require("dgram"));
const protocol_1 = require("./protocol");
const PROBE_INTERVAL_MS = 2000;
const GAMEINFO_TIMEOUT_MS = 9000;
class UDPBroadcaster {
    wc3Port;
    socket = null;
    timer = null;
    gamePacket = null;
    proxyPort = 0;
    createSent = false;
    onGameInfo = null;
    onGameInfoLost = null;
    lastGameInfoAt = 0;
    gameWasFound = false;
    hostCounter = 1;
    constructor(wc3Port = 6112) {
        this.wc3Port = wc3Port;
    }
    ensureSocket() {
        if (this.socket)
            return;
        const socket = dgram.createSocket('udp4');
        this.socket = socket;
        socket.on('error', (err) => console.error('[UDP] socket error:', err.message));
        socket.on('message', (msg) => {
            if (!this.onGameInfo)
                return;
            const info = (0, protocol_1.parseGameInfo)(msg);
            if (!info || info.version !== protocol_1.WC3_VERSION)
                return;
            this.lastGameInfoAt = Date.now();
            this.gameWasFound = true;
            this.onGameInfo(Buffer.from(msg), info);
        });
        socket.bind(0, '0.0.0.0', () => {
            try {
                socket.setBroadcast(true);
            }
            catch { /* optional */ }
            console.log(`[UDP] bound ${socket.address().port}; WC3 UDP ${this.wc3Port} remains free`);
        });
    }
    startTimer(fn, intervalMs) {
        this.stopTimer();
        fn();
        this.timer = setInterval(fn, intervalMs);
    }
    stopTimer() {
        if (this.timer)
            clearInterval(this.timer);
        this.timer = null;
    }
    sendToWc3(packet) {
        this.socket?.send(packet, this.wc3Port, '127.0.0.1', (err) => {
            if (err)
                console.error('[UDP] send to WC3 failed:', err.message);
        });
    }
    probe(onGameInfo, onGameInfoLost) {
        this.reset();
        this.onGameInfo = onGameInfo;
        this.onGameInfoLost = onGameInfoLost ?? null;
        this.lastGameInfoAt = 0;
        this.gameWasFound = false;
        this.ensureSocket();
        const search = (0, protocol_1.buildSearchGame)();
        this.startTimer(() => {
            this.sendToWc3(search);
            if (this.gameWasFound && Date.now() - this.lastGameInfoAt > GAMEINFO_TIMEOUT_MS) {
                this.gameWasFound = false;
                this.onGameInfoLost?.();
            }
        }, PROBE_INTERVAL_MS);
    }
    announce(hostGameInfo, proxyPort) {
        const parsed = (0, protocol_1.parseGameInfo)(hostGameInfo);
        if (!parsed || parsed.version !== protocol_1.WC3_VERSION) {
            throw new Error('Host supplied an invalid or incompatible WC3 1.26 GAMEINFO packet');
        }
        if (!Number.isInteger(proxyPort) || proxyPort < 1 || proxyPort > 65535) {
            throw new RangeError(`Invalid local proxy port: ${proxyPort}`);
        }
        this.onGameInfo = null;
        this.onGameInfoLost = null;
        this.proxyPort = proxyPort;
        this.ensureSocket();
        this.gamePacket = (0, protocol_1.rewriteGameInfoPort)(hostGameInfo, proxyPort);
        if (!this.timer) {
            this.createSent = false;
            this.startTimer(() => this.announceTick(), PROBE_INTERVAL_MS);
        }
        else {
            this.announceTick();
        }
    }
    announceTick() {
        if (!this.gamePacket)
            return;
        if (!this.createSent) {
            this.sendToWc3((0, protocol_1.buildCreateGame)(protocol_1.WC3_VERSION, this.hostCounter++));
            this.createSent = true;
        }
        this.sendToWc3(this.gamePacket);
    }
    updateGame(hostGameInfo) {
        if (!this.gamePacket)
            return;
        this.gamePacket = (0, protocol_1.rewriteGameInfoPort)(hostGameInfo, this.proxyPort);
    }
    /** Stop probing/announcing without closing the reusable UDP socket. */
    reset() {
        this.stopTimer();
        this.gamePacket = null;
        this.onGameInfo = null;
        this.onGameInfoLost = null;
        this.createSent = false;
        this.gameWasFound = false;
        this.lastGameInfoAt = 0;
    }
    stop() {
        this.reset();
        if (this.socket) {
            const socket = this.socket;
            this.socket = null;
            try {
                socket.close();
            }
            catch { /* already closed */ }
        }
    }
}
exports.UDPBroadcaster = UDPBroadcaster;
//# sourceMappingURL=udp-broadcaster.js.map