"""Asyncpg connection pool and query helpers."""
import os
import asyncpg

_pool: asyncpg.Pool | None = None


async def init() -> None:
    global _pool
    _pool = await asyncpg.create_pool(
        host=os.getenv("DB_HOST", "db"),
        port=int(os.getenv("DB_PORT", "5432")),
        database=os.getenv("DB_NAME", "vpndb"),
        user=os.getenv("DB_USER", "vpnuser"),
        password=os.getenv("DB_PASSWORD"),
        min_size=1,
        max_size=5,
    )


async def close() -> None:
    if _pool:
        await _pool.close()


async def fetch(query: str, *args):
    async with _pool.acquire() as conn:
        return await conn.fetch(query, *args)


async def fetchrow(query: str, *args):
    async with _pool.acquire() as conn:
        return await conn.fetchrow(query, *args)


async def execute(query: str, *args):
    async with _pool.acquire() as conn:
        return await conn.execute(query, *args)


# ── Domain helpers ───────────────────────────────────────────────────────────

async def get_user_by_telegram_id(telegram_id: int):
    return await fetchrow(
        "SELECT id, login, role, expires_at FROM users WHERE telegram_id = $1",
        telegram_id,
    )


async def get_user_by_login(login: str):
    return await fetchrow(
        "SELECT id, login, role, expires_at, telegram_id FROM users WHERE login = $1",
        login,
    )


async def set_telegram_id(user_id: int, telegram_id: int) -> None:
    await execute(
        "UPDATE users SET telegram_id = $1 WHERE id = $2",
        telegram_id, user_id,
    )


async def get_devices(user_id: int):
    return await fetch(
        "SELECT id, name, uuid, last_seen_at, created_at FROM devices "
        "WHERE user_id = $1 ORDER BY created_at",
        user_id,
    )


async def get_device_by_name(user_id: int, name: str):
    return await fetchrow(
        "SELECT id, name, uuid FROM devices WHERE user_id = $1 AND LOWER(name) = LOWER($2)",
        user_id, name,
    )


async def get_all_users():
    return await fetch(
        """SELECT u.id, u.login, u.role, u.expires_at, u.telegram_id,
                  COUNT(d.id)::int AS device_count
           FROM users u
           LEFT JOIN devices d ON d.user_id = u.id
           GROUP BY u.id
           ORDER BY u.created_at""",
    )


async def get_device_by_id(device_id: int, user_id: int):
    return await fetchrow(
        "SELECT id, name, uuid FROM devices WHERE id = $1 AND user_id = $2",
        device_id, user_id,
    )


async def get_traffic_summary(user_id: int):
    return await fetch(
        """SELECT d.name, SUM(td.bytes_up) AS bytes_up, SUM(td.bytes_down) AS bytes_down
           FROM traffic_daily td
           JOIN devices d ON d.id = td.device_id
           WHERE d.user_id = $1
             AND td.date >= CURRENT_DATE - INTERVAL '30 days'
           GROUP BY d.id, d.name
           ORDER BY (SUM(td.bytes_up) + SUM(td.bytes_down)) DESC""",
        user_id,
    )


async def get_expiring_users(within_days: int):
    """Return users with telegram_id whose account expires within `within_days` days."""
    return await fetch(
        """SELECT id, login, telegram_id, expires_at FROM users
           WHERE telegram_id IS NOT NULL
             AND expires_at IS NOT NULL
             AND expires_at > NOW()
             AND expires_at <= NOW() + $1::interval""",
        f"{within_days} days",
    )
