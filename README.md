# VLESS VPN Panel

Self-hosted VPN panel for personal/family use (1-5 users). Built on Xray-core with VLESS+Reality transport, managed via a web panel and Telegram bot.

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

**Recommended clients:**

| Platform | Client |
|----------|--------|
| Android  | v2rayNG, Hiddify |
| iOS      | Streisand, FoXray |
| Windows  | Hiddify, v2rayN |
| macOS    | FoXray, Hiddify |

The `flow=xtls-rprx-vision` parameter is required — make sure your client has it enabled.

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

## Updating

```bash
cd vless-vpn
git pull
docker compose build --pull
docker compose up -d
```

Database migrations run automatically on API startup.

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
                                    |
                              PostgreSQL 15
```

Traffic flow for VPN clients:
1. Client connects to `YOUR_DOMAIN:443` with SNI `www.microsoft.com`
2. Nginx routes the raw TCP stream to xray (non-domain SNI → xray)
3. Xray performs the Reality handshake — traffic looks like HTTPS to Microsoft
4. VLESS layer authenticates the client by UUID + flow
5. Traffic is forwarded to the internet from the server

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
│   │   ├── xray.js       # Config management + SIGUSR1 hot-reload
│   │   ├── db.js
│   │   ├── auth.js
│   │   └── routes/       # auth, devices, users, stats
│   └── scripts/
│       └── create-admin.js
├── bot/                  # Telegram bot (Python)
├── frontend/             # React + Vite SPA
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
- JWT tokens are blacklisted on logout (stored in DB)
- Login endpoint is rate-limited (5 req/min per IP)
- Superadmin cannot be deleted via API
- Reality protocol makes VPN traffic indistinguishable from normal HTTPS
