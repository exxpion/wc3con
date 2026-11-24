/** W3GS packet helpers for Warcraft III 1.26. */
export const W3GS_HEADER = 0xf7;
export const W3GS_SEARCHGAME = 0x2f;
export const W3GS_GAMEINFO = 0x30;
export const W3GS_CREATEGAME = 0x31;
export const WC3_VERSION = 26;
const PRODUCT_TFT = Buffer.from('PX3W', 'ascii');

export function isW3gsPacket(data: Buffer, expectedType?: number): boolean {
  if (!Buffer.isBuffer(data) || data.length < 4) return false;
  if (data.readUInt8(0) !== W3GS_HEADER) return false;
  if (expectedType !== undefined && data.readUInt8(1) !== expectedType) return false;
  return data.readUInt16LE(2) === data.length;
}

export function buildSearchGame(version = WC3_VERSION): Buffer {
  const buf = Buffer.alloc(16);
  buf.writeUInt8(W3GS_HEADER, 0);
  buf.writeUInt8(W3GS_SEARCHGAME, 1);
  buf.writeUInt16LE(buf.length, 2);
  PRODUCT_TFT.copy(buf, 4);
  buf.writeUInt32LE(version >>> 0, 8);
  buf.writeUInt32LE(0, 12);
  return buf;
}

export function buildCreateGame(version = WC3_VERSION, hostCounter = 1): Buffer {
  const buf = Buffer.alloc(16);
  buf.writeUInt8(W3GS_HEADER, 0);
  buf.writeUInt8(W3GS_CREATEGAME, 1);
  buf.writeUInt16LE(buf.length, 2);
  PRODUCT_TFT.copy(buf, 4);
  buf.writeUInt32LE(version >>> 0, 8);
  buf.writeUInt32LE(hostCounter >>> 0, 12);
  return buf;
}

export interface ParsedGameInfo {
  version: number;
  hostCounter: number;
  gameName: string;
  slotsTotal: number;
  slotsOpen: number;
  port: number;
}

/** Parse only structurally valid W3GS_GAMEINFO packets. */
export function parseGameInfo(data: Buffer): ParsedGameInfo | null {
  if (!isW3gsPacket(data, W3GS_GAMEINFO) || data.length < 42) return null;
  const version = data.readUInt32LE(8);
  const hostCounter = data.readUInt32LE(12);
  let offset = 20;

  const nameEnd = data.indexOf(0, offset);
  if (nameEnd < 0) return null;
  const gameName = data.toString('utf8', offset, nameEnd);
  offset = nameEnd + 1;

  const passwordEnd = data.indexOf(0, offset);
  if (passwordEnd < 0) return null;
  offset = passwordEnd + 1;

  const statEnd = data.indexOf(0, offset);
  if (statEnd < 0) return null;
  offset = statEnd + 1;

  // The fixed GAMEINFO tail is 22 bytes in the supported 1.26 layout.
  if (data.length - offset !== 22) return null;
  const port = data.readUInt16LE(data.length - 2);
  if (port < 1 || port > 65535) return null;

  return {
    version,
    hostCounter,
    gameName,
    slotsTotal: data.readUInt32LE(offset),
    slotsOpen: data.readUInt32LE(offset + 12),
    port,
  };
}

export function rewriteGameInfoPort(data: Buffer, port: number): Buffer {
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
