#!/usr/bin/env bash
# setup_server.sh — первичная настройка продакшн-сервера
# Запуск: bash setup_server.sh
set -euo pipefail

# ── Цвета ─────────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

info()    { echo -e "${CYAN}[•]${NC} $*"; }
success() { echo -e "${GREEN}[✓]${NC} $*"; }
warn()    { echo -e "${YELLOW}[!]${NC} $*"; }
error()   { echo -e "${RED}[✗]${NC} $*"; exit 1; }
ask()     { echo -e "${BOLD}$*${NC}"; }

# ── GitHub Actions deploy key (публичный ключ с текущего сервера) ──────────────
# Этот ключ позволяет GitHub Actions подключаться к серверу.
# Приватная часть хранится в GitHub Secret SSH_PRIVATE_KEY.
GITHUB_ACTIONS_PUBKEY="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAID15SJERmOp9DPjufvmyanK8l15wEQpuKXx/9WPmj5fk github-actions-deploy"

REPO_URL="git@github.com:pavelgla/vless-vpn.git"
DEPLOY_DIR="/opt/vless-vpn"

# ── Проверки ──────────────────────────────────────────────────────────────────
[[ $EUID -ne 0 ]] && error "Запустите скрипт от root: sudo bash setup_server.sh"

echo ""
echo -e "${BOLD}╔══════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║     VPN Panel — Setup Production         ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════╝${NC}"
echo ""

# ── Шаг 1: Сбор параметров ────────────────────────────────────────────────────
echo -e "${BOLD}── Настройка ──────────────────────────────${NC}"
echo ""

ask "Домен (например: vpn.example.com):"
read -r DOMAIN
[[ -z "$DOMAIN" ]] && error "Домен не может быть пустым"

ask "Логин суперадмина [admin]:"
read -r ADMIN_LOGIN
ADMIN_LOGIN="${ADMIN_LOGIN:-admin}"

