#!/usr/bin/env bash
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [[ ! -f .installed ]]; then
  echo "Установка не найдена."
  exit 0
fi

DOMAIN=$(cat .installed)

echo ""
echo -e "${RED}⚠️  Это удалит ВСЁ: контейнеры, базу данных, сертификаты для ${DOMAIN}${NC}"
echo ""
read -rp "Введите YES для подтверждения: " CONFIRM
[[ "$CONFIRM" == "YES" ]] || { echo "Отменено."; exit 0; }

echo ""
echo -e "${YELLOW}🧹 Останавливаем контейнеры и удаляем тома...${NC}"
docker compose down -v --remove-orphans

echo -e "${YELLOW}🧹 Удаляем осиротевшие тома Docker...${NC}"
docker volume prune -f

echo -e "${YELLOW}🧹 Удаляем сертификат Let's Encrypt для ${DOMAIN}...${NC}"
certbot delete --cert-name "$DOMAIN" --non-interactive 2>/dev/null \
  && echo "  Сертификат удалён" \
  || echo "  Сертификат не найден (пропускаем)"

echo -e "${YELLOW}🧹 Удаляем .env и сертификаты nginx...${NC}"
rm -f .env nginx/certs/*.pem nginx/certs/*.key

echo -e "${YELLOW}🧹 Удаляем маркер установки...${NC}"
rm -f .installed

echo ""
echo -e "${GREEN}✅ Сброс выполнен. Можно запускать ./install.sh заново.${NC}"
echo ""
