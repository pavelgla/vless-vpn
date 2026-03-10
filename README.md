# VLESS VPN Panel

Self-hosted VPN panel for personal/family use (1–10 users). Built on Xray-core with VLESS+Reality transport, managed via a web panel and Telegram bot.

## Features

- **VLESS + Reality** — traffic is indistinguishable from normal HTTPS (camouflages as Microsoft)
- **Web panel** — manage users and devices, view traffic charts, online status, connection history
- **Per-device QR codes** — scan to connect in seconds
- **Statistics** — daily traffic charts (Recharts), real-time online devices, connection log with client IPs
- **Audit log** — records logins, device creation/deletion, user management (admin only, paginated)
- **Telegram bot** — manage devices and users without opening the browser
- **Setup guide** — built-in page with step-by-step HAPP/Hiddify/v2rayN setup instructions

## Stack

| Component | Technology |
|-----------|------------|
| VPN core  | Xray-core 26.x (VLESS + Reality) |
| API       | Node.js + Fastify |
| Frontend  | React + Vite + Tailwind CSS |
| Bot       | Python + python-telegram-bot |
| Database  | PostgreSQL 15 |
| Proxy     | Nginx (TCP stream + HTTPS) |
| TLS       | Let's Encrypt (certbot) |

## Server requirements

- **OS**: Ubuntu 22.04 LTS (other Debian-based distros may work)
- **RAM**: 512 MB minimum (1 GB recommended)
- **CPU**: 1 vCPU
- **Ports**: 80 and 443 must be open and free
- **Domain**: an A record pointing to the server IP (e.g. `vpn.example.com → 1.2.3.4`)
- **Docker**: installed automatically by `install.sh` if missing

## Quick install

```bash
git clone https://github.com/pavelgla/vless-vpn.git
cd vless-vpn
sudo bash install.sh
```

The script will prompt for:

| Prompt | Notes |
|--------|-------|
| Domain | e.g. `vpn.example.com` |
| Superadmin login | default: `admin` |
| Superadmin password | min 8 chars |
| Telegram bot token | from @BotFather — leave blank to skip bot |
| DB password | auto-generated if left blank |
| JWT secret | auto-generated if left blank |

Then automatically:
1. Installs Docker and Certbot if missing
2. Generates a Reality key pair (X25519)
3. Obtains a Let's Encrypt TLS certificate
4. Builds and starts all 6 containers
5. Creates the superadmin account

After completion the panel is at `https://YOUR_DOMAIN`.

## Reinstall / change domain

Running `install.sh` again on an existing installation detects `.installed` and asks whether to reinstall. To fully wipe data and start over:

```bash
bash reset.sh
```

## Adding users

**Via web panel:**
1. Log in at `https://YOUR_DOMAIN` with superadmin credentials
2. Open **Users** → **Add user**
3. Set login, password, and optional expiry date

**Via Telegram bot (superadmin):**
```
/adduser login password 2025-12-31
```

## Adding a device (getting a VLESS link)

Users can add their own devices from the panel (limit: 5 per user). Admins can add devices for any user from the Users section.

1. Log in → **My devices** → **Add device**, enter a name (e.g. "iPhone")
2. A QR code and VLESS link appear immediately
3. Import the QR code or link into your VLESS client

**VLESS link format:**
```
vless://UUID@domain:443?type=tcp&security=reality&pbk=PUBLIC_KEY&sid=SHORT_ID&sni=www.microsoft.com&fp=chrome&flow=xtls-rprx-vision#DeviceName
```

> **Important:** `flow=xtls-rprx-vision` is required — make sure your client has it enabled.

## Recommended clients

