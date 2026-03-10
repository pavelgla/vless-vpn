#!/usr/bin/env bash
set -euo pipefail

# ── Colours ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }

# ── Root + OS check ───────────────────────────────────────────────────────────
[[ $EUID -ne 0 ]] && error "Run as root: sudo bash install.sh"

if ! grep -qi 'ubuntu 22' /etc/os-release 2>/dev/null; then
  warn "This script is tested on Ubuntu 22.04. Proceeding anyway..."
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ── Reinstall guard ───────────────────────────────────────────────────────────
if [[ -f .installed ]]; then
  OLD_DOMAIN=$(cat .installed)
  echo ""
  echo -e "${YELLOW}⚠️  Обнаружена предыдущая установка (домен: ${OLD_DOMAIN})${NC}"
  echo -e "${YELLOW}Будет выполнен ПОЛНЫЙ СБРОС: контейнеры, тома, сертификаты, .env — всё удалится.${NC}"
  echo ""
  read -rp "Продолжить? Введите YES для подтверждения: " CONFIRM
  if [[ "$CONFIRM" != "YES" ]]; then
    echo "Отменено."
    exit 0
  fi
  echo ""
  info "🧹 Сброс предыдущей установки..."
  docker compose down -v --remove-orphans 2>/dev/null || true
  docker volume prune -f 2>/dev/null || true
  certbot delete --cert-name "$OLD_DOMAIN" --non-interactive 2>/dev/null || true
  rm -f .env nginx/certs/*.pem nginx/certs/*.key
  # Restore xray/config.json placeholders so they can be re-patched
  if [[ -f xray/config.json ]]; then
    # Re-checkout config template from git if available, otherwise warn
    if git diff --quiet HEAD -- xray/config.json 2>/dev/null; then
      : # no changes, placeholders already there (fresh clone)
    else
      git checkout HEAD -- xray/config.json 2>/dev/null \
        || warn "Could not restore xray/config.json — Reality keys may already be substituted. Edit manually if needed."
    fi
  fi
  rm -f .installed
  echo ""
  info "✅ Сброс выполнен. Начинаем установку заново."
  echo ""
fi

# ── Install Docker ─────────────────────────────────────────────────────────────
install_docker() {
  if command -v docker &>/dev/null; then
    info "Docker already installed: $(docker --version)"
    return
  fi
  info "Installing Docker..."
  apt-get update -qq
  apt-get install -y -qq ca-certificates curl gnupg lsb-release
  mkdir -p /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
    | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
    https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin
  systemctl enable --now docker
  info "Docker installed: $(docker --version)"
}

install_certbot() {
  if command -v certbot &>/dev/null; then
    info "Certbot already installed: $(certbot --version 2>&1 | head -1)"
    return
  fi
  info "Installing Certbot..."
  apt-get update -qq
  apt-get install -y -qq certbot
}

install_docker
install_certbot

# ── .env setup ────────────────────────────────────────────────────────────────
if [[ ! -f .env ]]; then
  cp .env.example .env
  info "Created .env from .env.example"
fi

prompt_value() {
  local key="$1"
  local prompt="$2"
  local secret="${3:-false}"
  local auto_generate="${4:-false}"
  local current
  current=$(grep -E "^${key}=" .env | cut -d= -f2- | tr -d '"' || true)

  if [[ -n "$current" ]]; then
    info "${key} is already set, skipping"
    return
  fi

  if [[ "$secret" == "true" ]]; then
    read -rsp "${prompt}: " value; echo
  else
    read -rp "${prompt}: " value
  fi

  # Auto-generate if empty and allowed
  if [[ -z "$value" && "$auto_generate" == "true" ]]; then
    value=$(openssl rand -hex 20)
    info "${key} auto-generated"
  fi

  [[ -z "$value" ]] && error "${key} cannot be empty"
  # Escape special chars for sed
  local escaped
  escaped=$(printf '%s\n' "$value" | sed 's/[&/\]/\\&/g')
  sed -i "s|^${key}=.*|${key}=${escaped}|" .env
}

echo ""
info "=== Configuration ==="
prompt_value "DOMAIN"              "Enter your domain (e.g. vpn.example.com)"
prompt_value "TELEGRAM_BOT_TOKEN" "Enter Telegram Bot Token" "true"
prompt_value "DB_PASSWORD"        "Enter DB password (Enter to auto-generate)" "true" "true"
prompt_value "JWT_SECRET"         "Enter JWT secret (Enter to auto-generate)"    "true" "true"
prompt_value "SUPERADMIN_LOGIN"   "Enter superadmin login"
prompt_value "SUPERADMIN_PASSWORD" "Enter superadmin password" "true"

# Auto-generate secrets if still empty
source .env

if [[ -z "${DB_PASSWORD:-}" ]]; then
  DB_PASSWORD=$(openssl rand -hex 16)
  sed -i "s|^DB_PASSWORD=.*|DB_PASSWORD=${DB_PASSWORD}|" .env
  info "Generated DB_PASSWORD"
fi

if [[ -z "${JWT_SECRET:-}" ]]; then
  JWT_SECRET=$(openssl rand -hex 32)
  sed -i "s|^JWT_SECRET=.*|JWT_SECRET=${JWT_SECRET}|" .env
  info "Generated JWT_SECRET"
fi

# Re-source to get updated values
source .env

[[ -z "${DOMAIN:-}" ]]              && error "DOMAIN is required"
[[ -z "${TELEGRAM_BOT_TOKEN:-}" ]]  && error "TELEGRAM_BOT_TOKEN is required"
[[ -z "${SUPERADMIN_LOGIN:-}" ]]    && error "SUPERADMIN_LOGIN is required"
[[ -z "${SUPERADMIN_PASSWORD:-}" ]] && error "SUPERADMIN_PASSWORD is required"

# ── Reality keys ──────────────────────────────────────────────────────────────
if [[ -z "${REALITY_PRIVATE_KEY:-}" ]]; then
  info "Generating Reality key pair..."

  # Try several methods in order; each has a 30-second timeout.
  # NOTE: teddysun/xray entrypoint IS /usr/bin/xray, so arg is just "x25519".
  generate_x25519() {
    local keys=""

    # 1. Host xray binary (fastest, no docker needed)
    if command -v xray &>/dev/null; then
      keys=$(xray x25519 2>/dev/null || true)
      [[ "$keys" == *"Private key"* ]] && { echo "$keys"; return 0; }
    fi

    # 2. teddysun/xray (pull image first with timeout, then run)
    if timeout 60 docker pull teddysun/xray &>/dev/null; then
      keys=$(timeout 15 docker run --rm teddysun/xray x25519 2>/dev/null || true)
      [[ "$keys" == *"Private key"* ]] && { echo "$keys"; return 0; }
    fi

    # 3. xtls/xray-core on ghcr.io
    if timeout 60 docker pull ghcr.io/xtls/xray-core:latest &>/dev/null; then
      keys=$(timeout 15 docker run --rm ghcr.io/xtls/xray-core:latest x25519 2>/dev/null || true)
      [[ "$keys" == *"Private key"* ]] && { echo "$keys"; return 0; }
    fi

    # 4. Python fallback (generates a valid x25519 key pair without xray)
    if command -v python3 &>/dev/null; then
      info "Using Python fallback for key generation..."
      keys=$(python3 - <<'PYEOF'
import os, base64
from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey
priv = X25519PrivateKey.generate()
pub  = priv.public_key()
priv_b = priv.private_bytes_raw()
pub_b  = pub.public_bytes_raw()
# Xray expects standard base64 (no padding stripped)
import base64
print("Private key:", base64.b64encode(priv_b).decode())
print("Public key: ", base64.b64encode(pub_b).decode())
PYEOF
      2>/dev/null || true)
      [[ "$keys" == *"Private key"* ]] && { echo "$keys"; return 0; }

      # Install cryptography if missing and retry
      pip3 install --quiet cryptography 2>/dev/null || true
      keys=$(python3 - <<'PYEOF'
import base64
from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey
priv = X25519PrivateKey.generate()
pub  = priv.public_key()
print("Private key:", base64.b64encode(priv.private_bytes_raw()).decode())
print("Public key: ", base64.b64encode(pub.public_bytes_raw()).decode())
PYEOF
      2>/dev/null || true)
      [[ "$keys" == *"Private key"* ]] && { echo "$keys"; return 0; }
    fi

    return 1
  }

  REALITY_KEYS=$(generate_x25519) \
    || error "Failed to generate Reality keys. Install xray manually or run: apt install xray"

  REALITY_PRIVATE_KEY=$(echo "$REALITY_KEYS" | grep 'Private key:' | awk '{print $NF}')
  REALITY_PUBLIC_KEY=$(echo  "$REALITY_KEYS" | grep 'Public key:'  | awk '{print $NF}' | tr -d ' ')
  REALITY_SHORT_ID=$(openssl rand -hex 4)

  [[ -z "$REALITY_PRIVATE_KEY" ]] && error "Could not parse private key from: $REALITY_KEYS"
  [[ -z "$REALITY_PUBLIC_KEY"  ]] && error "Could not parse public key from: $REALITY_KEYS"

  sed -i "s|^REALITY_PRIVATE_KEY=.*|REALITY_PRIVATE_KEY=${REALITY_PRIVATE_KEY}|" .env
  sed -i "s|^REALITY_SHORT_ID=.*|REALITY_SHORT_ID=${REALITY_SHORT_ID}|"         .env

  # Add or update REALITY_PUBLIC_KEY
  if grep -q '^REALITY_PUBLIC_KEY=' .env; then
    sed -i "s|^REALITY_PUBLIC_KEY=.*|REALITY_PUBLIC_KEY=${REALITY_PUBLIC_KEY}|" .env
  else
    echo "REALITY_PUBLIC_KEY=${REALITY_PUBLIC_KEY}" >> .env
  fi

  info "Reality Public Key (share with clients): ${REALITY_PUBLIC_KEY}"
fi

source .env

# ── Patch xray/config.json with generated keys ─────────────────────────────
info "Patching xray/config.json with Reality keys..."
sed -i \
  -e "s|\${REALITY_PRIVATE_KEY}|${REALITY_PRIVATE_KEY}|g" \
  -e "s|\${REALITY_SHORT_ID}|${REALITY_SHORT_ID}|g" \
  xray/config.json

# ── TLS certificate ──────────────────────────────────────────────────────────
CERT_DIR="./nginx/certs"
mkdir -p "$CERT_DIR"

if [[ -f "${CERT_DIR}/fullchain.pem" && -f "${CERT_DIR}/privkey.pem" ]]; then
  info "Certificates already present in ${CERT_DIR}, skipping certbot"
else
  info "Obtaining Let's Encrypt certificate for ${DOMAIN}..."

  # ── Free port 80 for certbot standalone ────────────────────────────────────
  # We need port 80 free for ~30 seconds while certbot validates the domain.
  # Strategy: stop docker services first, then stop any system service holding
  # the port, save its name so we can restart it afterwards.
  STOPPED_SERVICE=""

  # 1. Stop our own docker stack (may already own :80 on re-run)
  docker compose down 2>/dev/null || true
  sleep 1

  STOPPED_CONTAINERS=()

  if ss -tlnp | grep -q ':80 '; then
    # 2. Check if a docker-proxy (another compose project) holds port 80/443
    DOCKER_CONTAINERS_80=$(docker ps --format '{{.Names}}' \
      --filter publish=80 --filter status=running 2>/dev/null || true)
    DOCKER_CONTAINERS_443=$(docker ps --format '{{.Names}}' \
      --filter publish=443 --filter status=running 2>/dev/null || true)
    ALL_BLOCKING=$(echo -e "${DOCKER_CONTAINERS_80}\n${DOCKER_CONTAINERS_443}" \
      | sort -u | grep -v '^$' || true)

    if [[ -n "$ALL_BLOCKING" ]]; then
      warn "The following Docker containers hold port 80 or 443:"
      echo "$ALL_BLOCKING" | while read -r c; do warn "  • $c"; done
      warn "They will be stopped temporarily and restarted after certificate issuance."
      while IFS= read -r container; do
        [[ -z "$container" ]] && continue
        info "Stopping container: $container"
        docker stop "$container" 2>/dev/null || true
        STOPPED_CONTAINERS+=("$container")
      done <<< "$ALL_BLOCKING"
      sleep 1
    fi

    # 3. Try to stop a known system service gracefully
    for svc in nginx apache2 httpd lighttpd caddy; do
      if systemctl is-active --quiet "$svc" 2>/dev/null; then
        info "Stopping system service: $svc"
        systemctl stop "$svc"
        STOPPED_SERVICE="$svc"
        break
      fi
    done

    # 4. If still occupied, kill by pid as last resort
    if ss -tlnp | grep -q ':80 '; then
      PORT80_PID=$(ss -tlnp sport = :80 2>/dev/null \
        | grep -oP 'pid=\K[0-9]+' | head -1 || true)
      if [[ -n "$PORT80_PID" ]]; then
        warn "Sending SIGTERM to pid $PORT80_PID"
        kill "$PORT80_PID" 2>/dev/null || true
        sleep 2
      fi
    fi

    if ss -tlnp | grep -q ':80 '; then
      error "Port 80 is still in use. Please free it manually and re-run install.sh"
    fi
  fi

  # ── Run certbot ─────────────────────────────────────────────────────────────
  certbot certonly \
    --standalone \
    --non-interactive \
    --agree-tos \
    --register-unsafely-without-email \
    -d "$DOMAIN"

  # ── Restore stopped containers and services ────────────────────────────────
  for container in "${STOPPED_CONTAINERS[@]:-}"; do
    [[ -z "$container" ]] && continue
    info "Restarting container: $container"
    docker start "$container" 2>/dev/null || warn "Could not restart $container — start it manually"
  done

  if [[ -n "$STOPPED_SERVICE" ]]; then
    info "Restarting $STOPPED_SERVICE..."
    systemctl start "$STOPPED_SERVICE" || warn "Could not restart $STOPPED_SERVICE — start it manually"
  fi

  LE_PATH="/etc/letsencrypt/live/${DOMAIN}"
  cp "${LE_PATH}/fullchain.pem" "${CERT_DIR}/fullchain.pem"
  cp "${LE_PATH}/privkey.pem"   "${CERT_DIR}/privkey.pem"
  chmod 644 "${CERT_DIR}/fullchain.pem"
  chmod 600 "${CERT_DIR}/privkey.pem"

  info "Certificates copied to ${CERT_DIR}"

  # ── Setup auto-renewal hook ─────────────────────────────────────────────────
  RENEW_HOOK="/etc/letsencrypt/renewal-hooks/deploy/vpn-copy-certs.sh"
  cat > "$RENEW_HOOK" <<HOOK
#!/bin/bash
set -e
CERT_DIR="${SCRIPT_DIR}/nginx/certs"
LE_PATH="/etc/letsencrypt/live/${DOMAIN}"
cp "\${LE_PATH}/fullchain.pem" "\${CERT_DIR}/fullchain.pem"
cp "\${LE_PATH}/privkey.pem"   "\${CERT_DIR}/privkey.pem"
chmod 644 "\${CERT_DIR}/fullchain.pem"
chmod 600 "\${CERT_DIR}/privkey.pem"
cd "${SCRIPT_DIR}" && docker compose restart nginx
HOOK
  chmod +x "$RENEW_HOOK"
  info "Certbot auto-renewal hook installed at ${RENEW_HOOK}"
fi

# ── Start services ────────────────────────────────────────────────────────────
info "Starting Docker Compose services..."
docker compose up -d --build

info "Waiting for services to become healthy..."
TIMEOUT=120
ELAPSED=0
until docker compose ps | grep -E '(unhealthy|starting)' | grep -vq 'NAME' 2>/dev/null \
    || [[ $ELAPSED -ge $TIMEOUT ]]; do
  sleep 5
  ELAPSED=$((ELAPSED + 5))
  echo -n "."
done
echo ""

# Check final health
if docker compose ps | grep -q 'unhealthy'; then
  warn "Some services are unhealthy:"
  docker compose ps
else
  info "All services are up"
fi

# ── Create superadmin ─────────────────────────────────────────────────────────
info "Creating superadmin account..."
docker compose exec -T api node scripts/create-admin.js \
  || warn "create-admin.js failed — run manually: docker compose exec api node scripts/create-admin.js"

# ── Mark installation ─────────────────────────────────────────────────────────
echo "$DOMAIN" > .installed

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║            Installation complete!                   ║${NC}"
echo -e "${GREEN}╠══════════════════════════════════════════════════════╣${NC}"
echo -e "${GREEN}║${NC}  Panel URL : https://${DOMAIN}                     "
echo -e "${GREEN}║${NC}  Login     : ${SUPERADMIN_LOGIN}                    "
if [[ -n "${REALITY_PUBLIC_KEY:-}" ]]; then
echo -e "${GREEN}║${NC}  VLESS Public Key: ${REALITY_PUBLIC_KEY}            "
echo -e "${GREEN}║${NC}  VLESS Short ID  : ${REALITY_SHORT_ID}              "
fi
echo -e "${GREEN}╚══════════════════════════════════════════════════════╝${NC}"
echo ""
