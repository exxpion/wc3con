import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import { setupAuthRoutes } from './auth/index.js';
import { setupWebSocketServer } from './ws/index.js';

const app = Fastify({
  logger: {
    level: 'info',
    transport: {
      target: 'pino-pretty',
      options: {
        translateTime: 'HH:MM:ss Z',
        ignore: 'pid,hostname',
      },
    },
  },
});

// JWT secret - in production, use environment variable
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

async function start() {
  try {
    // Register plugins
    await app.register(cors, {
      origin: true,
      credentials: true,
    });

    await app.register(jwt, {
      secret: JWT_SECRET,
    });

    // Setup routes
    setupAuthRoutes(app);

    // Setup WebSocket server
    setupWebSocketServer(app);

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
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

start();
