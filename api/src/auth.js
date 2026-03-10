'use strict';

const fp = require('fastify-plugin');
const { v4: uuidv4 } = require('uuid');

// In-memory token blacklist: Map<jti, expiresAtMs>
// Sufficient for 1-5 users; cleared of expired entries on each login.
const blacklist = new Map();

function purgeExpiredTokens() {
  const now = Date.now();
  for (const [jti, exp] of blacklist) {
    if (exp <= now) blacklist.delete(jti);
  }
}

function blacklistToken(jti, expMs) {
  blacklist.set(jti, expMs);
}

function isBlacklisted(jti) {
  const exp = blacklist.get(jti);
  if (exp === undefined) return false;
  if (exp <= Date.now()) {
    blacklist.delete(jti);
    return false;
  }
  return true;
}

/**
 * Fastify plugin: decorates with authenticate() and requireSuperadmin().
 */
async function authPlugin(fastify) {
  // authenticate: verifies JWT and attaches user payload to request
  fastify.decorate('authenticate', async function (request, reply) {
    try {
      await request.jwtVerify();
    } catch (err) {
      return reply.status(401).send({ error: 'Unauthorized', message: err.message });
    }

    const { jti } = request.user;
    if (jti && isBlacklisted(jti)) {
      return reply.status(401).send({ error: 'Unauthorized', message: 'Token has been revoked' });
    }
  });

  // requireSuperadmin: must be called after authenticate
  fastify.decorate('requireSuperadmin', async function (request, reply) {
    if (request.user?.role !== 'superadmin') {
      return reply.status(403).send({ error: 'Forbidden', message: 'Superadmin access required' });
    }
  });
}

/**
 * Generate a signed JWT.
 * @param {import('fastify').FastifyInstance} fastify
 * @param {{ id: number, login: string, role: string }} user
 */
function signToken(fastify, user) {
  purgeExpiredTokens();
  const jti = uuidv4();
  const token = fastify.jwt.sign(
    { sub: user.id, login: user.login, role: user.role, jti },
    { expiresIn: '24h' }
  );
  return { token, jti };
}

module.exports = {
  authPlugin: fp(authPlugin),
  signToken,
  blacklistToken,
};
