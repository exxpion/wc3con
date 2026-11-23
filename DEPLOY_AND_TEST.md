# WC3 Connector - Deployment & Testing Guide

## ЧАСТЬ 1: ДЕПЛОЙ СЕРВЕРА НА UBUNTU VPS

### Шаг 1: Подключитесь к VPS по SSH

```bash
ssh root@YOUR_VPS_IP
# или если у вас есть ключ SSH
ssh -i /path/to/key root@YOUR_VPS_IP
```

### Шаг 2: Скачайте и запустите скрипт деплоя

```bash
# Скачайте из репо или создайте файл deploy.sh с содержимым ниже

curl -O https://raw.githubusercontent.com/YOUR_REPO/deploy.sh
chmod +x deploy.sh
./deploy.sh
```

**ИЛИ если нет репо, сделайте вручную:**

```bash
# 1. Обновите систему
sudo apt-get update && sudo apt-get upgrade -y

# 2. Установите Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs git

# 3. Установите PM2 (менеджер процессов)
sudo npm install -g pm2

# 4. Загрузите проект
cd /opt
sudo git clone https://github.com/YOUR_USERNAME/wc3-connector.git
sudo chown -R $USER:$USER wc3-connector
cd wc3-connector/server

# 5. Установите зависимости
npm install --production
npm run build

# 6. Создайте .env файл
cat > .env << EOF
PORT=3000
HOST=0.0.0.0
JWT_SECRET=$(openssl rand -base64 32)
NODE_ENV=production
EOF

# 7. Запустите сервер
pm2 start dist/index.js --name "wc3-server"
pm2 save

# 8. Откройте портЫ в фаерволе
sudo ufw allow 22/tcp
sudo ufw allow 3000/tcp
sudo ufw enable

# 9. Получите IP сервера
curl ifconfig.me
```

**Результат:** Сервер работает на `http://YOUR_VPS_IP:3000`, WebSocket на `ws://YOUR_VPS_IP:3000/ws`

---

## ЧАСТЬ 2: СБОРКА КОННЕКТОРА ДЛЯ WINDOWS

```bash
# На вашем ПК локально (не на VPS!)

cd connector/connector

# 1. Отредактируйте файл с IP сервера
# Откройте: connector/src/main/index.ts
# Найдите строку 9:
#   const SERVER_URL = process.env.SERVER_URL || 'ws://localhost:3000/ws';
# Измените на (используйте IP вашего VPS):
#   const SERVER_URL = 'ws://YOUR_VPS_IP:3000/ws';

# 2. Перекомпилируйте
npm run build:main

# 3. Соберите .exe файл
npm run package

# Файл будет: dist/WC3 Connector-1.0.0.exe
```

---

## ЧАСТЬ 3: ТЕСТИРОВАНИЕ С ДРУГОМ

### Шаг 1: Оба устанавливают коннектор

Вы и ваш друг скачиваете и запускаете `WC3 Connector-1.0.0.exe` с вашего сервера

### Шаг 2: Создайте аккаунты

**Вы (Хост):**
1. Откройте коннектор
2. Нажмите "Register"
3. Введите: username = `host`, password = `password123`
4. Нажмите Register → Login

**Друг:**
1. Откройте коннектор у себя
2. Нажмите "Register"
3. Введите: username = `friend`, password = `password123`
4. Нажмите Register → Login

### Шаг 3: Создайте игру (хост)

После логина:
1. Поле "Room Name": введите название (например `MyGame`)
2. Поле "Map Name": введите карту (например `(2)EchoIsles.w3x`)
3. Нажмите "Create Room"

**Результат:** 
- В коннекторе хоста: `Room created: <room_id>`
- В коннекторе друга: игра появляется в списке

### Шаг 4: Друг присоединяется

У друга в коннекторе:
1. Нажимает кнопку игры "MyGame"
2. Статус: `Connected to room`

### Шаг 5: Запустите Warcraft 3 LAN

**У обоих одновременно:**

1. Откройте Warcraft 3
2. Нажмите: Multiplayer → Local Area Network (LAN)
3. Нажмите "Refresh"
4. **Вы должны увидеть игру "MyGame" в списке**
5. Хост нажимает "Create Game" (на своей игре из списка)
6. Друг нажимает "Join Game"

**Готово! Играете локально через интернет!**

---

## ЧАСТЬ 4: ДИАГНОСТИКА

### Если коннектор не запускается:

```bash
# 1. Проверьте, что порт 6112 свободен (не запущен WC3 или другой коннектор)
netstat -ano | findstr :6112

# 2. Если занят, закройте приложение или измените порт в коде
```

### Если игра не видна в LAN:

```bash
# 1. Проверьте соединение с сервером (должно написать "Connected")
# 2. Проверьте IP сервера - откройте в браузере:
http://YOUR_VPS_IP:3000/health

# Должно вернуть:
# {"status":"ok","timestamp":1234567890}

# 3. Если ошибка - сервер не запущен
# На VPS выполните:
pm2 logs wc3-server
```

### Если друг не видит вашу игру:

```bash
# 1. Проверьте, что оба в одной комнате (должно написать "Room ID")
# 2. Перезагрузите список игр (нажмите "Refresh" в WC3)
# 3. Если всё ещё не видит - перезагрузите коннектор
```

---

## КОМАНДЫ PM2 НА VPS

```bash
# Просмотр логов в реальном времени
pm2 logs wc3-server

# Перезагрузка сервера
pm2 restart wc3-server

# Остановка
pm2 stop wc3-server

# Удаление
pm2 delete wc3-server
pm2 save

# Просмотр статуса всех процессов
pm2 status

# Мониторинг
pm2 monit
```

---

## ЗАМЕТКИ

- **Портирование:** На VPS откройте всегда порт 3000 и 6112 для UDP (W3GS)
- **Масштабирование:** 1 ядро/1GB хватит для ~20 одновременных игр
- **SSL/TLS:** Позже можно добавить с помощью Nginx + Let's Encrypt
- **Баз данные:** SQLite сохраняется в `wc3connector.db` (можно бэкапить регулярно)

---

## БЫСТРЫЙ СТАРТ (РЕЗЮМЕ)

```
VPS:
1. ssh root@IP
2. apt-get update && apt-get install -y nodejs pm2 git
3. git clone repo && cd repo/server
4. npm install --production && npm run build
5. echo 'PORT=3000\nJWT_SECRET=random' > .env
6. pm2 start dist/index.js

Локально:
1. Поменять IP сервера в connector/src/main/index.ts:9
2. npm run build:main && npm run package
3. Отправить .exe другу
4. Оба регистрируются → создать игру → присоединиться → Warcraft 3 LAN
```