| Platform | Client | Notes |
|----------|--------|-------|
| iOS      | [HAPP](https://apps.apple.com/app/happ-proxy-utility/id6504287215) | Recommended for mobile |
| Android  | [HAPP](https://play.google.com/store/apps/details?id=com.boos.happ) | Also available as APK from GitHub |
| Windows  | [Hiddify](https://github.com/hiddify/hiddify-app/releases/latest), [v2rayN](https://github.com/2dust/v2rayN/releases/latest) | |
| macOS    | [Hiddify](https://github.com/hiddify/hiddify-app/releases/latest), [FoXray](https://apps.apple.com/app/foxray/id6448898396) | |
| Linux    | [Hiddify](https://github.com/hiddify/hiddify-app/releases/latest), [v2rayA](https://github.com/v2rayA/v2rayA/releases/latest) | |

A built-in setup guide with screenshots is available at `https://YOUR_DOMAIN/guide` after login.

## Telegram bot commands

User commands:
```
/start          — link your Telegram account to the panel
/devices        — list your devices with VLESS links
/adddevice name — add a new device
/deldevice name — remove a device
/status         — show subscription expiry
/help           — show all commands
```

Superadmin commands:
```
/adduser login password [YYYY-MM-DD]
/deluser login
/listusers
```

## Statistics

The API polls Xray every 30 seconds via Docker socket exec:

- **Traffic** — daily bytes up/down per device, accumulated in `traffic_daily` table
- **Online status** — via `xray api statsgetallonlineusers`, updated every poll
- **Client IPs** — via `xray api statsonlineiplist` and access log parsing
- **Connection log** — stored in `connection_log` table, shown per device in the panel
- **Audit log** — all user actions (login, device CRUD, user management) in `audit_log` table, visible to superadmin only with pagination

## Updating

```bash
cd vless-vpn
git pull
docker compose build --pull
docker compose up -d
```

Database migrations run automatically on API startup — safe to run on existing installations.

## Backup

```bash
bash scripts/backup.sh
```

Saves a gzipped PostgreSQL dump to `./backups/`. Keeps the last 30 backups.

Set up daily automatic backups:
```bash
echo "0 3 * * * root bash $(pwd)/scripts/backup.sh >> /var/log/vpn-backup.log 2>&1" \
  | sudo tee /etc/cron.d/vpn-backup
```

## Useful commands

```bash
# Live logs
docker compose logs -f xray
docker compose logs -f api
docker compose logs -f bot

# Health check
docker compose ps

# Restart one service
docker compose restart api

# PostgreSQL shell
docker compose exec db psql -U vpnuser vpndb

# Re-create superadmin (if credentials lost)
docker compose exec api node scripts/create-admin.js
```

## Architecture

```
Internet
    |
    v :80 / :443
  nginx (TCP stream, ssl_preread)
    |
    +-- SNI = YOUR_DOMAIN --> nginx HTTPS (:8443)
    |                               |
    |                        /api/* --> api:3000 (Fastify + JWT)
    |                        /      --> frontend:80 (React SPA)
    |
    +-- any other SNI -------> xray:443 (VLESS + Reality)
                                    |
                            xray/config.json
                            (managed by API, hot-reloaded via SIGUSR1)
```

**Traffic flow for VPN clients:**
1. Client connects to `YOUR_DOMAIN:443` with SNI `www.microsoft.com`
2. Nginx routes the raw TCP stream to xray (non-domain SNI → xray)
3. Xray performs the Reality handshake — traffic looks like HTTPS to Microsoft
4. VLESS layer authenticates the client by UUID + xtls-rprx-vision flow
5. Traffic is forwarded to the internet from the server

> **Note:** Do not use `proxy_protocol` between nginx and xray — it is incompatible with REALITY and causes silent connection failures.

## Database schema

| Table | Description |
|-------|-------------|
| `users` | Accounts with login, role, expiry |
| `devices` | Per-device UUID, last IP, last seen |
| `traffic_daily` | Daily bytes up/down per device |
| `connection_log` | Per-device connection timestamps and IPs |
| `audit_log` | Admin-visible action log (login, device/user CRUD) |

## File structure

```
vless-vpn/
├── install.sh            # Automated installer
├── reset.sh              # Wipe data and stop containers
├── docker-compose.yml
├── .env.example          # Template — copied to .env by install.sh
├── api/
│   ├── src/
│   │   ├── index.js
│   │   ├── xray.js       # Config management + Docker exec stats API
│   │   ├── poller.js     # Background stats collector (30s interval)
│   │   ├── migrate.js    # Idempotent DB migrations on startup
│   │   ├── audit.js      # Audit log helper
│   │   ├── db.js
│   │   ├── auth.js
│   │   └── routes/       # auth, devices, users, stats
│   └── scripts/
│       └── create-admin.js
├── bot/                  # Telegram bot (Python)
├── frontend/             # React + Vite SPA
│   └── src/
│       ├── pages/        # Dashboard, Admin, Settings, Guide
│       └── components/   # DeviceCard, TrafficChart, QRModal, ...
├── nginx/
│   ├── nginx.conf.template
│   └── Dockerfile
├── xray/
│   ├── config.json       # Template with placeholders — patched by install.sh
│   └── Dockerfile
└── db/
    └── init.sql          # PostgreSQL schema
```

## Security notes

- Secrets live in `.env` only (never committed to git)
- JWT tokens are blacklisted on logout
- Login endpoint is rate-limited (10 req/min per IP)
- Superadmin cannot be deleted via API
- Reality protocol makes VPN traffic indistinguishable from normal HTTPS
- All admin actions are recorded in the audit log with timestamps and IPs
