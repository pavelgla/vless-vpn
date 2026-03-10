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

CREATE INDEX IF NOT EXISTS idx_devices_user_id  ON devices(user_id);
CREATE INDEX IF NOT EXISTS idx_devices_uuid     ON devices(uuid);
CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON users(telegram_id);
CREATE INDEX IF NOT EXISTS idx_users_login      ON users(login);

COMMENT ON COLUMN users.role IS 'superadmin | user';
COMMENT ON COLUMN users.expires_at IS 'NULL means no expiry (superadmin always active)';
COMMENT ON COLUMN devices.name IS 'Arbitrary device name, up to 32 chars, unique per user';
