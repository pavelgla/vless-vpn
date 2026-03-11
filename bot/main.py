"""VLESS VPN Telegram bot."""
import asyncio
import io
import logging
import os
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path

import qrcode
from telegram import Update, BotCommand, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.constants import ParseMode
from telegram.ext import (
    Application,
    CallbackQueryHandler,
    CommandHandler,
    ConversationHandler,
    MessageHandler,
    ContextTypes,
    filters,
)

import api
import db

logging.basicConfig(
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    level=logging.INFO,
)
log = logging.getLogger(__name__)

# Conversation states
AWAIT_LOGIN, AWAIT_PASSWORD, AWAIT_DEVICE_NAME, AWAIT_DEVICE_DEL = range(4)

# In-memory notification tracking: set of (user_id, "7d" | "1d")
_notified: set[tuple[int, str]] = set()


# ── Helpers ──────────────────────────────────────────────────────────────────

def build_vless_link(uuid: str, name: str) -> str:
    domain    = os.getenv("DOMAIN", "")
    pub_key   = os.getenv("REALITY_PUBLIC_KEY", "")
    short_id  = os.getenv("REALITY_SHORT_ID", "")
    encoded   = urllib.parse.quote(name)
    return (
        f"vless://{uuid}@{domain}:443"
        f"?type=tcp&security=reality"
        f"&pbk={pub_key}&sid={short_id}"
        f"&sni=www.microsoft.com"
        f"&fp=chrome&flow=xtls-rprx-vision"
        f"#{encoded}"
    )


def make_qr_image(link: str) -> io.BytesIO:
    img = qrcode.make(link)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    return buf


def device_status(last_seen_at) -> str:
    if not last_seen_at:
        return "⚫"
    delta = datetime.now(timezone.utc) - last_seen_at.replace(tzinfo=timezone.utc)
    return "🟢" if delta.total_seconds() < 300 else "⚫"


def fmt_expires(expires_at) -> str:
    if not expires_at:
        return "бессрочно"
    dt = expires_at if hasattr(expires_at, "tzinfo") else expires_at
    return dt.strftime("%d.%m.%Y")


def fmt_bytes(b: int | None) -> str:
    if not b:
        return "0 B"
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if b < 1024:
            return f"{b:.1f} {unit}"
        b /= 1024
    return f"{b:.1f} PB"


async def get_linked_user(telegram_id: int):
    return await db.get_user_by_telegram_id(telegram_id)


async def is_admin(telegram_id: int) -> bool:
    user = await db.get_user_by_telegram_id(telegram_id)
    return bool(user and user["role"] == "superadmin")


def require_linked(handler):
    """Decorator: reject command if user not linked."""
    async def wrapper(update: Update, context: ContextTypes.DEFAULT_TYPE):
        user = await get_linked_user(update.effective_user.id)
        if not user:
            await update.message.reply_text(
                "Аккаунт не привязан. Используйте /start"
            )
            return
        context.user_data["_user"] = user
        return await handler(update, context, user)
    wrapper.__name__ = handler.__name__
    return wrapper


# ── /start — account linking ─────────────────────────────────────────────────

async def cmd_start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    tg_id = update.effective_user.id

    # Check if pre-linked by admin (telegram_id set in web panel)
    user = await db.get_user_by_telegram_id(tg_id)
    if user:
        await update.message.reply_text(
            f"✅ Аккаунт *{user['login']}* подключён!\n\n"
            "Используйте /devices для управления устройствами.",
            parse_mode=ParseMode.MARKDOWN,
        )
        return ConversationHandler.END

    await update.message.reply_text(
        "👋 Добро пожаловать в VPN Panel!\n\n"
        "Введите ваш *логин* для привязки аккаунта:",
        parse_mode=ParseMode.MARKDOWN,
    )
    return AWAIT_LOGIN


