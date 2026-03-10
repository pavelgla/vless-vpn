'use strict';

const bcrypt = require('bcryptjs');
const db = require('../db');
const { signToken, blacklistToken } = require('../auth');
const audit = require('../audit');

module.exports = async function authRoutes(fastify) {
  // POST /auth/login
  fastify.post('/login', {
    config: {
      rateLimit: {
        max: 10,
        timeWindow: '1 minute',
        keyGenerator: (req) => req.ip,
        errorResponseBuilder: () => ({
          error: 'Too Many Requests',
          message: 'Too many login attempts. Try again in 1 minute.',
        }),
      },
    },
    schema: {
      body: {
        type: 'object',
        required: ['login', 'password'],
        properties: {
          login:    { type: 'string', minLength: 1, maxLength: 64 },
          password: { type: 'string', minLength: 1 },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { login, password } = request.body;

    const { rows } = await db.query(
      'SELECT id, login, password_hash, role, expires_at FROM users WHERE login = $1',
      [login]
    );

    if (rows.length === 0) {
      // Constant-time dummy compare to prevent timing attacks
      await bcrypt.compare(password, '$2a$12$invalidhashpadding000000000000000000000000000000000000');
      audit.log(null, 'login_fail', { login }, request.ip);
      return reply.status(401).send({ error: 'Unauthorized', message: 'Invalid credentials' });
    }

    const user = rows[0];

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      audit.log(user.id, 'login_fail', { login }, request.ip);
      return reply.status(401).send({ error: 'Unauthorized', message: 'Invalid credentials' });
    }

    if (user.expires_at && new Date(user.expires_at) < new Date()) {
      audit.log(user.id, 'login_fail', { login, reason: 'expired' }, request.ip);
      return reply.status(403).send({ error: 'Forbidden', message: 'Account has expired' });
    }

    const { token } = signToken(fastify, user);
    audit.log(user.id, 'login_ok', { login }, request.ip);
    return reply.send({ token, role: user.role, login: user.login });
  });

  // POST /auth/change-password
  fastify.post('/change-password', {
    onRequest: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['old_password', 'new_password'],
        properties: {
          old_password: { type: 'string', minLength: 1 },
          new_password: { type: 'string', minLength: 8, maxLength: 128 },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const userId = request.user.sub;
    const { old_password, new_password } = request.body;

    const { rows } = await db.query(
      'SELECT password_hash FROM users WHERE id = $1',
      [userId]
    );

    if (rows.length === 0) {
      return reply.status(404).send({ error: 'Not Found', message: 'User not found' });
    }

    const valid = await bcrypt.compare(old_password, rows[0].password_hash);
    if (!valid) {
      return reply.status(401).send({ error: 'Unauthorized', message: 'Incorrect current password' });
    }

    const hash = await bcrypt.hash(new_password, 12);
    await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, userId]);

    audit.log(userId, 'password_change', {}, request.ip);
    return reply.send({ message: 'Password updated' });
  });

  // POST /auth/logout
  fastify.post('/logout', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    const { jti, exp, sub: userId } = request.user;
    if (jti && exp) {
      blacklistToken(jti, exp * 1000);
    }
    audit.log(userId, 'logout', {}, request.ip);
    return reply.send({ message: 'Logged out' });
  });
};
