const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const files = [
  path.join(root, 'connector/src/main/types.ts'),
  path.join(root, 'server/src/types/index.ts'),
];

function readEnum(file) {
  const source = fs.readFileSync(file, 'utf8');
  const block = source.match(/export\s+enum\s+WSMessageType\s*\{([\s\S]*?)\}/);
  if (!block) throw new Error(`WSMessageType enum not found in ${file}`);
  return new Map([...block[1].matchAll(/([A-Z][A-Z0-9_]*)\s*=\s*'([^']+)'/g)]
    .map((match) => [match[1], match[2]]));
}

const [client, server] = files.map(readEnum);
const problems = [];
for (const [key, value] of client) {
  if (server.get(key) !== value) problems.push(`server missing or mismatches ${key}='${value}'`);
}
for (const [key, value] of server) {
  if (client.get(key) !== value) problems.push(`client missing or mismatches ${key}='${value}'`);
}

const clientSource = fs.readFileSync(path.join(root, 'connector/src/main/wc3/ws-relay-client.ts'), 'utf8');
const serverSource = fs.readFileSync(path.join(root, 'server/src/ws/index.ts'), 'utf8');
if (!/WS_PROTOCOL_VERSION\s*=\s*1/.test(clientSource)) problems.push('client protocol version is not 1');
if (!/PROTOCOL_VERSION\s*=\s*1/.test(serverSource)) problems.push('server protocol version is not 1');
if (!/RECONNECT_GRACE_MS\s*=\s*180_000/.test(serverSource)) problems.push('server reconnect grace period is not 180 seconds');
if (!/},\s*180_000\)/.test(clientSource)) problems.push('client reconnect grace period is not 180 seconds');

if (problems.length) {
  console.error('WebSocket protocol mismatch:\n- ' + problems.join('\n- '));
  process.exit(1);
}
console.log(`WebSocket protocol OK: ${client.size} message types, protocolVersion=1`);
