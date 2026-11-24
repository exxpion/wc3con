# WC3 Connector

Проект для организации Warcraft III 1.26 LAN-игр через центральный relay.

## Состав

- `server/` — REST-аутентификация, комнаты, WebSocket relay и TCP-туннели.
- `connector/` — Electron-клиент, UDP LAN discovery и локальный TCP proxy.

## Согласованный игровой сценарий

1. Хост входит в лаунчер, выбирает `.w3x` или `.w3m` и создаёт комнату.
2. Игроки входят в комнату лаунчера.
3. Хост вручную запускает Warcraft III 1.26 и вручную создаёт LAN-игру с выбранной картой.
4. Коннектор обнаруживает настоящий W3GS `GAMEINFO` хоста и передаёт его гостям.
5. Гости видят игру в `Multiplayer → Local Area Network` и подключаются.
6. Закрытие LAN-игры хостом не закрывает комнату: гости перестают видеть устаревшую игру, а хост может создать её заново.

Проверка наличия карты у гостей на первом этапе не выполняется. При несовпадении карты целевое поведение — `warn`: предупреждать, но не блокировать подключение и не подменять карту комнаты. Извлечение фактической карты из W3GS `GAMEINFO` пока требует отдельной проверки.

## Требования

- Warcraft III 1.26 (TFT).
- Node.js 20 LTS рекомендуется для сборки и сервера.
- Windows 10/11 для Electron-клиента.

## Настройка адреса сервера

По умолчанию клиент использует адрес, указанный в `connector/src/main/index.ts`. Можно переопределить переменными окружения:

```powershell
$env:WC3_SERVER_HTTP_URL = "https://your-domain.example"
$env:WC3_SERVER_WS_URL = "wss://your-domain.example/ws"
```

Для публичного сервера рекомендуется HTTPS/WSS через reverse proxy. Не публикуйте JWT secret в клиентском приложении.

## Установка и сборка

Из корня проекта:

```bash
npm ci
npm run build:server
npm run build:connector
npm run check:protocol
```

Проверка W3GS packet helpers после сборки клиента:

```bash
cd connector
npm run test:protocol
```

Для упаковки Windows-приложения:

```bash
cd connector
npm run package
```

Сервер запускается из `server/` после настройки `.env`:

```env
PORT=3000
HOST=127.0.0.1
JWT_SECRET=replace-with-a-long-random-secret
```

```bash
npm run build
npm start
```

Не открывайте порт 6112 на VPS: игровой W3GS TCP endpoint находится на компьютере хоста и проходит через relay. На VPS нужен только HTTP(S)/WebSocket(S) порт reverse proxy.

## Состояние реализации

См. [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) и [DEPLOY_AND_TEST.md](DEPLOY_AND_TEST.md). В частности, настоящий фризтайм/возобновление симуляции Warcraft III и принудительная установка ника в клиенте WC3 ещё не подтверждены и не должны считаться реализованными только на основании WebSocket-событий.
