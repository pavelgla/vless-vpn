'use strict';

const db = require('./db');

/**
 * Idempotent migrations — safe to run on every API startup.
 * Adds tables/columns that may be missing from older installs.
 */
async function runMigrations() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS traffic_daily (
      id         SERIAL PRIMARY KEY,
      device_id  INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
      date       DATE    NOT NULL,
      bytes_up   BIGINT  NOT NULL DEFAULT 0,
      bytes_down BIGINT  NOT NULL DEFAULT 0,
      UNIQUE (device_id, date)
    )
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_traffic_daily_device_date
      ON traffic_daily(device_id, date DESC)
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS connection_log (
      id           SERIAL  PRIMARY KEY,
      device_id    INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
      connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      client_ip    INET
    )
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_connection_log_device
      ON connection_log(device_id, connected_at DESC)
  `);

  // Add columns that may be missing in older schemas
  await db.query(`ALTER TABLE devices ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ`);
  await db.query(`ALTER TABLE devices ADD COLUMN IF NOT EXISTS last_ip INET`);

  console.log('[migrate] Done');
}

module.exports = { runMigrations };
