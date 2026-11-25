import { existsSync, readFileSync } from 'fs';
import path from 'path';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import { setupAuthRoutes } from './auth/index.js';
import { setupWebSocketServer } from './ws/index.js';
import { startDbCleanup } from './db/index.js';
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
const jwtSecret = JWT_SECRET; // Type assertion after validation
async function start() {
    try {
        // Register plugins
        await app.register(cors, {
            origin: true,
            credentials: true,
        });
        await app.register(jwt, {
            secret: jwtSecret,
        });
        // Setup routes
        setupAuthRoutes(app);
        // Setup WebSocket server
        setupWebSocketServer(app);
        // Start periodic cleanup of expired codes / stale pending registrations
        startDbCleanup();
        // Health check
        app.get('/health', async () => {
            return { status: 'ok', timestamp: Date.now() };
        });
        // Start server
        const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;
        const HOST = process.env.HOST || '0.0.0.0';
        await app.listen({ port: PORT, host: HOST });
        console.log(`🚀 Server running on http://${HOST}:${PORT}`);
        console.log(`🔌 WebSocket available on ws://${HOST}:${PORT}/ws`);
    }
    catch (err) {
        app.log.error(err);
        process.exit(1);
    }
}
start();
//# sourceMappingURL=index.js.map