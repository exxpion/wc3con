const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildSearchGame, buildCreateGame, parseGameInfo, rewriteGameInfoPort,
  W3GS_HEADER, W3GS_SEARCHGAME, W3GS_CREATEGAME, W3GS_GAMEINFO,
} = require('../dist/main/wc3/protocol.js');

function makeGameInfo({ version = 26, port = 6112 } = {}) {
  const prefix = Buffer.alloc(20);
  prefix[0] = W3GS_HEADER;
  prefix[1] = W3GS_GAMEINFO;
  prefix.writeUInt32LE(version, 8);
  prefix.writeUInt32LE(42, 12);
  const strings = Buffer.from('Test Room\0\0stat-string\0', 'utf8');
  const tail = Buffer.alloc(22);
  tail.writeUInt32LE(12, 0);
  tail.writeUInt32LE(8, 12);
  tail.writeUInt16LE(port, 20);
  const packet = Buffer.concat([prefix, strings, tail]);
  packet.writeUInt16LE(packet.length, 2);
  return packet;
}

test('builds W3GS SEARCHGAME and CREATEGAME packets with valid framing', () => {
  const search = buildSearchGame();
  assert.equal(search[0], W3GS_HEADER);
  assert.equal(search[1], W3GS_SEARCHGAME);
  assert.equal(search.readUInt16LE(2), search.length);

  const create = buildCreateGame(26, 77);
  assert.equal(create[1], W3GS_CREATEGAME);
  assert.equal(create.readUInt16LE(2), create.length);
  assert.equal(create.readUInt32LE(12), 77);
});

test('parses valid GAMEINFO and rewrites only the TCP port', () => {
  const packet = makeGameInfo();
  const info = parseGameInfo(packet);
  assert.ok(info);
  assert.equal(info.gameName, 'Test Room');
  assert.equal(info.version, 26);
  assert.equal(info.hostCounter, 42);
  assert.equal(info.slotsTotal, 12);
  assert.equal(info.slotsOpen, 8);
  assert.equal(info.port, 6112);

  const rewritten = rewriteGameInfoPort(packet, 45678);
  assert.equal(parseGameInfo(rewritten).port, 45678);
  assert.equal(packet.readUInt16LE(packet.length - 2), 6112);
});

test('rejects malformed GAMEINFO packets and invalid rewrite ports', () => {
  assert.equal(parseGameInfo(Buffer.from([0xf7, 0x30, 4, 0])), null);
  assert.equal(parseGameInfo(makeGameInfo({ version: 27 } )).version, 27);
  assert.throws(() => rewriteGameInfoPort(Buffer.from([0xf7, 0x30, 4, 0]), 45678));
  assert.throws(() => rewriteGameInfoPort(makeGameInfo(), 0));
});
