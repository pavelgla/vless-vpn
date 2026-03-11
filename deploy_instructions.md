# Развёртывание продакшна на новом сервере

## Требования к серверу
- Ubuntu 22.04 LTS
- RAM: 1 GB минимум
- Порты 80 и 443 открыты
- Домен с A-записью, указывающей на IP сервера

---

## Шаг 1. Подключиться к серверу

```bash
ssh root@YOUR_SERVER_IP
```

---

## Шаг 2. Установить Docker

```bash
curl -fsSL https://get.docker.com | sh
```

---

## Шаг 3. Создать пользователя deploy

```bash
useradd -m -s /bin/bash deploy
usermod -aG docker deploy
mkdir -p /home/deploy/.ssh
chmod 700 /home/deploy/.ssh
```

---

## Шаг 4. Добавить SSH-ключ GitHub Actions

Этот ключ позволяет GitHub Actions заходить на сервер и деплоить.
Публичная часть ключа хранится в файле `/tmp/deploy_key.pub` на старом сервере.

```bash
echo "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAID15SJERmOp9DPjufvmyanK8l15wEQpuKXx/9WPmj5fk github-actions-deploy" \
  >> /home/deploy/.ssh/authorized_keys
chmod 600 /home/deploy/.ssh/authorized_keys
chown -R deploy:deploy /home/deploy/.ssh
```

---

## Шаг 5. Настроить SSH-ключ для чтения GitHub репозитория

```bash
# Генерируем ключ
ssh-keygen -t ed25519 -f /home/deploy/.ssh/github_deploy -N "" -C "deploy-readonly"
chown deploy:deploy /home/deploy/.ssh/github_deploy*

# Настраиваем SSH config
cat > /home/deploy/.ssh/config << 'EOF'
Host github.com
    HostName github.com
    User git
    IdentityFile ~/.ssh/github_deploy
    StrictHostKeyChecking no
EOF
chmod 600 /home/deploy/.ssh/config
chown deploy:deploy /home/deploy/.ssh/config

# Показать публичный ключ — его нужно добавить в GitHub
cat /home/deploy/.ssh/github_deploy.pub
```

Добавить публичный ключ в GitHub:
**Репозиторий → Settings → Deploy keys → Add deploy key**
- Title: `production-server`
- Key: (вставить вывод команды выше)
- Allow write access: НЕТ (только чтение)

---

## Шаг 6. Склонировать репозиторий

```bash
sudo -u deploy git clone git@github.com:YOUR_ACCOUNT/vless-vpn.git /opt/vless-vpn
```

---

## Шаг 7. Создать файл `.env`

```bash
cat > /opt/vless-vpn/.env << 'EOF'
DOMAIN=vpn.yourdomain.com
SUPERADMIN_LOGIN=admin
SUPERADMIN_PASSWORD=StrongPassword123
TELEGRAM_BOT_TOKEN=123456:ABC-токен-бота
DB_PASSWORD=случайный-пароль-от-бд
JWT_SECRET=другой-длинный-случайный-секрет
REALITY_PUBLIC_KEY=
REALITY_SHORT_ID=
REALITY_PRIVATE_KEY=
EOF

chown deploy:deploy /opt/vless-vpn/.env
chmod 600 /opt/vless-vpn/.env
```

> Поля REALITY_* оставить пустыми — install.sh заполнит их автоматически.

Сгенерировать случайные пароли можно командой:
```bash
openssl rand -base64 32
```

---

## Шаг 8. Запустить установщик

```bash
cd /opt/vless-vpn
bash install.sh
```

Скрипт автоматически:
- Сгенерирует Reality-ключи (X25519) и запишет в `.env`
- Получит TLS-сертификат через certbot (Let's Encrypt)
- Соберёт и запустит все 6 Docker-контейнеров
- Создаст суперадмина из `.env`

После завершения панель доступна по адресу `https://YOUR_DOMAIN`.

---

## Шаг 9. Обновить GitHub Secret SERVER_HOST

Зайти в GitHub: **Репозиторий → Settings → Secrets and variables → Actions**

Найти секрет `SERVER_HOST` и обновить значение на IP нового сервера.

---

## Шаг 10. Проверить автодеплой

Сделать тестовый пуш — GitHub Actions должен автоматически задеплоить на новый сервер:

```bash
git commit --allow-empty -m "test deploy to new server"
git push
```

Через 1–2 минуты проверить что контейнеры пересобрались:

```bash
docker compose -f /opt/vless-vpn/docker-compose.yml ps
```

---

## Схема работы CI/CD

```
git push → GitHub Actions
                ↓ SSH (ключ из GitHub Secret SSH_PRIVATE_KEY)
          deploy@SERVER
                ↓
          cd /opt/vless-vpn
          git pull origin main
          docker compose build api frontend bot
          docker compose up -d
          docker image prune -f
```

---

## Что никогда не хранится в git

| Файл | Где хранится |
|------|-------------|
| `.env` | Только на сервере, создаётся вручную |
| `xray/config.json` | Генерируется `install.sh`, обновляется API |
| `nginx/certs/` | Certbot на сервере |
| `backups/` | Локально на сервере |

---

## Полезные команды после деплоя

```bash
# Логи
docker compose -f /opt/vless-vpn/docker-compose.yml logs -f api

# Перезапустить сервис
docker compose -f /opt/vless-vpn/docker-compose.yml restart api

# Сбросить пароль суперадмина
docker compose -f /opt/vless-vpn/docker-compose.yml exec api node scripts/create-admin.js

# Бэкап базы данных
bash /opt/vless-vpn/scripts/backup.sh
```
