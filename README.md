# WC3 Connector

Платформа для игры в Warcraft 3 через интернет как по локальной сети (LAN).

## Компоненты

- **Server** — Node.js relay-сервер (WebSocket + REST API)
- **Connector** — Electron-приложение (эмулирует W3GS LAN-протокол)

## Быстрый старт

### 1. Деплой сервера на Ubuntu VPS

```bash
# SSH в VPS
ssh root@YOUR_VPS_IP

# Установка Node.js 20 + PM2
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt-get install -y nodejs git
sudo npm install -g pm2

# Клонирование репозитория
cd /opt
git clone https://github.com/exxpion/wc3con.git
cd wc3con/server

# Установка зависимостей
npm install --production

# Сборка
npm run build

# Создание .env файла
cat > .env << EOF
PORT=3000
HOST=0.0.0.0
JWT_SECRET=$(openssl rand -base64 32)
NODE_ENV=production
EOF

# Запуск с PM2
pm2 start dist/index.js --name wc3-server
pm2 save
pm2 startup

# Открытие портов
sudo ufw allow 22/tcp
sudo ufw allow 3000/tcp
sudo ufw enable

# Проверка
curl http://localhost:3000/health
```

### 2. Настройка коннектора

Перед сборкой замените IP сервера в `connector/src/main/index.ts`:

```typescript
const SERVER_URL = 'ws://YOUR_VPS_IP:3000/ws';
const API_URL = 'http://YOUR_VPS_IP:3000';
```

### 3. Сборка коннектора

```bash
cd connector/connector

# Установка зависимостей
npm install

# Компиляция
npm run build:main

# Сборка .exe (опционально)
npm run package
```

## Как это работает

1. **Сервер** управляет комнатами и релеит игровой трафик между игроками
2. **Коннектор** эмулирует WC3 LAN-протокол (UDP broadcast на порт 6112)
3. Игроки видят игры в Warcraft 3 → LAN как локальные, но играют через интернет

## Тестирование

1. Оба игрока запускают коннектор и логинятся
2. Хост создаёт игру → она появляется в списке у всех
3. Игрок кликает "Войти"
4. Оба открывают WC3 → Multiplayer → LAN → игра в списке
5. Хост создаёт, игрок присоединяется

## Управление сервером

```bash
pm2 logs wc3-server      # Логи
pm2 restart wc3-server   # Перезагрузка
pm2 stop wc3-server      # Остановка
pm2 status               # Статус
```

## Архитектура

```
Player A                          Server                        Player B
  WC3                                                              WC3
   |  TCP (LAN)                                      TCP (LAN)  |
Connector A ——— WebSocket ——→ [ Relay Server ] ←——— WebSocket ——— Connector B
```

## Технологии

- **Server**: Node.js, TypeScript, Fastify, ws, SQLite
- **Connector**: Electron, TypeScript, W3GS протокол

## Требования

- **Сервер**: Ubuntu 20.04+, 1 vCPU, 1GB RAM
- **Клиент**: Windows 10+, Warcraft 3 (1.26-1.29)

## Полная документация

См. [DEPLOY_AND_TEST.md](DEPLOY_AND_TEST.md) для детальных инструкций.

## Лицензия

MIT