async def got_login(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    context.user_data["link_login"] = update.message.text.strip()
    await update.message.reply_text("Введите *пароль*:", parse_mode=ParseMode.MARKDOWN)
    return AWAIT_PASSWORD


async def got_password(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    login    = context.user_data.pop("link_login", "")
    password = update.message.text.strip()
    tg_id    = update.effective_user.id

    try:
        import httpx as _httpx
        async with _httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                f"{os.getenv('API_BASE_URL', 'http://api:3000')}/auth/login",
                json={"login": login, "password": password},
            )
        if resp.status_code == 401:
            await update.message.reply_text("❌ Неверный логин или пароль. Попробуйте /start снова.")
            return ConversationHandler.END
        if resp.status_code == 403:
            await update.message.reply_text("❌ Аккаунт истёк или заблокирован.")
            return ConversationHandler.END
        resp.raise_for_status()
    except Exception as e:
        log.error("Login check failed: %s", e)
        await update.message.reply_text("⚠️ Ошибка сервера. Попробуйте позже.")
        return ConversationHandler.END

    user = await db.get_user_by_login(login)
    if not user:
        await update.message.reply_text("❌ Пользователь не найден.")
        return ConversationHandler.END

    if user["telegram_id"] and user["telegram_id"] != tg_id:
        await update.message.reply_text("⚠️ Этот аккаунт уже привязан к другому Telegram.")
        return ConversationHandler.END

    await db.set_telegram_id(user["id"], tg_id)
    await update.message.reply_text(
        f"✅ Аккаунт *{login}* успешно привязан!\n\n"
        "Используйте /devices для управления устройствами.",
        parse_mode=ParseMode.MARKDOWN,
    )
    return ConversationHandler.END


async def cancel(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    context.user_data.pop("awaiting_device_name", None)
    await update.message.reply_text("Отменено.")
    return ConversationHandler.END


# ── /devices — list with inline buttons ──────────────────────────────────────

async def cmd_devices(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user = await get_linked_user(update.effective_user.id)
    if not user:
        await update.message.reply_text("Аккаунт не привязан. Используйте /start")
        return

    devices = await db.get_devices(user["id"])
    if not devices:
        await update.message.reply_text(
            "У вас нет устройств.\n\nДобавьте первое командой /adddevice"
        )
        return

    text_lines = [f"📱 *Устройства ({len(devices)}/5):*\n"]
    keyboard   = []
    for d in devices:
        status = device_status(d["last_seen_at"])
        last   = d["last_seen_at"].strftime("%d.%m %H:%M") if d["last_seen_at"] else "никогда"
        text_lines.append(f"{status} *{d['name']}*  ┗ {last}")
        keyboard.append([
            InlineKeyboardButton(f"📷 QR — {d['name']}", callback_data=f"qr:{d['id']}"),
            InlineKeyboardButton("🗑", callback_data=f"del:{d['id']}:{d['name']}"),
        ])

    keyboard.append([InlineKeyboardButton("➕ Добавить устройство", callback_data="add")])

    await update.message.reply_text(
        "\n".join(text_lines),
        parse_mode=ParseMode.MARKDOWN,
        reply_markup=InlineKeyboardMarkup(keyboard),
    )


# ── Inline callbacks ──────────────────────────────────────────────────────────

async def on_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int | None:
    query = update.callback_query
    await query.answer()

    user = await get_linked_user(query.from_user.id)
    if not user:
        await query.message.reply_text("Аккаунт не привязан. Используйте /start")
        return

    data = query.data

    # ── QR button ──
    if data.startswith("qr:"):
        device_id = int(data.split(":")[1])
        device    = await db.get_device_by_id(device_id, user["id"])
        if not device:
            await query.message.reply_text("❌ Устройство не найдено.")
            return
        link    = build_vless_link(device["uuid"], device["name"])
        qr_buf  = make_qr_image(link)
        await query.message.reply_photo(
            qr_buf,
            caption=f"📱 *{device['name']}*\n\n`{link}`",
            parse_mode=ParseMode.MARKDOWN,
        )
        return

    # ── Delete button — ask confirmation ──
    if data.startswith("del:"):
        _, device_id, device_name = data.split(":", 2)
        keyboard = InlineKeyboardMarkup([[
            InlineKeyboardButton("✅ Да, удалить", callback_data=f"delok:{device_id}:{device_name}"),
            InlineKeyboardButton("❌ Отмена",      callback_data="cancel"),
        ]])
        await query.message.reply_text(
            f"Удалить устройство *{device_name}*?",
            parse_mode=ParseMode.MARKDOWN,
            reply_markup=keyboard,
        )
        return

    # ── Delete confirmed ──
    if data.startswith("delok:"):
        _, device_id, device_name = data.split(":", 2)
        device = await db.get_device_by_id(int(device_id), user["id"])
        if not device:
            await query.message.reply_text("❌ Устройство не найдено.")
            return
        try:
            await api.remove_device(user["id"], int(device_id))
            await query.message.reply_text(f"✅ Устройство *{device_name}* удалено.", parse_mode=ParseMode.MARKDOWN)
        except Exception as e:
            await query.message.reply_text(f"❌ Ошибка удаления: {e}")
        return

    # ── Add button ──
    if data == "add":
        devices = await db.get_devices(user["id"])
        if len(devices) >= 5:
            await query.message.reply_text("❌ Достигнут лимит устройств (5).")
            return
        context.user_data["awaiting_device_name"] = True
        await query.message.reply_text(
            "Введите *название* нового устройства\n"
            "(например: `iPhone Макс` или `Ноутбук`):\n\n"
            "Или /cancel для отмены.",
            parse_mode=ParseMode.MARKDOWN,
        )
        return

    # ── Cancel ──
    if data == "cancel":
        context.user_data.pop("awaiting_device_name", None)
        await query.message.reply_text("Отменено.")
        return


async def cmd_adddevice(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    user = await get_linked_user(update.effective_user.id)
    if not user:
        await update.message.reply_text("Аккаунт не привязан. Используйте /start")
        return ConversationHandler.END

    devices = await db.get_devices(user["id"])
    if len(devices) >= 5:
        await update.message.reply_text("❌ Достигнут лимит устройств (5).")
        return ConversationHandler.END

    if context.args:
        # Name passed directly: /adddevice iPhone Max
        name = " ".join(context.args)
        return await _create_device(update, user, name)

    await update.message.reply_text(
        "Введите *название* устройства\n(например: `iPhone Макс`):\n\nИли /cancel для отмены.",
        parse_mode=ParseMode.MARKDOWN,
    )
    return AWAIT_DEVICE_NAME


async def got_device_name(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    user = await get_linked_user(update.effective_user.id)
    if not user:
        return ConversationHandler.END
    name = update.message.text.strip()
    return await _create_device(update, user, name)


async def _create_device(update: Update, user, name: str) -> int:
    import re
    if not re.match(r'^[^<>\\/|?*\x00-\x1f]+$', name):
        await update.message.reply_text(
            "❌ Название содержит недопустимые символы."
        )
        return ConversationHandler.END
    if len(name) > 32:
        await update.message.reply_text("❌ Название не должно превышать 32 символа.")
        return ConversationHandler.END

    msg = await update.message.reply_text("⏳ Создаю устройство...")
    try:
        device = await api.add_device(user["id"], name)
        link   = build_vless_link(device["uuid"], device["name"])
        qr_buf = make_qr_image(link)
        try:
            await msg.delete()
        except Exception:
            pass  # не критично если не удалось удалить
        await update.message.reply_photo(
            qr_buf,
            caption=(
                f"✅ Устройство *{device['name']}* добавлено!\n\n"
                f"`{link}`\n\n"
                f"Отсканируйте QR-код или скопируйте ссылку в HAPP / Hiddify."
            ),
            parse_mode=ParseMode.MARKDOWN,
        )
    except Exception as e:
        err = str(e)
        log.error("_create_device error: %s", err)
        if "already exists" in err:
            text = f"❌ Устройство с именем *{name}* уже существует."
        else:
            text = f"❌ Ошибка: {err}"
        try:
            await msg.edit_text(text, parse_mode=ParseMode.MARKDOWN)
        except Exception:
            await update.message.reply_text(text, parse_mode=ParseMode.MARKDOWN)
    return ConversationHandler.END


# ── /deldevice ────────────────────────────────────────────────────────────────

async def cmd_deldevice(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user = await get_linked_user(update.effective_user.id)
    if not user:
        await update.message.reply_text("Аккаунт не привязан. Используйте /start")
        return

    if not context.args:
        await update.message.reply_text(
            "Использование: `/deldevice <имя>`\n\nСписок устройств: /devices",
            parse_mode=ParseMode.MARKDOWN,
        )
        return

    name   = " ".join(context.args)
    device = await db.get_device_by_name(user["id"], name)
    if not device:
        await update.message.reply_text(
            f"❌ Устройство «{name}» не найдено.\n\nСписок: /devices"
        )
        return

    keyboard = InlineKeyboardMarkup([[
        InlineKeyboardButton("✅ Да, удалить", callback_data=f"delok:{device['id']}:{device['name']}"),
        InlineKeyboardButton("❌ Отмена",      callback_data="cancel"),
    ]])
    await update.message.reply_text(
        f"Удалить устройство *{device['name']}*?",
        parse_mode=ParseMode.MARKDOWN,
        reply_markup=keyboard,
    )


# ── /qr ──────────────────────────────────────────────────────────────────────

async def cmd_qr(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user = await get_linked_user(update.effective_user.id)
    if not user:
        await update.message.reply_text("Аккаунт не привязан. Используйте /start")
        return

    if not context.args:
        await update.message.reply_text(
            "Использование: `/qr <имя устройства>`\n\nСписок: /devices",
            parse_mode=ParseMode.MARKDOWN,
        )
        return

    name   = " ".join(context.args)
    device = await db.get_device_by_name(user["id"], name)
    if not device:
        await update.message.reply_text(f"Устройство «{name}» не найдено. Проверьте /devices")
        return

    link   = build_vless_link(device["uuid"], device["name"])
    qr_buf = make_qr_image(link)

    await update.message.reply_photo(
        qr_buf,
        caption=f"📱 *{device['name']}*\n\n`{link}`",
        parse_mode=ParseMode.MARKDOWN,
    )


# ── /traffic ─────────────────────────────────────────────────────────────────

async def cmd_traffic(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user = await get_linked_user(update.effective_user.id)
    if not user:
        await update.message.reply_text("Аккаунт не привязан. Используйте /start")
        return

    devices = await db.get_devices(user["id"])
    if not devices:
        await update.message.reply_text("Устройств нет.")
        return

    rows = await db.get_traffic_summary(user["id"])
    traffic_by_id = {r["device_id"]: r for r in rows}

    lines = ["📊 *Трафик за 30 дней:*\n"]
    for d in devices:
        t = traffic_by_id.get(d["id"])
        if t:
            lines.append(
                f"• *{d['name']}*\n"
                f"  ↑ {fmt_bytes(t['bytes_up'])}  ↓ {fmt_bytes(t['bytes_down'])}"
            )
        else:
            lines.append(f"• *{d['name']}* — нет данных")

    await update.message.reply_text("\n".join(lines), parse_mode=ParseMode.MARKDOWN)


# ── /expire ───────────────────────────────────────────────────────────────────

async def cmd_expire(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user = await get_linked_user(update.effective_user.id)
    if not user:
        await update.message.reply_text("Аккаунт не привязан. Используйте /start")
        return

    exp = fmt_expires(user["expires_at"])
    if not user["expires_at"]:
        msg = f"✅ Аккаунт *{user['login']}* действует бессрочно."
    else:
        expires_dt = user["expires_at"]
        days_left  = (expires_dt.replace(tzinfo=None) - datetime.utcnow()).days
        if days_left <= 0:
            msg = f"❌ Аккаунт *{user['login']}* истёк ({exp})."
        elif days_left <= 7:
            msg = f"⚠️ Аккаунт *{user['login']}* истекает через *{days_left} дн.* ({exp})!"
        else:
            msg = f"✅ Аккаунт *{user['login']}* действует до *{exp}* ({days_left} дн.)."

    await update.message.reply_text(msg, parse_mode=ParseMode.MARKDOWN)


# ── /help ─────────────────────────────────────────────────────────────────────

async def cmd_help(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    admin = await is_admin(update.effective_user.id)
    text = (
        "📋 *Команды:*\n\n"
        "/devices — список устройств\n"
        "/adddevice `[имя]` — добавить устройство\n"
        "/deldevice `<имя>` — удалить устройство\n"
        "/qr `<имя>` — QR-код устройства\n"
        "/traffic — трафик за 30 дней\n"
        "/expire — срок действия аккаунта\n"
        "/help — этот список\n"
    )
    if admin:
        text += (
            "\n👑 *Команды суперадмина:*\n\n"
            "/users — список пользователей\n"
            "/adduser `<логин>` `<пароль>` `[ГГГГ-ММ-ДД]` — создать пользователя\n"
            "/setexpire `<логин>` `<ГГГГ-ММ-ДД>` — установить срок\n"
            "/disable `<логин>` — заблокировать\n"
            "/enable `<логин>` — разблокировать\n"
            "/stats — нагрузка сервера\n"
        )
    await update.message.reply_text(text, parse_mode=ParseMode.MARKDOWN)


# ── Admin commands ────────────────────────────────────────────────────────────

def admin_only(handler):
    async def wrapper(update: Update, context: ContextTypes.DEFAULT_TYPE):
        if not await is_admin(update.effective_user.id):
            await update.message.reply_text("❌ Нет доступа.")
            return
        return await handler(update, context)
    wrapper.__name__ = handler.__name__
    return wrapper


@admin_only
async def cmd_users(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    users = await db.get_all_users()
    if not users:
        await update.message.reply_text("Пользователей нет.")
        return

    lines = ["👥 *Пользователи:*\n"]
    for u in users:
        is_expired = u["expires_at"] and u["expires_at"].replace(tzinfo=None) < datetime.utcnow()
        status     = "🔴" if is_expired else "🟢"
        tg         = "📱" if u["telegram_id"] else "  "
        role_mark  = "👑 " if u["role"] == "superadmin" else ""
        exp        = fmt_expires(u["expires_at"])
        lines.append(
            f"{status}{tg} {role_mark}*{u['login']}* "
            f"[{u['device_count']}/5] до {exp}"
        )

    await update.message.reply_text("\n".join(lines), parse_mode=ParseMode.MARKDOWN)


@admin_only
async def cmd_adduser(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    args = context.args
    if len(args) < 2:
        await update.message.reply_text(
            "Использование: `/adduser <логин> <пароль> [ГГГГ-ММ-ДД]`",
            parse_mode=ParseMode.MARKDOWN,
        )
        return
    login, password = args[0], args[1]
    expires_at = f"{args[2]}T00:00:00Z" if len(args) >= 3 else None
    try:
        user = await api.create_user(login, password, expires_at)
        await update.message.reply_text(
            f"✅ Пользователь *{user['login']}* создан (id={user['id']}).",
            parse_mode=ParseMode.MARKDOWN,
        )
    except Exception as e:
        await update.message.reply_text(f"❌ Ошибка: {e}")


@admin_only
async def cmd_setexpire(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if len(context.args) < 2:
        await update.message.reply_text(
            "Использование: `/setexpire <логин> <ГГГГ-ММ-ДД>`",
            parse_mode=ParseMode.MARKDOWN,
        )
        return
    login, date_str = context.args[0], context.args[1]
    user = await db.get_user_by_login(login)
    if not user:
        await update.message.reply_text(f"❌ Пользователь «{login}» не найден.")
        return
    try:
        await api.set_expire(user["id"], f"{date_str}T00:00:00Z")
        await update.message.reply_text(
            f"✅ Срок действия *{login}* установлен до *{date_str}*.",
            parse_mode=ParseMode.MARKDOWN,
        )
    except Exception as e:
        await update.message.reply_text(f"❌ Ошибка: {e}")


@admin_only
async def cmd_disable(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not context.args:
        await update.message.reply_text("Использование: `/disable <логин>`", parse_mode=ParseMode.MARKDOWN)
        return
    login = context.args[0]
    user  = await db.get_user_by_login(login)
    if not user:
        await update.message.reply_text(f"❌ Пользователь «{login}» не найден.")
        return
    try:
        await api.disable_user(user["id"])
        if user["telegram_id"]:
            try:
                await context.bot.send_message(
                    chat_id=user["telegram_id"],
                    text="❌ Ваш аккаунт заблокирован. Обратитесь к администратору.",
                )
            except Exception:
                pass
        await update.message.reply_text(f"✅ Пользователь *{login}* заблокирован.", parse_mode=ParseMode.MARKDOWN)
    except Exception as e:
        await update.message.reply_text(f"❌ Ошибка: {e}")


@admin_only
async def cmd_enable(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not context.args:
        await update.message.reply_text("Использование: `/enable <логин>`", parse_mode=ParseMode.MARKDOWN)
        return
    login = context.args[0]
    user  = await db.get_user_by_login(login)
    if not user:
        await update.message.reply_text(f"❌ Пользователь «{login}» не найден.")
        return
    try:
        await api.enable_user(user["id"])
        await update.message.reply_text(f"✅ Пользователь *{login}* разблокирован.", parse_mode=ParseMode.MARKDOWN)
    except Exception as e:
        await update.message.reply_text(f"❌ Ошибка: {e}")


@admin_only
async def cmd_stats(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    try:
        s       = await api.server_stats()
        cpu     = s.get("cpu", {})
        mem     = s.get("memory", {})
        traffic = s.get("traffic", {})
        text = (
            "📊 *Статистика сервера:*\n\n"
            f"🖥 CPU: *{cpu.get('usage_pct', '?')}%* "
            f"(load: {', '.join(str(round(x, 2)) for x in cpu.get('loadavg', []))})\n"
            f"💾 RAM: *{mem.get('used_mb', '?')} / {mem.get('total_mb', '?')} MB* "
            f"({mem.get('usage_pct', '?')}%)\n"
            f"👥 Пользователей: *{s.get('users', '?')}*\n"
            f"📱 Устройств: *{s.get('devices', '?')}*\n"
            f"📡 Онлайн: *{s.get('online_devices', '?')}*\n"
            f"📤 Трафик ↑: *{traffic.get('bytes_up', '—')}*\n"
            f"📥 Трафик ↓: *{traffic.get('bytes_down', '—')}*\n"
        )
        await update.message.reply_text(text, parse_mode=ParseMode.MARKDOWN)
    except Exception as e:
        log.error("cmd_stats error: %s", e)
        await update.message.reply_text(f"❌ Ошибка: {e}")


# ── Notification jobs ────────────────────────────────────────────────────────

async def job_notify_expiry(context: ContextTypes.DEFAULT_TYPE) -> None:
    now = datetime.utcnow()
    for days, label, emoji in [(7, "7d", "⚠️"), (1, "1d", "🚨")]:
        users = await db.get_expiring_users(days)
        for u in users:
            key = (u["id"], label)
            if key in _notified:
                continue
            expires   = u["expires_at"].replace(tzinfo=None)
            days_left = (expires - now).days
            if label == "7d" and not (3 <= days_left <= 7):
                continue
            if label == "1d" and days_left > 1:
                continue
            try:
                if emoji == "⚠️":
                    msg = (
                        f"⚠️ *Предупреждение*\n\n"
                        f"Ваш доступ к VPN истекает через *{days_left} дн.* "
                        f"({expires.strftime('%d.%m.%Y')}).\n"
                        f"Обратитесь к администратору для продления."
                    )
                else:
                    msg = (
                        f"🚨 *Срочно!*\n\n"
                        f"Ваш доступ к VPN истекает *завтра* "
                        f"({expires.strftime('%d.%m.%Y')}).\n"
                        f"Срочно обратитесь к администратору!"
                    )
                await context.bot.send_message(
                    chat_id=u["telegram_id"],
                    text=msg,
                    parse_mode=ParseMode.MARKDOWN,
                )
                _notified.add(key)
                log.info("Sent %s expiry notification to user %s", label, u["login"])
            except Exception as e:
                log.warning("Failed to notify user %s: %s", u["login"], e)


# ── Bot setup ────────────────────────────────────────────────────────────────

async def post_init(application: Application) -> None:
    await db.init()
    log.info("Database pool initialized")

    await application.bot.set_my_commands([
        BotCommand("devices",   "Мои устройства"),
        BotCommand("adddevice", "Добавить устройство"),
        BotCommand("deldevice", "Удалить устройство"),
        BotCommand("qr",        "QR-код устройства"),
        BotCommand("traffic",   "Статистика трафика"),
        BotCommand("expire",    "Срок действия аккаунта"),
        BotCommand("help",      "Список команд"),
    ])

    Path("/tmp/bot.ready").touch()
    log.info("Bot ready")


async def post_shutdown(application: Application) -> None:
    await db.close()
    Path("/tmp/bot.ready").unlink(missing_ok=True)


def main() -> None:
    token = os.getenv("TELEGRAM_BOT_TOKEN")
    if not token:
        raise RuntimeError("TELEGRAM_BOT_TOKEN is not set")

    app = (
        Application.builder()
        .token(token)
        .post_init(post_init)
        .post_shutdown(post_shutdown)
        .build()
    )

    # /start conversation (login + password linking)
    start_conv = ConversationHandler(
        entry_points=[CommandHandler("start", cmd_start)],
        states={
            AWAIT_LOGIN:    [MessageHandler(filters.TEXT & ~filters.COMMAND, got_login)],
            AWAIT_PASSWORD: [MessageHandler(filters.TEXT & ~filters.COMMAND, got_password)],
        },
        fallbacks=[CommandHandler("cancel", cancel)],
    )

    # /adddevice conversation (command only — inline ➕ uses user_data instead)
    adddevice_conv = ConversationHandler(
        entry_points=[CommandHandler("adddevice", cmd_adddevice)],
        states={
            AWAIT_DEVICE_NAME: [MessageHandler(filters.TEXT & ~filters.COMMAND, got_device_name)],
        },
        fallbacks=[CommandHandler("cancel", cancel)],
    )

    app.add_handler(start_conv)
    app.add_handler(adddevice_conv)

    # Inline button callbacks
    app.add_handler(CallbackQueryHandler(on_callback))

    # Global text handler — catches device name typed after pressing ➕ inline button
    async def handle_awaiting_text(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        if not context.user_data.get("awaiting_device_name"):
            return
        context.user_data.pop("awaiting_device_name")
        user = await get_linked_user(update.effective_user.id)
        if not user:
            await update.message.reply_text("Аккаунт не привязан. Используйте /start")
            return
        await _create_device(update, user, update.message.text.strip())

    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_awaiting_text))

    # User commands
    app.add_handler(CommandHandler("help",      cmd_help))
    app.add_handler(CommandHandler("devices",   cmd_devices))
    app.add_handler(CommandHandler("qr",        cmd_qr))
    app.add_handler(CommandHandler("deldevice", cmd_deldevice))
    app.add_handler(CommandHandler("traffic",   cmd_traffic))
    app.add_handler(CommandHandler("expire",    cmd_expire))

    # Admin commands
    app.add_handler(CommandHandler("users",     cmd_users))
    app.add_handler(CommandHandler("adduser",   cmd_adduser))
    app.add_handler(CommandHandler("setexpire", cmd_setexpire))
    app.add_handler(CommandHandler("disable",   cmd_disable))
    app.add_handler(CommandHandler("enable",    cmd_enable))
    app.add_handler(CommandHandler("stats",     cmd_stats))

    # Expiry notification job: every 6 hours
    app.job_queue.run_repeating(
        job_notify_expiry,
        interval=6 * 3600,
        first=60,
    )

    log.info("Starting bot (polling)")
    app.run_polling(drop_pending_updates=True)


if __name__ == "__main__":
    main()
