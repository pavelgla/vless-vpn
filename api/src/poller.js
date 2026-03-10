'use strict';

const db   = require('./db');
const xray = require('./xray');

const POLL_MS       = 30_000;  // poll every 30 seconds
const ONLINE_WINDOW = 3 * 60 * 1000;

// Track the last log-read timestamp (Unix seconds) to avoid re-parsing old lines
let lastLogReadAt = Math.floor(Date.now() / 1000) - 60;

// Access log pattern: "... from IP:PORT accepted ... email: EMAIL"
const LOG_LINE_RE = /from ([\d.a-fA-F:]+):\d+ accepted .+ email: (\S+)/;

// ── Log reader ────────────────────────────────────────────────────────────────

async function processLogs() {
  try {
    const since = lastLogReadAt;
    lastLogReadAt = Math.floor(Date.now() / 1000);

    const lines = await xray.readXrayLogs(since);

    for (const line of lines) {
      const m = line.match(LOG_LINE_RE);
      if (!m) continue;

      const [, clientIp, email] = m;

      // Email format: {user_id}_{uuid}
      const { rows } = await db.query(
        `SELECT d.id FROM devices d
         JOIN users u ON u.id = d.user_id
         WHERE d.user_id || '_' || d.uuid = $1
         LIMIT 1`,
        [email]
      );
      if (rows.length === 0) continue;

      const deviceId = rows[0].id;

      // Update last_ip on device
      await db.query(
        `UPDATE devices SET last_ip = $1 WHERE id = $2`,
        [clientIp, deviceId]
      );

      // Insert connection log entry (ignore duplicates within the same second)
      await db.query(
        `INSERT INTO connection_log (device_id, client_ip)
         VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [deviceId, clientIp]
      );
    }
  } catch (err) {
    console.error('[poller] Log processing error:', err.message);
  }
}

// ── Stats poller ──────────────────────────────────────────────────────────────

async function pollStats() {
  try {
    const [statsMap, onlineEmails] = await Promise.all([
      xray.getAllStats(true),       // traffic since last poll, reset counters
      xray.getOnlineUsers(),        // currently connected users
    ]);

    const { rows: devices } = await db.query(
      'SELECT id, user_id, uuid FROM devices'
    );

    const onlineSet = new Set(onlineEmails.map(e => String(e).toLowerCase()));
    const now   = new Date();
    const today = now.toISOString().slice(0, 10);

    for (const device of devices) {
      const email      = `${device.user_id}_${device.uuid}`;
      const stats      = statsMap[email];
      const isOnline   = onlineSet.has(email.toLowerCase());
      const hasTraffic = stats && (stats.uplink > 0 || stats.downlink > 0);

      // Update last_seen_at when traffic flows OR device is online
      if (hasTraffic || isOnline) {
        await db.query(
          `UPDATE devices SET last_seen_at = $1 WHERE id = $2`,
          [now, device.id]
        );

        // Try to get real client IP via xray online IP list
        if (isOnline) {
          const ipList = await xray.getOnlineIPs(email);
          const ip = ipList[0]?.ip || ipList[0];
          if (ip && typeof ip === 'string') {
            await db.query(`UPDATE devices SET last_ip = $1 WHERE id = $2`, [ip, device.id]);
          }
        }
      }

      // Accumulate daily traffic
      if (hasTraffic) {
        await db.query(
          `INSERT INTO traffic_daily (device_id, date, bytes_up, bytes_down)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (device_id, date) DO UPDATE
             SET bytes_up   = traffic_daily.bytes_up   + EXCLUDED.bytes_up,
                 bytes_down = traffic_daily.bytes_down + EXCLUDED.bytes_down`,
          [device.id, today, stats.uplink, stats.downlink]
        );
      }
    }
  } catch (err) {
    console.error('[poller] Stats polling error:', err.message);
  }
}

// ── Main loop ─────────────────────────────────────────────────────────────────

async function tick() {
  await Promise.allSettled([pollStats(), processLogs()]);
}

function startPoller() {
  // Delay first run 10 s to let xray finish starting up
  setTimeout(() => {
    tick();
    setInterval(tick, POLL_MS);
  }, 10_000);

  console.log(`[poller] Started — interval ${POLL_MS / 1000}s`);
}

module.exports = { startPoller, ONLINE_WINDOW };
