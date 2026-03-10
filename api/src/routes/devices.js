'use strict';

const { v4: uuidv4 } = require('uuid');
const qrcode = require('qrcode');
const db = require('../db');
const xray = require('../xray');

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

async function generateQr(link) {
  return qrcode.toDataURL(link, { errorCorrectionLevel: 'M', width: 300 });
}

// Check ownership: returns device row or throws
async function getOwnedDevice(deviceId, userId, role) {
  const { rows } = await db.query(
    'SELECT * FROM devices WHERE id = $1',
    [deviceId]
  );
  if (rows.length === 0) {
    const err = new Error('Device not found');
    err.statusCode = 404;
    throw err;
  }
  if (role !== 'superadmin' && rows[0].user_id !== userId) {
    const err = new Error('Access denied');
    err.statusCode = 403;
    throw err;
  }
  return rows[0];
}

module.exports = async function devicesRoutes(fastify) {
  const domain    = process.env.DOMAIN;
  const publicKey = process.env.REALITY_PUBLIC_KEY;
  const shortId   = process.env.REALITY_SHORT_ID;

  // GET /devices
  fastify.get('/', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    const { sub: userId, role } = request.user;

    let result;
    if (role === 'superadmin') {
      result = await db.query(
        `SELECT d.*, u.login AS owner_login
         FROM devices d
         JOIN users u ON u.id = d.user_id
         ORDER BY d.created_at DESC`
      );
    } else {
      result = await db.query(
        'SELECT * FROM devices WHERE user_id = $1 ORDER BY created_at DESC',
        [userId]
      );
    }
    return reply.send(result.rows);
  });

  // POST /devices
  fastify.post('/', {
    onRequest: [fastify.authenticate],
    schema: {
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
    const { sub: userId, role } = request.user;
    const { name } = request.body;

    // Superadmin has no device limit
    if (role !== 'superadmin') {
      const { rows: countRows } = await db.query(
        'SELECT COUNT(*) AS cnt FROM devices WHERE user_id = $1',
        [userId]
      );
      if (parseInt(countRows[0].cnt, 10) >= MAX_DEVICES_PER_USER) {
        return reply.status(409).send({
          error: 'Conflict',
          message: `Device limit of ${MAX_DEVICES_PER_USER} reached`,
        });
      }
    }

    // Name must be unique per user
    const { rows: nameCheck } = await db.query(
      'SELECT id FROM devices WHERE user_id = $1 AND name = $2',
      [userId, name]
    );
    if (nameCheck.length > 0) {
      return reply.status(409).send({ error: 'Conflict', message: 'Device name already exists' });
    }

    const uuid = uuidv4();
    const email = `${userId}_${uuid}`;

    await xray.addClient(uuid, email);

    const { rows } = await db.query(
      `INSERT INTO devices (user_id, name, uuid)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [userId, name, uuid]
    );
    const device = rows[0];

    const link = buildVlessLink({ uuid, domain, publicKey, shortId, deviceName: name });
    const qr   = await generateQr(link);

    return reply.status(201).send({ ...device, link, qr });
  });

  // PATCH /devices/:id
  fastify.patch('/:id', {
    onRequest: [fastify.authenticate],
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
    const { sub: userId, role } = request.user;
    const { id } = request.params;
    const { name } = request.body;

    const device = await getOwnedDevice(id, userId, role);

    // Check new name uniqueness within user
    const { rows: nameCheck } = await db.query(
      'SELECT id FROM devices WHERE user_id = $1 AND name = $2 AND id != $3',
      [device.user_id, name, id]
    );
    if (nameCheck.length > 0) {
      return reply.status(409).send({ error: 'Conflict', message: 'Device name already exists' });
    }

    const { rows } = await db.query(
      'UPDATE devices SET name = $1 WHERE id = $2 RETURNING *',
      [name, id]
    );
    return reply.send(rows[0]);
  });

  // DELETE /devices/:id
  fastify.delete('/:id', {
    onRequest: [fastify.authenticate],
    schema: {
      params: { type: 'object', properties: { id: { type: 'integer' } } },
    },
  }, async (request, reply) => {
    const { sub: userId, role } = request.user;
    const { id } = request.params;

    const device = await getOwnedDevice(id, userId, role);

    try {
      await xray.removeClient(device.uuid);
    } catch (err) {
      fastify.log.warn(`[devices] xray removeClient failed for ${device.uuid}: ${err.message}`);
    }

    await db.query('DELETE FROM devices WHERE id = $1', [id]);
    return reply.status(204).send();
  });

  // GET /devices/:id/link
  fastify.get('/:id/link', {
    onRequest: [fastify.authenticate],
    schema: {
      params: { type: 'object', properties: { id: { type: 'integer' } } },
    },
  }, async (request, reply) => {
    const { sub: userId, role } = request.user;
    const { id } = request.params;

    const device = await getOwnedDevice(id, userId, role);

    const link = buildVlessLink({
      uuid: device.uuid,
      domain,
      publicKey,
      shortId,
      deviceName: device.name,
    });
    return reply.send({ link });
  });

  // GET /devices/:id/qr
  fastify.get('/:id/qr', {
    onRequest: [fastify.authenticate],
    schema: {
      params: { type: 'object', properties: { id: { type: 'integer' } } },
    },
  }, async (request, reply) => {
    const { sub: userId, role } = request.user;
    const { id } = request.params;

    const device = await getOwnedDevice(id, userId, role);

    const link = buildVlessLink({
      uuid: device.uuid,
      domain,
      publicKey,
      shortId,
      deviceName: device.name,
    });
    const qr = await generateQr(link);
    return reply.send({ qr, link });
  });
};
