"""Internal REST API client with auto-refreshing superadmin JWT."""
import os
import logging
from datetime import datetime, timedelta

import httpx

log = logging.getLogger(__name__)

BASE_URL = os.getenv("API_BASE_URL", "http://api:3000")
_token: str | None = None
_token_expires: datetime = datetime.min


async def _get_token() -> str:
    global _token, _token_expires
    if _token and _token_expires > datetime.now():
        return _token
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(
            f"{BASE_URL}/auth/service-login",
            json={
                "login":          os.getenv("SUPERADMIN_LOGIN"),
                "password":       os.getenv("SUPERADMIN_PASSWORD"),
                "service_secret": os.getenv("JWT_SECRET"),
            },
        )
        resp.raise_for_status()
        _token = resp.json()["token"]
        _token_expires = datetime.now() + timedelta(hours=23)
        log.info("API: superadmin token refreshed")
    return _token


async def _headers() -> dict:
    return {"Authorization": f"Bearer {await _get_token()}"}


async def get(path: str, **kwargs) -> dict | list:
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(f"{BASE_URL}{path}", headers=await _headers(), **kwargs)
        resp.raise_for_status()
        return resp.json()


async def post(path: str, **kwargs) -> dict:
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(f"{BASE_URL}{path}", headers=await _headers(), **kwargs)
        resp.raise_for_status()
        return resp.json()


async def patch(path: str, **kwargs) -> dict:
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.patch(f"{BASE_URL}{path}", headers=await _headers(), **kwargs)
        resp.raise_for_status()
        return resp.json()


async def delete(path: str, **kwargs) -> None:
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.delete(f"{BASE_URL}{path}", headers=await _headers(), **kwargs)
        resp.raise_for_status()


# ── Domain wrappers ──────────────────────────────────────────────────────────

async def create_user(login: str, password: str, expires_at: str | None = None) -> dict:
    payload: dict = {"login": login, "password": password}
    if expires_at:
        payload["expires_at"] = expires_at
    return await post("/users", json=payload)


async def set_expire(user_id: int, expires_at: str | None) -> dict:
    return await patch(f"/users/{user_id}", json={"expires_at": expires_at})


async def disable_user(user_id: int) -> dict:
    return await patch(f"/users/{user_id}", json={"disabled": True})


async def enable_user(user_id: int) -> dict:
    return await patch(f"/users/{user_id}", json={"expires_at": None})


async def server_stats() -> dict:
    return await get("/stats/server")


async def add_device(user_id: int, name: str) -> dict:
    return await post(f"/users/{user_id}/devices", json={"name": name})


async def remove_device(user_id: int, device_id: int) -> None:
    await delete(f"/users/{user_id}/devices/{device_id}")
