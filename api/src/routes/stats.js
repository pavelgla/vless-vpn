'use strict';

const os = require('os');
const db = require('../db');
const xray = require('../xray');

/**
 * Aggregate xray traffic stats for a list of device rows.
 * Returns { uplink, downlink } in bytes.
 */
async function aggregateTraffic(devices) {
  if (devices.length === 0) return { uplink: 0, downlink: 0 };

  const results = await Promise.allSettled(
    devices.map(d => xray.getStats(`${d.user_id}_${d.uuid}`))
  );

  let uplink = 0;
  let downlink = 0;
  for (const r of results) {
    if (r.status === 'fulfilled') {
      uplink   += r.value.uplink   || 0;
      downlink += r.value.downlink || 0;
    }
  }
  return { uplink, downlink };
}

/**
 * CPU usage averaged over all cores from os.loadavg() (1-min).
 * Returns percentage 0–100.
 */
function getCpuUsage() {
  const cpuCount = os.cpus().length;
  const load1m   = os.loadavg()[0];
  return Math.min(100, Math.round((load1m / cpuCount) * 100));
}

module.exports = async function statsRoutes(fastify) {
  // GET /stats/me
  fastify.get('/me', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    const { sub: userId } = request.user;

    const { rows: devices } = await db.query(
      'SELECT uuid, user_id FROM devices WHERE user_id = $1',
      [userId]
    );

    const traffic = await aggregateTraffic(devices);

    // Per-device breakdown
    const perDevice = await Promise.allSettled(
      devices.map(async d => {
        const stats = await xray.getStats(`${d.user_id}_${d.uuid}`);
        return { uuid: d.uuid, ...stats };
      })
    );

    return reply.send({
      total: {
        uplink:   traffic.uplink,
        downlink: traffic.downlink,
        // Note: xray stats are cumulative since last xray restart.
        // Period breakdown (day/week/month) requires a stats snapshot table — planned for a future iteration.
        day:   traffic.downlink + traffic.uplink,
        week:  traffic.downlink + traffic.uplink,
        month: traffic.downlink + traffic.uplink,
      },
      devices: perDevice
        .filter(r => r.status === 'fulfilled')
        .map(r => r.value),
    });
  });

  // GET /stats/server  (superadmin only)
  fastify.get('/server', {
    onRequest: [fastify.authenticate, fastify.requireSuperadmin],
  }, async (_request, reply) => {
    const totalMem = os.totalmem();
    const freeMem  = os.freemem();
    const usedMem  = totalMem - freeMem;

    // All devices across all users
    const { rows: allDevices } = await db.query(
      'SELECT uuid, user_id FROM devices'
    );
    const totalTraffic = await aggregateTraffic(allDevices);

    // User / device counts
    const { rows: counts } = await db.query(
      `SELECT
         (SELECT COUNT(*) FROM users WHERE role = 'user')::int AS user_count,
         (SELECT COUNT(*) FROM devices)::int AS device_count`
    );

    // Active xray clients (currently in config)
    let activeClients = 0;
    try {
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
        total_mb: Math.round(totalMem / 1024 / 1024),
        used_mb:  Math.round(usedMem  / 1024 / 1024),
        free_mb:  Math.round(freeMem  / 1024 / 1024),
        usage_pct: Math.round((usedMem / totalMem) * 100),
      },
      uptime_s: os.uptime(),
      xray: {
        active_clients: activeClients,
      },
      users:   counts[0].user_count,
      devices: counts[0].device_count,
      traffic: {
        uplink:   totalTraffic.uplink,
        downlink: totalTraffic.downlink,
        total:    totalTraffic.uplink + totalTraffic.downlink,
      },
    });
  });
};
