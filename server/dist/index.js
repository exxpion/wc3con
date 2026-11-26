import { existsSync, readFileSync } from 'fs';
import * as dgram from 'dgram';
import path from 'path';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import { setupAuthRoutes } from './auth/index.js';
import { setupWebSocketServer, registerUdpEndpoint } from './ws/index.js';
import { startDbCleanup } from './db/index.js';
import { initMailer } from './mailer.js';
// Load a local .env file without adding a runtime dependency. Existing process
// environment variables always take precedence.
const envPath = path.resolve(process.cwd(), '.env');
if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
        const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
        if (match && process.env[match[1]] === undefined)
            process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
    }
}
// Init mailer after .env is loaded
initMailer();
const app = Fastify({
    logger: process.env.NODE_ENV === 'production'
        ? { level: 'info' }
        : {
            level: 'info',
            transport: {
                target: 'pino-pretty',
                options: { translateTime: 'HH:MM:ss Z', ignore: 'pid,hostname' },
            },
        },
});
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32 || JWT_SECRET.includes('change-this-secret')) {
    throw new Error('JWT_SECRET must be set to a unique random value of at least 32 characters');
}
const jwtSecret = JWT_SECRET;
async function start() {
    try {
        await app.register(cors, { origin: true, credentials: true });
        await app.register(jwt, { secret: jwtSecret });
        setupAuthRoutes(app);
        setupWebSocketServer(app);
        startDbCleanup();
        app.get('/health', async () => ({ status: 'ok', timestamp: Date.now() }));
        const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;
        const HOST = process.env.HOST || '0.0.0.0';
        await app.listen({ port: PORT, host: HOST });
        console.log(`Server running on http://${HOST}:${PORT}`);
        console.log(`WebSocket available on ws://${HOST}:${PORT}/ws`);
        // ── UDP P2P discovery socket ─────────────────────────────────────────────
        // Clients send a UDP packet here with their JWT so we can learn their
        // external IP:port and register it for hole-punching coordination.
        // UDP and TCP share the same port number space independently, so binding
        // UDP :PORT is fine even though TCP :PORT is already used by Fastify.
        const udp = dgram.createSocket('udp4');
        udp.on('error', (err) => console.error('[UDP-P2P] socket error:', err.message));
        udp.on('message', (msg, rinfo) => {
            try {
                const pkt = JSON.parse(msg.toString('utf8'));
                if (typeof pkt.token !== 'string')
                    return;
                // Verify JWT and get userId
                const decoded = app.jwt.verify(pkt.token);
                if (!Number.isInteger(decoded.userId))
                    return;
                // Store the external endpoint discovered from this UDP packet
                registerUdpEndpoint(decoded.userId, rinfo.address, rinfo.port);
                // Echo the endpoint back so the client knows its external UDP address
                const ack = Buffer.from(JSON.stringify({
                    type: 'p2p_udp_ack',
                    ip: rinfo.address,
                    port: rinfo.port,
                }));
                udp.send(ack, rinfo.port, rinfo.address);
            }
            catch {
                // Invalid JWT or malformed packet — silently ignore
            }
        });
        udp.bind(PORT, HOST, () => {
            console.log(`UDP P2P discovery socket listening on ${HOST}:${PORT}`);
        });
    }
    catch (err) {
        app.log.error(err);
        process.exit(1);
    }
}
start();
//# sourceMappingURL=index.js.map