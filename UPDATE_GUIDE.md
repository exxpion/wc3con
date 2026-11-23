# Руководство по обновлению WC3 Connector

## 1. Обновление кода после изменений

### Коммит изменений в Git

```bash
# Просмотр изменений
git status
git diff

# Добавить файлы (выборочно)
git add connector/src/main/index.ts
git add connector/src/main/wc3/udp-broadcaster.ts
# Или все файлы сразу (если уверен)
git add .

# Создать коммит
git commit -m "Add detailed UDP/WS logging for debugging"

# Отправить на GitHub
git push origin main
```

## 2. Обновление сервера на VPS

### Вариант A: Быстрое обновление (pull + restart)

```bash
# Подключиться к VPS
ssh root@130.78.13.15

# Перейти в папку проекта
cd /opt/wc3con

# Забрать изменения с GitHub
git pull origin main

# Пересобрать серверную часть
cd server
npm install
npm run build

# Перезапустить сервер через PM2
pm2 restart wc3-server

# Проверить логи
pm2 logs wc3-server --lines 50
```

### Вариант B: Полное обновление (если меняли зависимости)

```bash
ssh root@130.78.13.15
cd /opt/wc3con

git pull origin main

cd server
npm install  # установит новые зависимости
npm run build

pm2 restart wc3-server
pm2 logs wc3-server --lines 50
```

### Проверка работы сервера

```bash
# Статус PM2
pm2 status

# Логи в реальном времени
pm2 logs wc3-server

# Проверка портов
netstat -tlnp | grep 3000
```

## 3. Обновление клиента (Electron лаунчер)

### Локальная сборка

```bash
# В папке E:\connector\connector
cd E:\connector\connector

# Установить зависимости (если обновлялись)
npm install

# Собрать TypeScript + Vite
npm run build

# Создать Electron билд
npx electron-builder --dir
```

**Готовый билд:** `E:\connector\connector\out\win-unpacked\WC3 Connector.exe`

### Отправка друзьям

1. Заархивируй папку `win-unpacked` в zip
2. Загрузи в облако (Google Drive / Яндекс.Диск)
3. Дай друзьям ссылку

## 4. Быстрые команды (шпаргалка)

### После изменения кода клиента

```bash
cd E:\connector\connector
npm run build
npx electron-builder --dir
```

### После изменения кода сервера

```bash
# Локально
git add .
git commit -m "Описание изменений"
git push origin main

# На VPS
ssh root@130.78.13.15
cd /opt/wc3con && git pull && cd server && npm run build && pm2 restart wc3-server
```

### Одной командой (если изменился и клиент, и сервер)

```bash
# Локально
cd E:\connector
git add .
git commit -m "Update client and server"
git push origin main
cd connector
npm run build
npx electron-builder --dir

# На VPS
ssh root@130.78.13.15 "cd /opt/wc3con && git pull && cd server && npm run build && pm2 restart wc3-server && pm2 logs wc3-server --lines 20"
```

## 5. Откат изменений (если что-то сломалось)

### На VPS

```bash
ssh root@130.78.13.15
cd /opt/wc3con

# Просмотр коммитов
git log --oneline -10

# Откат на предыдущий коммит (замени HASH на нужный)
git reset --hard HASH

cd server
npm run build
pm2 restart wc3-server
```

### Локально

```bash
cd E:\connector
git log --oneline -10
git reset --hard HASH
```

## 6. Диагностика проблем

### Сервер не запускается

```bash
ssh root@130.78.13.15
pm2 logs wc3-server --err --lines 100
```

### Порт занят

```bash
ssh root@130.78.13.15
netstat -tlnp | grep 3000
# Если занят другим процессом
kill -9 PID
pm2 restart wc3-server
```

### База данных сломалась

```bash
ssh root@130.78.13.15
cd /opt/wc3con/server
# Бекап
cp wc3connector.db wc3connector.db.backup
# Пересоздание
rm wc3connector.db
pm2 restart wc3-server
```

## 7. Полезные PM2 команды

```bash
pm2 status                    # статус всех процессов
pm2 restart wc3-server       # перезапуск
pm2 stop wc3-server          # остановка
pm2 start wc3-server         # запуск
pm2 delete wc3-server        # удалить из PM2
pm2 logs wc3-server          # логи в реальном времени
pm2 logs wc3-server --lines 100  # последние 100 строк
pm2 monit                    # мониторинг ресурсов
```

## 8. Настройка автообновления (TODO)

**Текущий статус:** нужно вручную раздавать новые билды друзьям

**Планируется:** добавить автообновление через GitHub releases в будущих версиях
