'use strict';

const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { signToken, blacklistToken } = require('../auth');
const audit = require('../audit');

// ── In-memory stores ──────────────────────────────────────────────────────────

// captchas: id -> { answer: number, expiresAt: number }
const captchas = new Map();

// lockouts: ip -> { attempts: number, lockedUntil: number, login: string }
const lockouts = new Map();

const LOCKOUT_MAX_ATTEMPTS = 3;
const LOCKOUT_DURATION_MS  = 15 * 60 * 1000; // 15 minutes
const CAPTCHA_TTL_MS       = 5  * 60 * 1000; // 5 minutes

// Periodic cleanup of expired entries
setInterval(() => {
  const now = Date.now();
  for (const [id, c] of captchas) if (c.expiresAt < now) captchas.delete(id);
  for (const [ip, l] of lockouts) if (l.lockedUntil < now && l.attempts === 0) lockouts.delete(ip);
}, 60_000);

function isLocked(ip) {
  const l = lockouts.get(ip);
  if (!l) return null;
  if (l.lockedUntil > Date.now()) return l.lockedUntil;
  // Lock expired — reset attempts
  lockouts.delete(ip);
  return null;
}

function recordFailure(ip, login) {
  const l = lockouts.get(ip) || { attempts: 0, lockedUntil: 0, login };
  l.attempts += 1;
  l.login = login;
  if (l.attempts >= LOCKOUT_MAX_ATTEMPTS) {
    l.lockedUntil = Date.now() + LOCKOUT_DURATION_MS;
    lockouts.set(ip, l);
    return true; // just locked
  }
  lockouts.set(ip, l);
  return false;
}

function resetFailures(ip) {
  lockouts.delete(ip);
}

function attemptsLeft(ip) {
  const l = lockouts.get(ip);
  if (!l) return LOCKOUT_MAX_ATTEMPTS;
  return Math.max(0, LOCKOUT_MAX_ATTEMPTS - l.attempts);
}

async function notifyAdminLockout(ip, login) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  try {
    const { rows } = await db.query(
      "SELECT telegram_id FROM users WHERE role = 'superadmin' AND telegram_id IS NOT NULL LIMIT 1"
    );
    const chatId = rows[0]?.telegram_id;
    if (!chatId) return;
    const text =
      `🚨 *Подозрительная активность*\n\n` +
      `IP \`${ip}\` ввёл пароль неверно 3 раза подряд.\n` +
      `Логин: \`${login}\`\n` +
      `IP заблокирован на *15 минут*.`;
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
    });
  } catch (err) {
    console.error('[auth] Telegram notify failed:', err.message);
  }
}

// ── Routes ────────────────────────────────────────────────────────────────────

module.exports = async function authRoutes(fastify) {
  // GET /auth/captcha
  fastify.get('/captcha', async (_request, reply) => {
    const a  = 1 + Math.floor(Math.random() * 9);
    const b  = 1 + Math.floor(Math.random() * 9);
    const op = Math.random() < 0.5 ? '+' : '-';
    const answer = op === '+' ? a + b : a - b;
    const id = uuidv4();
    captchas.set(id, { answer, expiresAt: Date.now() + CAPTCHA_TTL_MS });
    const question = op === '+' ? `${a} + ${b}` : `${a} − ${b}`;
    return reply.send({ id, question });
  });

  // POST /auth/login
  fastify.post('/login', {
    config: {
      rateLimit: {
        max: 30,
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
        required: ['login', 'password', 'captcha_id', 'captcha_answer'],
        properties: {
          login:          { type: 'string', minLength: 1, maxLength: 64 },
          password:       { type: 'string', minLength: 1 },
          captcha_id:     { type: 'string', minLength: 1 },
          captcha_answer: { type: 'integer' },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { login, password, captcha_id, captcha_answer } = request.body;
    const ip = request.ip;

    // 1. Validate captcha (always consume it — one-use)
    const cap = captchas.get(captcha_id);
    captchas.delete(captcha_id);
    if (!cap || cap.expiresAt < Date.now()) {
      return reply.status(400).send({ error: 'Bad Request', message: 'Капча устарела, обновите страницу' });
    }
    if (cap.answer !== captcha_answer) {
      return reply.status(400).send({ error: 'Bad Request', message: 'Неверный ответ на капчу' });
    }

    // 2. Check lockout
    const lockedUntil = isLocked(ip);
    if (lockedUntil) {
      const secsLeft = Math.ceil((lockedUntil - Date.now()) / 1000);
      return reply.status(429).send({
        error: 'Too Many Requests',
        message: 'IP заблокирован после 3 неудачных попыток',
        locked_until: lockedUntil,
        retry_after:  secsLeft,
      });
    }

    // 3. Look up user
    const { rows } = await db.query(
      'SELECT id, login, password_hash, role, expires_at FROM users WHERE login = $1',
      [login]
    );

    if (rows.length === 0) {
      await bcrypt.compare(password, '$2a$12$invalidhashpadding000000000000000000000000000000000000');
      audit.log(null, 'login_fail', { login }, ip);
      const justLocked = recordFailure(ip, login);
      if (justLocked) notifyAdminLockout(ip, login).catch(() => {});
      const left = attemptsLeft(ip);
      return reply.status(401).send({
        error: 'Unauthorized',
        message: left > 0
          ? `Неверный логин или пароль. Осталось попыток: ${left}`
          : 'IP заблокирован на 15 минут',
        attempts_left: left,
      });
    }

    const user  = rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);

    if (!valid) {
      audit.log(user.id, 'login_fail', { login }, ip);
      const justLocked = recordFailure(ip, login);
      if (justLocked) notifyAdminLockout(ip, login).catch(() => {});
      const left = attemptsLeft(ip);
      return reply.status(401).send({
        error: 'Unauthorized',
        message: left > 0
          ? `Неверный логин или пароль. Осталось попыток: ${left}`
          : 'IP заблокирован на 15 минут',
        attempts_left: left,
      });
    }

    if (user.expires_at && new Date(user.expires_at) < new Date()) {
      audit.log(user.id, 'login_fail', { login, reason: 'expired' }, ip);
      return reply.status(403).send({ error: 'Forbidden', message: 'Account has expired' });
    }

    resetFailures(ip);
    const { token } = signToken(fastify, user);
    audit.log(user.id, 'login_ok', { login }, ip);
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
