'use strict';

const db = require('./db');

/**
 * Write an audit log entry (fire-and-forget, never throws).
 * @param {number|null} userId  - who performed the action
 * @param {string}      action  - e.g. 'login_ok', 'device_create'
 * @param {object}      details - arbitrary JSON context
 * @param {string}      ip      - request IP
 */
function log(userId, action, details = {}, ip = null) {
  db.query(
    `INSERT INTO audit_log (user_id, action, details, ip)
     VALUES ($1, $2, $3, $4)`,
    [userId || null, action, JSON.stringify(details), ip || null]
  ).catch(err => console.error('[audit] write error:', err.message));
}

module.exports = { log };