ask "Пароль суперадмина (минимум 8 символов):"
read -rs ADMIN_PASSWORD; echo ""
[[ ${#ADMIN_PASSWORD} -lt 8 ]] && error "Пароль слишком короткий"

ask "Telegram Bot Token (оставьте пустым если бот не нужен):"
read -r BOT_TOKEN

DB_PASSWORD=$(openssl rand -base64 24 | tr -d '/+=')
JWT_SECRET=$(openssl rand -base64 48 | tr -d '/+=')

echo ""
echo -e "${BOLD}── Параметры ──────────────────────────────${NC}"
echo "  Домен:        $DOMAIN"
echo "  Суперадмин:   $ADMIN_LOGIN"
echo "  Бот:          ${BOT_TOKEN:-(не задан)}"
echo "  DB пароль:    (сгенерирован)"
echo "  JWT secret:   (сгенерирован)"
echo ""
ask "Продолжить? [Y/n]:"
read -r CONFIRM
[[ "${CONFIRM,,}" == "n" ]] && exit 0

# ── Шаг 2: Docker ─────────────────────────────────────────────────────────────
echo ""
info "Устанавливаю Docker..."
if command -v docker &>/dev/null; then
  success "Docker уже установлен: $(docker --version)"
else
  curl -fsSL https://get.docker.com | sh
  success "Docker установлен"
fi

# ── Шаг 3: Пользователь deploy ────────────────────────────────────────────────
info "Создаю пользователя deploy..."
if id deploy &>/dev/null; then
  warn "Пользователь deploy уже существует"
else
  useradd -m -s /bin/bash deploy
  success "Пользователь deploy создан"
fi
usermod -aG docker deploy

# ── Шаг 4: SSH-ключ GitHub Actions ───────────────────────────────────────────
info "Настраиваю SSH-ключ GitHub Actions..."
mkdir -p /home/deploy/.ssh
chmod 700 /home/deploy/.ssh

if grep -qF "$GITHUB_ACTIONS_PUBKEY" /home/deploy/.ssh/authorized_keys 2>/dev/null; then
  warn "Ключ GitHub Actions уже добавлен"
else
  echo "$GITHUB_ACTIONS_PUBKEY" >> /home/deploy/.ssh/authorized_keys
  success "Ключ GitHub Actions добавлен"
fi

chmod 600 /home/deploy/.ssh/authorized_keys
chown -R deploy:deploy /home/deploy/.ssh

# ── Шаг 5: Ключ для чтения репозитория ───────────────────────────────────────
info "Генерирую SSH-ключ для чтения репозитория GitHub..."
if [[ ! -f /home/deploy/.ssh/github_deploy ]]; then
  ssh-keygen -t ed25519 -f /home/deploy/.ssh/github_deploy -N "" -C "vless-vpn-deploy-readonly" -q
  chown deploy:deploy /home/deploy/.ssh/github_deploy /home/deploy/.ssh/github_deploy.pub
  success "Ключ сгенерирован"
else
  warn "Ключ уже существует, пропускаю генерацию"
fi

cat > /home/deploy/.ssh/config << 'EOF'
Host github.com
    HostName github.com
    User git
    IdentityFile ~/.ssh/github_deploy
    StrictHostKeyChecking no
EOF
chmod 600 /home/deploy/.ssh/config
chown deploy:deploy /home/deploy/.ssh/config

echo ""
echo -e "${YELLOW}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${YELLOW}║  ДЕЙСТВИЕ ТРЕБУЕТСЯ: добавьте ключ в GitHub репозиторий     ║${NC}"
echo -e "${YELLOW}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${BOLD}Публичный ключ для добавления:${NC}"
echo ""
cat /home/deploy/.ssh/github_deploy.pub
echo ""
echo "Добавьте его на GitHub:"
echo "  Репозиторий → Settings → Deploy keys → Add deploy key"
echo "  Title: production-server"
echo "  Allow write access: НЕТ"
echo ""
ask "Нажмите Enter когда добавите ключ в GitHub..."
read -r

# Проверяем соединение
info "Проверяю соединение с GitHub..."
if sudo -u deploy ssh -T git@github.com 2>&1 | grep -q "successfully authenticated"; then
  success "Соединение с GitHub установлено"
else
  warn "Не удалось проверить соединение — продолжаю (проверьте вручную позже)"
fi

# ── Шаг 6: Клонирование репозитория ──────────────────────────────────────────
info "Клонирую репозиторий в $DEPLOY_DIR..."
if [[ -d "$DEPLOY_DIR/.git" ]]; then
  warn "Репозиторий уже существует, выполняю git pull..."
  sudo -u deploy git -C "$DEPLOY_DIR" pull origin main
else
  sudo -u deploy git clone "$REPO_URL" "$DEPLOY_DIR"
  success "Репозиторий склонирован"
fi

# ── Шаг 7: Создание .env ──────────────────────────────────────────────────────
info "Создаю .env..."
cat > "$DEPLOY_DIR/.env" << EOF
DOMAIN=${DOMAIN}
SUPERADMIN_LOGIN=${ADMIN_LOGIN}
SUPERADMIN_PASSWORD=${ADMIN_PASSWORD}
TELEGRAM_BOT_TOKEN=${BOT_TOKEN}
DB_PASSWORD=${DB_PASSWORD}
JWT_SECRET=${JWT_SECRET}
REALITY_PUBLIC_KEY=
REALITY_SHORT_ID=
REALITY_PRIVATE_KEY=
EOF
chmod 600 "$DEPLOY_DIR/.env"
chown deploy:deploy "$DEPLOY_DIR/.env"
success ".env создан"

# ── Шаг 8: Запуск install.sh ──────────────────────────────────────────────────
echo ""
info "Запускаю install.sh..."
cd "$DEPLOY_DIR"
bash install.sh

# ── Готово ────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}╔══════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║           Установка завершена!           ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════╝${NC}"
echo ""
echo -e "  Панель:      ${BOLD}https://${DOMAIN}${NC}"
echo -e "  Логин:       ${BOLD}${ADMIN_LOGIN}${NC}"
echo ""
echo -e "${YELLOW}Последний шаг:${NC} обновите GitHub Secret SERVER_HOST"
echo "  Репозиторий → Settings → Secrets → Actions → SERVER_HOST"
echo "  Новое значение: $(curl -s ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')"
echo ""
