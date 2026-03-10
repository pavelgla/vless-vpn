'use strict';

const os = require('os');
const db = require('../db');
const { ONLINE_WINDOW } = require('../poller');

function getCpuUsage() {
  const load1m = os.loadavg()[0];
  return Math.min(100, Math.round((load1m / os.cpus().length) * 100));
}

function fmtBytes(b) {
  if (!b) return 0;
  return Number(b);
}

module.exports = async function statsRoutes(fastify) {

  // ── GET /stats/me ─────────────────────────────────────────────────────────
  // Own traffic totals + per-device + daily chart for last 30 days
  fastify.get('/me', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    const { sub: userId } = request.user;

    const { rows: devices } = await db.query(
      `SELECT id, name, uuid, last_seen_at, last_ip FROM devices WHERE user_id = $1`,
      [userId]
    );

    // Totals from traffic_daily
    const { rows: totals } = await db.query(
      `SELECT
         d.id AS device_id,
         d.name,
         d.uuid,
         d.last_seen_at,
         d.last_ip,
         COALESCE(SUM(t.bytes_up),   0)::bigint AS bytes_up,
         COALESCE(SUM(t.bytes_down), 0)::bigint AS bytes_down
       FROM devices d
       LEFT JOIN traffic_daily t ON t.device_id = d.id
       WHERE d.user_id = $1
       GROUP BY d.id`,
      [userId]
    );

    // Daily chart: last 30 days, all devices summed
    const { rows: daily } = await db.query(
      `SELECT date, SUM(bytes_up)::bigint AS bytes_up, SUM(bytes_down)::bigint AS bytes_down
       FROM traffic_daily
       WHERE device_id = ANY(
         SELECT id FROM devices WHERE user_id = $1
       )
       AND date >= CURRENT_DATE - INTERVAL '29 days'
       GROUP BY date
       ORDER BY date`,
      [userId]
    );

    // Today's traffic
    const { rows: todayRow } = await db.query(
      `SELECT COALESCE(SUM(bytes_up),0)::bigint AS up, COALESCE(SUM(bytes_down),0)::bigint AS down
       FROM traffic_daily
       WHERE device_id = ANY(SELECT id FROM devices WHERE user_id = $1)
       AND date = CURRENT_DATE`,
      [userId]
    );

    const totalUp   = totals.reduce((s, r) => s + fmtBytes(r.bytes_up),   0);
    const totalDown = totals.reduce((s, r) => s + fmtBytes(r.bytes_down), 0);

    return reply.send({
      total: {
        bytes_up:   totalUp,
        bytes_down: totalDown,
        today_up:   fmtBytes(todayRow[0]?.up),
        today_down: fmtBytes(todayRow[0]?.down),
      },
      devices: totals.map(r => ({
        id:          r.device_id,
        name:        r.name,
        uuid:        r.uuid,
        last_seen_at: r.last_seen_at,
        last_ip:     r.last_ip,
        bytes_up:    fmtBytes(r.bytes_up),
        bytes_down:  fmtBytes(r.bytes_down),
        online:      r.last_seen_at
          ? Date.now() - new Date(r.last_seen_at).getTime() < ONLINE_WINDOW
          : false,
      })),
      daily,
    });
  });

  // ── GET /stats/devices/:id/daily ──────────────────────────────────────────
  // Daily traffic for one device, last N days (default 30)
  fastify.get('/devices/:id/daily', {
    onRequest: [fastify.authenticate],
    schema: {
      params: { type: 'object', properties: { id: { type: 'integer' } } },
      querystring: {
        type: 'object',
        properties: { days: { type: 'integer', minimum: 1, maximum: 365, default: 30 } },
      },
    },
  }, async (request, reply) => {
    const { sub: userId, role } = request.user;
    const { id }   = request.params;
    const { days = 30 } = request.query;

    // Ownership check
    const { rows } = await db.query(
      `SELECT id FROM devices WHERE id = $1 AND ($2 = 'superadmin' OR user_id = $3)`,
      [id, role, userId]
    );
    if (rows.length === 0) {
      return reply.status(404).send({ error: 'Not Found', message: 'Device not found' });
    }

    const { rows: daily } = await db.query(
      `SELECT date, bytes_up::bigint, bytes_down::bigint
       FROM traffic_daily
       WHERE device_id = $1 AND date >= CURRENT_DATE - ($2 - 1) * INTERVAL '1 day'
       ORDER BY date`,
      [id, days]
    );

    return reply.send(daily);
  });

  // ── GET /stats/devices/:id/connections ────────────────────────────────────
  // Last 50 connection log entries for one device
  fastify.get('/devices/:id/connections', {
    onRequest: [fastify.authenticate],
    schema: {
      params: { type: 'object', properties: { id: { type: 'integer' } } },
    },
  }, async (request, reply) => {
    const { sub: userId, role } = request.user;
    const { id } = request.params;

    const { rows: check } = await db.query(
      `SELECT id FROM devices WHERE id = $1 AND ($2 = 'superadmin' OR user_id = $3)`,
      [id, role, userId]
    );
    if (check.length === 0) {
      return reply.status(404).send({ error: 'Not Found', message: 'Device not found' });
    }

    const { rows } = await db.query(
      `SELECT client_ip, connected_at
       FROM connection_log
       WHERE device_id = $1
       ORDER BY connected_at DESC
       LIMIT 50`,
      [id]
    );
    return reply.send(rows);
  });

  // ── GET /stats/online ─────────────────────────────────────────────────────
  // List of all devices currently online (last_seen within ONLINE_WINDOW)
  fastify.get('/online', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    const { sub: userId, role } = request.user;
    const threshold = new Date(Date.now() - ONLINE_WINDOW);

    let rows;
    if (role === 'superadmin') {
      ({ rows } = await db.query(
        `SELECT d.id, d.name, d.last_seen_at, d.last_ip, u.login AS owner_login
         FROM devices d JOIN users u ON u.id = d.user_id
         WHERE d.last_seen_at > $1
         ORDER BY d.last_seen_at DESC`,
        [threshold]
      ));
    } else {
      ({ rows } = await db.query(
        `SELECT id, name, last_seen_at, last_ip
         FROM devices
         WHERE user_id = $1 AND last_seen_at > $2
         ORDER BY last_seen_at DESC`,
        [userId, threshold]
      ));
    }
    return reply.send(rows);
  });

  // ── GET /stats/server  (superadmin only) ──────────────────────────────────
  fastify.get('/server', {
    onRequest: [fastify.authenticate, fastify.requireSuperadmin],
  }, async (_request, reply) => {
    const totalMem = os.totalmem();
    const freeMem  = os.freemem();
    const usedMem  = totalMem - freeMem;

    const { rows: counts } = await db.query(
      `SELECT
         (SELECT COUNT(*) FROM users  WHERE role = 'user')::int  AS user_count,
         (SELECT COUNT(*) FROM devices)::int                     AS device_count`
    );

    const threshold = new Date(Date.now() - ONLINE_WINDOW);
    const { rows: onlineRow } = await db.query(
      `SELECT COUNT(*)::int AS cnt FROM devices WHERE last_seen_at > $1`,
      [threshold]
    );

    // Total traffic all time from DB
    const { rows: trafficRow } = await db.query(
      `SELECT COALESCE(SUM(bytes_up),0)::bigint   AS total_up,
              COALESCE(SUM(bytes_down),0)::bigint AS total_down
       FROM traffic_daily`
    );

    // Per-user traffic totals (last 30 days)
    const { rows: userTraffic } = await db.query(
      `SELECT u.id, u.login,
              COALESCE(SUM(t.bytes_up),   0)::bigint AS bytes_up,
              COALESCE(SUM(t.bytes_down), 0)::bigint AS bytes_down
       FROM users u
       LEFT JOIN devices d  ON d.user_id = u.id
       LEFT JOIN traffic_daily t ON t.device_id = d.id
         AND t.date >= CURRENT_DATE - INTERVAL '30 days'
       WHERE u.role = 'user'
       GROUP BY u.id, u.login`
    );

    // Active xray clients (from config)
    let activeClients = 0;
    try {
      const xray = require('../xray');
      activeClients = xray.listClients().length;
    } catch { /* non-fatal */ }

    return reply.send({
      cpu: {
        cores:     os.cpus().length,
        model:     os.cpus()[0]?.model || 'unknown',
        usage_pct: getCpuUsage(),
        loadavg:   os.loadavg(),
      },
      memory: {
        total_mb:  Math.round(totalMem / 1024 / 1024),
        used_mb:   Math.round(usedMem  / 1024 / 1024),
        free_mb:   Math.round(freeMem  / 1024 / 1024),
        usage_pct: Math.round((usedMem / totalMem) * 100),
      },
      uptime_s:       os.uptime(),
      users:          counts[0].user_count,
      devices:        counts[0].device_count,
      online_devices: onlineRow[0].cnt,
      xray: { active_clients: activeClients },
      traffic: {
        bytes_up:   fmtBytes(trafficRow[0].total_up),
        bytes_down: fmtBytes(trafficRow[0].total_down),
        total:      fmtBytes(trafficRow[0].total_up) + fmtBytes(trafficRow[0].total_down),
      },
      user_traffic: userTraffic,
    });
  });

  // GET /stats/audit  (superadmin only)
  fastify.get('/audit', {
    onRequest: [fastify.authenticate, fastify.requireSuperadmin],
    schema: {
      querystring: {
        type: 'object',
        properties: { limit: { type: 'integer', minimum: 1, maximum: 500, default: 200 } },
      },
    },
  }, async (request, reply) => {
    const limit = request.query.limit || 200;
    const { rows } = await db.query(
      `SELECT a.id, a.action, a.details, a.ip, a.created_at,
              u.login AS user_login
       FROM audit_log a
       LEFT JOIN users u ON u.id = a.user_id
       ORDER BY a.created_at DESC
       LIMIT $1`,
      [limit]
    );
    return reply.send(rows);
  });
};
