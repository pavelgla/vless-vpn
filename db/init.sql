-- VPN Panel Database Schema

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TYPE user_role AS ENUM ('superadmin', 'user');

CREATE TABLE IF NOT EXISTS users (
    id            SERIAL PRIMARY KEY,
    login         VARCHAR(64) NOT NULL UNIQUE,
    password_hash TEXT        NOT NULL,
    role          user_role   NOT NULL DEFAULT 'user',
    expires_at    TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    telegram_id   BIGINT      UNIQUE
);

CREATE TABLE IF NOT EXISTS devices (
    id           SERIAL PRIMARY KEY,
    user_id      INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name         VARCHAR(32) NOT NULL,
    uuid         UUID        NOT NULL UNIQUE DEFAULT gen_random_uuid(),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ,
    last_ip      INET,
    CONSTRAINT devices_name_unique_per_user UNIQUE (user_id, name)
);

-- Daily traffic counters per device (accumulated by the API poller)
CREATE TABLE IF NOT EXISTS traffic_daily (
    id         SERIAL PRIMARY KEY,
    device_id  INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    date       DATE    NOT NULL,
    bytes_up   BIGINT  NOT NULL DEFAULT 0,
    bytes_down BIGINT  NOT NULL DEFAULT 0,
    UNIQUE (device_id, date)
);

-- Connection events: one row per accepted VLESS session
CREATE TABLE IF NOT EXISTS connection_log (
    id           SERIAL  PRIMARY KEY,
    device_id    INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    client_ip    INET
);

CREATE INDEX IF NOT EXISTS idx_devices_user_id           ON devices(user_id);
CREATE INDEX IF NOT EXISTS idx_devices_uuid              ON devices(uuid);
CREATE INDEX IF NOT EXISTS idx_users_telegram_id         ON users(telegram_id);
CREATE INDEX IF NOT EXISTS idx_users_login               ON users(login);
CREATE INDEX IF NOT EXISTS idx_traffic_daily_device_date ON traffic_daily(device_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_connection_log_device     ON connection_log(device_id, connected_at DESC);

COMMENT ON COLUMN users.role IS 'superadmin | user';
COMMENT ON COLUMN users.expires_at IS 'NULL means no expiry (superadmin always active)';
COMMENT ON COLUMN devices.last_seen_at IS 'Updated every 30s by poller when device has active traffic';
COMMENT ON COLUMN devices.last_ip IS 'Real client IP from last connection (via PROXY protocol)';
COMMENT ON TABLE  traffic_daily IS 'Accumulated from xray stats API every 30s, reset=true per poll';
COMMENT ON TABLE  connection_log IS 'One row per accepted VLESS connection from access log';
