# WC3 Connector Project Info

## GitHub Repository
- **URL:** https://github.com/exxpion/wc3con
- **Branch:** main

## VPS Deployment
- **Server Path:** `/opt/wc3con`
- **Server Directory:** `/opt/wc3con/server`
- **Connector Directory:** `/opt/wc3con/connector`
- **Management Tool:** PM2

## Deployment Commands for VPS

### Update & Rebuild Server
```bash
cd /opt/wc3con/server
git pull origin main
npm install
npm run build
pm2 restart <process-name>
# Check process name: pm2 list
```

## Project Structure
- **Server:** TypeScript + Fastify + WebSocket relay
- **Connector:** Electron app (Windows) + WC3 LAN emulation
- **UDP Relay:** Game traffic forwarding via WebSocket tunnel
- **Protocol:** Binary tunnel frames (op:1, conn:4LE, userId:4LE, data?)

## Key Technologies
- WebSocket binary frames for game traffic (optimized from JSON+base64)
- UDP broadcaster for GAMEINFO discovery
- TCP proxy for guest connections
- Host tunnel for W3GS protocol relay

## Important Notes
- Lobby persists even after game ends (legacy issue - being fixed)
- GAMEINFO represents active game state from host's WC3
- Clients can disconnect/reconnect within 180s grace period
- Binary tunnel avoids ~33% base64 overhead
