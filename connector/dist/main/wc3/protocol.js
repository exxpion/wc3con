"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WC3_VERSION = exports.W3GS_CREATEGAME = exports.W3GS_GAMEINFO = exports.W3GS_SEARCHGAME = exports.W3GS_HEADER = void 0;
exports.isW3gsPacket = isW3gsPacket;
exports.buildSearchGame = buildSearchGame;
exports.buildCreateGame = buildCreateGame;
exports.parseGameInfo = parseGameInfo;
exports.rewriteGameInfoPort = rewriteGameInfoPort;
/** W3GS packet helpers for Warcraft III 1.26. */
exports.W3GS_HEADER = 0xf7;
exports.W3GS_SEARCHGAME = 0x2f;
exports.W3GS_GAMEINFO = 0x30;
exports.W3GS_CREATEGAME = 0x31;
exports.WC3_VERSION = 26;
const PRODUCT_TFT = Buffer.from('PX3W', 'ascii');
function isW3gsPacket(data, expectedType) {
    if (!Buffer.isBuffer(data) || data.length < 4)
        return false;
    if (data.readUInt8(0) !== exports.W3GS_HEADER)
        return false;
    if (expectedType !== undefined && data.readUInt8(1) !== expectedType)
        return false;
    return data.readUInt16LE(2) === data.length;
}
function buildSearchGame(version = exports.WC3_VERSION) {
    const buf = Buffer.alloc(16);
    buf.writeUInt8(exports.W3GS_HEADER, 0);
    buf.writeUInt8(exports.W3GS_SEARCHGAME, 1);
    buf.writeUInt16LE(buf.length, 2);
    PRODUCT_TFT.copy(buf, 4);
    buf.writeUInt32LE(version >>> 0, 8);
    buf.writeUInt32LE(0, 12);
    return buf;
}
function buildCreateGame(version = exports.WC3_VERSION, hostCounter = 1) {
    const buf = Buffer.alloc(16);
    buf.writeUInt8(exports.W3GS_HEADER, 0);
    buf.writeUInt8(exports.W3GS_CREATEGAME, 1);
    buf.writeUInt16LE(buf.length, 2);
    PRODUCT_TFT.copy(buf, 4);
    buf.writeUInt32LE(version >>> 0, 8);
    buf.writeUInt32LE(hostCounter >>> 0, 12);
    return buf;
}
/** Parse only structurally valid W3GS_GAMEINFO packets. */
function parseGameInfo(data) {
    if (!isW3gsPacket(data, exports.W3GS_GAMEINFO) || data.length < 42)
        return null;
    const version = data.readUInt32LE(8);
    const hostCounter = data.readUInt32LE(12);
    let offset = 20;
    const nameEnd = data.indexOf(0, offset);
    if (nameEnd < 0)
        return null;
    const gameName = data.toString('utf8', offset, nameEnd);
    offset = nameEnd + 1;
    const passwordEnd = data.indexOf(0, offset);
    if (passwordEnd < 0)
        return null;
    offset = passwordEnd + 1;
    const statEnd = data.indexOf(0, offset);
    if (statEnd < 0)
        return null;
    offset = statEnd + 1;
    // The fixed GAMEINFO tail is 22 bytes in the supported 1.26 layout.
    if (data.length - offset !== 22)
        return null;
    const port = data.readUInt16LE(data.length - 2);
    if (port < 1 || port > 65535)
        return null;
    return {
        version,
        hostCounter,
        gameName,
        slotsTotal: data.readUInt32LE(offset),
        slotsOpen: data.readUInt32LE(offset + 12),
        port,
    };
}
function rewriteGameInfoPort(data, port) {
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new RangeError(`Invalid TCP port: ${port}`);
    }
    if (!parseGameInfo(data)) {
        throw new Error('Refusing to rewrite an invalid W3GS_GAMEINFO packet');
    }
    const copy = Buffer.from(data);
    copy.writeUInt16LE(port, copy.length - 2);
    return copy;
}
//# sourceMappingURL=protocol.js.map