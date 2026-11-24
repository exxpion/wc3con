# Implementation status — November 2026

## Implemented in this revision

- WebSocket protocol version `1` is attached to client and server messages. Both sides reject unsupported versions instead of silently accepting incompatible message shapes.
- Client room actions are blocked until `AUTH_SUCCESS` (not merely until the TCP/WebSocket transport is open).
- Server validates room creation/join payloads, GAMEINFO framing/version, tunnel operation names, connection IDs, and base64 tunnel sizes.
- A transient WebSocket loss preserves room membership for 180 seconds for both host and guests.
- A returning client is restored to its previous room; a guest that misses the grace period is removed; a host that misses the grace period closes the room for everyone.
- Explicit room exit is immediate. Explicit host exit closes the room; explicit guest exit releases the slot.
- Relay pause/resume state events are broadcast when a member disconnects/reconnects while a GAMEINFO session is available.
- The client preserves local TCP endpoints during a temporary relay loss and queues a bounded amount of tunnel traffic while reconnecting or while the room is in relay-paused state. The server suppresses tunnel forwarding until all temporarily disconnected room members have returned or timed out.
- Host TCP tunnels now use the TCP port parsed from the host's current GAMEINFO instead of always hardcoding 6112.
- GAMEINFO port rewriting validates packet structure and port range.
- Host GAMEINFO discovery has a 9-second stale timeout. Guests stop announcing stale GAMEINFO when the host reports that the local game disappeared.
- The launcher now has a `.w3x`/`.w3m` file picker for the host's declared map.
- Relay server URLs can be overridden with `WC3_SERVER_HTTP_URL` and `WC3_SERVER_WS_URL`.

## Not yet implemented / not proven

### Actual Warcraft III in-game freeze and resume

During `relay_paused`, the server stops forwarding W3GS tunnel frames and clients buffer a bounded amount of tunnel traffic. This is intended to stall the synchronized game stream and resume it in order after reconnect. No explicit in-game pause action is injected into WC3, and the exact visible freeze/resume behavior has not yet been verified against real Warcraft III 1.26 clients. Treat this as an implemented relay-level pause attempt, not as a proven in-game freeze feature.

### Player identity enforcement

The launcher account username is available as the canonical identity, but this revision does not yet force the Warcraft III 1.26 in-game player name to that exact value. The reference IrinaConnector archive contains compiled binaries, not source code; class/string names such as `ForcePlayerName` are not sufficient evidence to safely reproduce its implementation.

### Map mismatch warning (`warn`)

The launcher can select and advertise a map filename. The current GAMEINFO parser does not yet decode the actual map path from the encoded stat string. Therefore mismatch detection and the warning are not yet active. The intended policy remains: warn only, never block, never silently replace the room map.

### End-to-end runtime verification

The source archive did not include a complete installed dependency tree. A dependency install attempt did not complete in this environment, so full TypeScript builds and live two-PC WC3 tests have not been confirmed. Run `npm ci` and the documented build/test procedure in a normal Node.js 20 environment.

## Protocol compatibility

The revised client and server both require WebSocket protocol version 1. Deploy the server and the updated client together; do not mix this revision with the old client/server protocol.
