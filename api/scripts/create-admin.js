#!/usr/bin/env node
'use strict';

/**
 * CLI script: create or update the superadmin account.
 * Reads SUPERADMIN_LOGIN and SUPERADMIN_PASSWORD from environment.
 * Safe to run multiple times (upsert semantics).
 */

const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

async function main() {
  const login    = process.env.SUPERADMIN_LOGIN;
  const password = process.env.SUPERADMIN_PASSWORD;

  if (!login || !password) {
    console.error('[create-admin] SUPERADMIN_LOGIN and SUPERADMIN_PASSWORD must be set');
    process.exit(1);
  }

  if (password.length < 8) {
    console.error('[create-admin] SUPERADMIN_PASSWORD must be at least 8 characters');
    process.exit(1);
  }

  const pool = new Pool({
    host:     process.env.DB_HOST     || 'db',
    port:     parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME     || 'vpndb',
    user:     process.env.DB_USER     || 'vpnuser',
    password: process.env.DB_PASSWORD,
    connectionTimeoutMillis: 10000,
  });

  try {
    console.log(`[create-admin] Connecting to database...`);
    const client = await pool.connect();

    try {
      const hash = await bcrypt.hash(password, 12);

      const result = await client.query(
        `INSERT INTO users (login, password_hash, role)
         VALUES ($1, $2, 'superadmin')
         ON CONFLICT (login)
         DO UPDATE SET password_hash = EXCLUDED.password_hash,
                       role          = 'superadmin'
         RETURNING id, login, role, created_at`,
        [login, hash]
      );

      const user = result.rows[0];
      const action = result.rowCount === 1 ? 'created/updated' : 'updated';
      console.log(`[create-admin] Superadmin ${action}: id=${user.id} login=${user.login} role=${user.role}`);
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[create-admin] Error:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
