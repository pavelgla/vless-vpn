'use strict';

const fastify = require('fastify')({
  logger: {
    level: process.env.LOG_LEVEL || 'info',
    transport: process.env.NODE_ENV !== 'production'
      ? { target: 'pino-pretty' }
      : undefined,
  },
  trustProxy: true,
});

const { authPlugin } = require('./auth');

async function bootstrap() {
  // ── Plugins ───────────────────────────────────────────────────────────────
  await fastify.register(require('@fastify/cors'), {
    origin: process.env.CORS_ORIGIN || false,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true,
  });

  await fastify.register(require('@fastify/jwt'), {
    secret: process.env.JWT_SECRET,
  });

  await fastify.register(require('@fastify/rate-limit'), {
    global: false, // applied per-route
    max: 100,
    timeWindow: '1 minute',
  });

  await fastify.register(authPlugin);

  // ── Health ────────────────────────────────────────────────────────────────
  fastify.get('/health', async () => ({ status: 'ok', ts: new Date().toISOString() }));

  // ── Routes ────────────────────────────────────────────────────────────────
  await fastify.register(require('./routes/auth'),    { prefix: '/auth' });
  await fastify.register(require('./routes/devices'), { prefix: '/devices' });
  await fastify.register(require('./routes/users'),   { prefix: '/users' });
  await fastify.register(require('./routes/stats'),   { prefix: '/stats' });

  // ── 404 ───────────────────────────────────────────────────────────────────
  fastify.setNotFoundHandler((request, reply) => {
    reply.status(404).send({ error: 'Not Found', path: request.url });
  });

  // ── Error handler ─────────────────────────────────────────────────────────
  fastify.setErrorHandler((error, request, reply) => {
    const status = error.statusCode || 500;
    if (status >= 500) {
      fastify.log.error(error);
    }
    reply.status(status).send({
      error: error.name || 'Error',
      message: error.message,
      ...(process.env.NODE_ENV !== 'production' && { stack: error.stack }),
    });
  });

  // ── Start ─────────────────────────────────────────────────────────────────
  const port = parseInt(process.env.PORT || '3000', 10);
  await fastify.listen({ port, host: '0.0.0.0' });
  fastify.log.info(`API listening on port ${port}`);
}

bootstrap().catch((err) => {
  console.error('[fatal] Failed to start API:', err);
  process.exit(1);
});

process.on('SIGTERM', async () => {
  fastify.log.info('SIGTERM received, shutting down');
  await fastify.close();
  process.exit(0);
});
