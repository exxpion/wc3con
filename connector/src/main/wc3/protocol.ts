/**
 * W3GS (Warcraft III Game Sockets) — минимальная реализация для WC3 1.26
 *
 * Все пакеты: [0xF7][тип][длина uint16 LE][данные]
 *
 * Коннектор НЕ строит GAMEINFO сам: он берёт настоящий пакет, который отдаёт
 * хостящая игра Warcraft III в ответ на SEARCHGAME, и только подменяет в нём порт.
 */

export const W3GS_HEADER = 0xf7;

export const W3GS_SEARCHGAME = 0x2f;
export const W3GS_GAMEINFO = 0x30;
export const W3GS_CREATEGAME = 0x31;

/** Версия клиента: 26 = патч 1.26 */
export const WC3_VERSION = 26;

/** Продукт «The Frozen Throne» (в пакете записывается как "PX3W") */
const PRODUCT_TFT = Buffer.from('PX3W', 'ascii');

/** Пакет W3GS_SEARCHGAME: «есть ли тут игры?» */
export function buildSearchGame(version: number = WC3_VERSION): Buffer {
  const buf = Buffer.alloc(16);
  buf.writeUInt8(W3GS_HEADER, 0);
  buf.writeUInt8(W3GS_SEARCHGAME, 1);
  buf.writeUInt16LE(16, 2);
  PRODUCT_TFT.copy(buf, 4);
  buf.writeUInt32LE(version, 8);
  buf.writeUInt32LE(0, 12);
  return buf;
}

/** Пакет W3GS_CREATEGAME: «в сети появилась игра» (отправляется один раз перед GAMEINFO) */
export function buildCreateGame(version: number = WC3_VERSION, hostCounter = 1): Buffer {
  const buf = Buffer.alloc(16);
  buf.writeUInt8(W3GS_HEADER, 0);
  buf.writeUInt8(W3GS_CREATEGAME, 1);
  buf.writeUInt16LE(16, 2);
  PRODUCT_TFT.copy(buf, 4);
  buf.writeUInt32LE(version, 8);
  buf.writeUInt32LE(hostCounter, 12);
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

/**
 * Разбор W3GS_GAMEINFO.
 *
 * Раскладка:
 *  F7 30 len(2) | product(4) | version(4) | hostCounter(4) | entryKey(4) |
 *  gameName\0 | password\0 | statString\0 |
 *  slotsTotal(4) | gameType(4) | unknown(4) | slotsOpen(4) | upTime(4) | port(2)
 *
 * Возвращает null, если пакет не похож на GAMEINFO.
 */
export function parseGameInfo(data: Buffer): ParsedGameInfo | null {
  if (data.length < 4 + 16 + 3 + 22) return null;
  if (data.readUInt8(0) !== W3GS_HEADER || data.readUInt8(1) !== W3GS_GAMEINFO) return null;
  if (data.readUInt16LE(2) !== data.length) return null;

  const version = data.readUInt32LE(8);
  const hostCounter = data.readUInt32LE(12);

  let offset = 20;
  const nameEnd = data.indexOf(0, offset);
  if (nameEnd < 0) return null;
  const gameName = data.toString('utf8', offset, nameEnd);
  offset = nameEnd + 1;

  const passEnd = data.indexOf(0, offset); // пароль (обычно пустой)
  if (passEnd < 0) return null;
  offset = passEnd + 1;

  const statEnd = data.indexOf(0, offset); // stat string (закодирован без нулевых байт)
  if (statEnd < 0) return null;
  offset = statEnd + 1;

  if (data.length - offset !== 22) return null;

  return {
    version,
    hostCounter,
    gameName,
    slotsTotal: data.readUInt32LE(offset),
    slotsOpen: data.readUInt32LE(offset + 12),
    port: data.readUInt16LE(data.length - 2),
  };
}

/** Копия GAMEINFO с другим TCP-портом (последние 2 байта пакета) */
export function rewriteGameInfoPort(data: Buffer, port: number): Buffer {
  const copy = Buffer.from(data);
  copy.writeUInt16LE(port, copy.length - 2);
  return copy;
}
