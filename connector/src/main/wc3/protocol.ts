/**
 * W3GS (Warcraft 3 Game Sockets) Protocol implementation for WC3 1.26-1.29
 * 
 * All packets start with: [0xF7][type][length_uint16_le][data]
 */

export const W3GS_HEADER = 0xF7;

// Packet types
export enum W3GSPacketType {
  SEARCHGAME = 0x2F,      // Client broadcasts to search for games
  GAMEINFO = 0x30,        // Host responds with game info
  CREATEGAME = 0x31,      // Create game
  REFRESHGAME = 0x32,     // Refresh/update game
  DECREATEGAME = 0x33,    // Remove game
}

export interface GameInfo {
  gameId: number;
  name: string;
  map: string;
  slots: number;
  slotsUsed: number;
  gameType: number;       // 0x00 = custom, 0x01 = ladder, etc.
  gameState: number;      // 0x00 = private, 0x01 = public
}

/**
 * Build W3GS_GAMEINFO packet for UDP broadcast
 */
export function buildGameInfoPacket(game: GameInfo): Buffer {
  const nameBytes = Buffer.from(game.name, 'utf8');
  const mapBytes = Buffer.from(game.map, 'utf8');
  
  // Calculate packet length
  const length = 4 + 4 + 1 + nameBytes.length + 1 + mapBytes.length + 1 + 4 + 4 + 4 + 4;
  
  const buffer = Buffer.alloc(length);
  let offset = 0;
  
  // Header
  buffer.writeUInt8(W3GS_HEADER, offset); offset += 1;
  buffer.writeUInt8(W3GSPacketType.GAMEINFO, offset); offset += 1;
  buffer.writeUInt16LE(length, offset); offset += 2;
  
  // Game ID
  buffer.writeUInt32LE(game.gameId, offset); offset += 4;
  
  // Game type
  buffer.writeUInt8(game.gameType, offset); offset += 1;
  
  // Game name (null-terminated string)
  nameBytes.copy(buffer, offset);
  offset += nameBytes.length;
  buffer.writeUInt8(0, offset); offset += 1;
  
  // Map name (null-terminated string)
  mapBytes.copy(buffer, offset);
  offset += mapBytes.length;
  buffer.writeUInt8(0, offset); offset += 1;
  
  // Slots total
  buffer.writeUInt32LE(game.slots, offset); offset += 4;
  
  // Slots used
  buffer.writeUInt32LE(game.slotsUsed, offset); offset += 4;
  
  // Game state
  buffer.writeUInt32LE(game.gameState, offset); offset += 4;
  
  // Port (always 6112)
  buffer.writeUInt32LE(6112, offset); offset += 4;
  
  return buffer;
}

/**
 * Parse W3GS_SEARCHGAME packet (client is looking for games)
 */
export function parseSearchGamePacket(data: Buffer): boolean {
  if (data.length < 4) return false;
  
  const header = data.readUInt8(0);
  const type = data.readUInt8(1);
  
  return header === W3GS_HEADER && type === W3GSPacketType.SEARCHGAME;
}
