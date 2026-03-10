'use strict';

const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const qrcode = require('qrcode');
const db = require('../db');
const xray = require('../xray');
const audit = require('../audit');

const MAX_DEVICES_PER_USER = 5;

function buildVlessLink({ uuid, domain, publicKey, shortId, deviceName }) {
  const encoded = encodeURIComponent(deviceName);
  return (
    `vless://${uuid}@${domain}:443` +
    `?type=tcp&security=reality` +
    `&pbk=${publicKey}` +
    `&sid=${shortId}` +
    `&sni=www.microsoft.com` +
    `&fp=chrome` +
    `&flow=xtls-rprx-vision` +
    `#${encoded}`
  );
}

module.exports = async function usersRoutes(fastify) {
  const domain    = process.env.DOMAIN;
  const publicKey = process.env.REALITY_PUBLIC_KEY;
  const shortId   = process.env.REALITY_SHORT_ID;

  const adminHooks = { onRequest: [fastify.authenticate, fastify.requireSuperadmin] };

  // GET /users
  fastify.get('/', adminHooks, async (_request, reply) => {
    const { rows } = await db.query(
      `SELECT u.id, u.login, u.role, u.expires_at, u.created_at, u.telegram_id,
              COUNT(d.id)::int AS device_count
       FROM users u
       LEFT JOIN devices d ON d.user_id = u.id
       GROUP BY u.id
       ORDER BY u.created_at DESC`
    );
    return reply.send(rows);
  });

  // POST /users
  fastify.post('/', {
    ...adminHooks,
    schema: {
      body: {
        type: 'object',
        required: ['login', 'password'],
        properties: {
          login:      { type: 'string', minLength: 1, maxLength: 64 },
          password:   { type: 'string', minLength: 8, maxLength: 128 },
          expires_at: { type: 'string', format: 'date-time', nullable: true },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { login, password, expires_at } = request.body;

    const { rows: existing } = await db.query(
      'SELECT id FROM users WHERE login = $1',
      [login]
    );
    if (existing.length > 0) {
      return reply.status(409).send({ error: 'Conflict', message: 'Login already taken' });
    }

    const hash = await bcrypt.hash(password, 12);
    const { rows } = await db.query(
      `INSERT INTO users (login, password_hash, role, expires_at)
       VALUES ($1, $2, 'user', $3)
       RETURNING id, login, role, expires_at, created_at`,
      [login, hash, expires_at || null]
    );

    audit.log(request.user.sub, 'user_create', { user_id: rows[0].id, login }, request.ip);
    return reply.status(201).send(rows[0]);
  });

  // PATCH /users/:id
  fastify.patch('/:id', {
    ...adminHooks,
    schema: {
      params: { type: 'object', properties: { id: { type: 'integer' } } },
      body: {
        type: 'object',
        properties: {
          expires_at: { type: 'string', format: 'date-time', nullable: true },
          disabled:   { type: 'boolean' },
          password:   { type: 'string', minLength: 8, maxLength: 128 },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { id } = request.params;
    const { expires_at, disabled, password } = request.body;

    const { rows: existing } = await db.query('SELECT id, login, expires_at FROM users WHERE id = $1', [id]);
    if (existing.length === 0) {
      return reply.status(404).send({ error: 'Not Found', message: 'User not found' });
    }

    const updates = [];
    const values  = [];
    let idx = 1;

    if (expires_at !== undefined) {
      updates.push(`expires_at = $${idx++}`);
      // If disabled=true shortcut: set expires_at to epoch
      values.push(
        disabled === true ? new Date(0).toISOString() : (expires_at || null)
      );
    } else if (disabled === true) {
      updates.push(`expires_at = $${idx++}`);
      values.push(new Date(0).toISOString());
    }

    if (password !== undefined) {
      const hash = await bcrypt.hash(password, 12);
      updates.push(`password_hash = $${idx++}`);
      values.push(hash);
    }

    if (updates.length === 0) {
      return reply.status(400).send({ error: 'Bad Request', message: 'Nothing to update' });
    }

    values.push(id);
    const { rows } = await db.query(
      `UPDATE users SET ${updates.join(', ')} WHERE id = $${idx}
       RETURNING id, login, role, expires_at, created_at`,
      values
    );

    const isNowBlocked = rows[0].expires_at && new Date(rows[0].expires_at) <= new Date();
    const wasBlocked   = existing[0].expires_at && new Date(existing[0].expires_at) <= new Date();
    if (expires_at !== undefined || disabled !== undefined) {
      const action = isNowBlocked && !wasBlocked ? 'user_block'
                   : !isNowBlocked && wasBlocked  ? 'user_unblock'
                   : null;
      if (action) audit.log(request.user.sub, action, { user_id: id, login: rows[0].login }, request.ip);
    }

    return reply.send(rows[0]);
  });

  // DELETE /users/:id
  fastify.delete('/:id', {
    ...adminHooks,
    schema: {
      params: { type: 'object', properties: { id: { type: 'integer' } } },
    },
  }, async (request, reply) => {
    const { id } = request.params;

    const { rows: userRows } = await db.query('SELECT id, role FROM users WHERE id = $1', [id]);
    if (userRows.length === 0) {
      return reply.status(404).send({ error: 'Not Found', message: 'User not found' });
    }
    if (userRows[0].role === 'superadmin') {
      return reply.status(403).send({ error: 'Forbidden', message: 'Cannot delete superadmin' });
    }

    // Revoke all devices from xray
    const { rows: devices } = await db.query('SELECT uuid FROM devices WHERE user_id = $1', [id]);
    await Promise.allSettled(devices.map(d => xray.removeClient(d.uuid)));

    // CASCADE deletes devices
    await db.query('DELETE FROM users WHERE id = $1', [id]);
    audit.log(request.user.sub, 'user_delete', { user_id: id, login: userRows[0].login }, request.ip);
    return reply.status(204).send();
  });

  // GET /users/:id/devices
  fastify.get('/:id/devices', {
    ...adminHooks,
    schema: {
      params: { type: 'object', properties: { id: { type: 'integer' } } },
    },
  }, async (request, reply) => {
    const { id } = request.params;

    const { rows: userRows } = await db.query('SELECT id FROM users WHERE id = $1', [id]);
    if (userRows.length === 0) {
      return reply.status(404).send({ error: 'Not Found', message: 'User not found' });
    }

    const { rows } = await db.query(
      'SELECT * FROM devices WHERE user_id = $1 ORDER BY created_at DESC',
      [id]
    );
    return reply.send(rows);
  });

  // POST /users/:id/devices  (superadmin adds device for a user)
  fastify.post('/:id/devices', {
    ...adminHooks,
    schema: {
      params: { type: 'object', properties: { id: { type: 'integer' } } },
      body: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 32, pattern: '^[\\w\\s\\-]+$' },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { id } = request.params;
    const { name } = request.body;

    const { rows: userRows } = await db.query('SELECT id FROM users WHERE id = $1', [id]);
    if (userRows.length === 0) {
      return reply.status(404).send({ error: 'Not Found', message: 'User not found' });
    }

    const { rows: countRows } = await db.query(
      'SELECT COUNT(*) AS cnt FROM devices WHERE user_id = $1',
      [id]
    );
    if (parseInt(countRows[0].cnt, 10) >= MAX_DEVICES_PER_USER) {
      return reply.status(409).send({
        error: 'Conflict',
        message: `Device limit of ${MAX_DEVICES_PER_USER} reached for this user`,
      });
    }

    const { rows: nameCheck } = await db.query(
      'SELECT id FROM devices WHERE user_id = $1 AND name = $2',
      [id, name]
    );
    if (nameCheck.length > 0) {
      return reply.status(409).send({ error: 'Conflict', message: 'Device name already exists' });
    }

    const uuid  = uuidv4();
    const email = `${id}_${uuid}`;

    await xray.addClient(uuid, email);

    const { rows } = await db.query(
      'INSERT INTO devices (user_id, name, uuid) VALUES ($1, $2, $3) RETURNING *',
      [id, name, uuid]
    );
    const device = rows[0];

    const link = buildVlessLink({ uuid, domain, publicKey, shortId, deviceName: name });
    const qr   = await qrcode.toDataURL(link, { errorCorrectionLevel: 'M', width: 300 });

    audit.log(request.user.sub, 'device_create', { device_id: device.id, device_name: name, for_user_id: id }, request.ip);
    return reply.status(201).send({ ...device, link, qr });
  });

  // DELETE /users/:userId/devices/:deviceId
  fastify.delete('/:userId/devices/:deviceId', {
    ...adminHooks,
    schema: {
      params: {
        type: 'object',
        properties: {
          userId:   { type: 'integer' },
          deviceId: { type: 'integer' },
        },
      },
    },
  }, async (request, reply) => {
    const { userId, deviceId } = request.params;

    const { rows } = await db.query(
      'SELECT * FROM devices WHERE id = $1 AND user_id = $2',
      [deviceId, userId]
    );
    if (rows.length === 0) {
      return reply.status(404).send({ error: 'Not Found', message: 'Device not found' });
    }

    try {
      await xray.removeClient(rows[0].uuid);
    } catch (err) {
      fastify.log.warn(`[users] xray removeClient failed for ${rows[0].uuid}: ${err.message}`);
    }

    await db.query('DELETE FROM devices WHERE id = $1', [deviceId]);
    audit.log(request.user.sub, 'device_delete', { device_id: deviceId, device_name: rows[0].name, for_user_id: userId }, request.ip);
    return reply.status(204).send();
  });
};
