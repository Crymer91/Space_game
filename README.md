# Asteroid Blaster — игровой сервер + веб-клиент

Автономный деплой игры «Asteroid Blaster»: Socket.IO-сервер (авторитетная
симуляция, матчмейкинг на 2 игрока, комнаты по коду) и статический
веб-клиент (Canvas 2D) в одном Node.js-приложении. Готов к запуску в Docker
на бесплатных хостингах.

## Структура

```
GameServer/
├─ src/
│  ├─ server.js        # HTTP + Socket.IO + статика (/public, /shared), /healthz
│  ├─ events.js        # сокет-события: auth, матчмейкинг, комнаты, game:*
│  ├─ rooms.js         # комнаты по коду, таймауты
│  ├─ matchmaking.js   # очередь случайных пар
│  ├─ db.js            # SQLite: игроки, матчи, рекорды
│  └─ game/            # серверная симуляция матча (тик ~30 Гц)
├─ shared/             # общий код симуляции (сервер + браузер): balance.js, world.js
├─ public/             # клиент: index.html + js/* (net/input/render/local/multi/main)
├─ test/e2e.mjs        # e2e-тест: два клиента играют матч
├─ Dockerfile          # multi-stage, node:22-slim, HEALTHCHECK /healthz
└─ docker-compose.yml  # том для SQLite, restart: unless-stopped
```

## Локальный запуск (без Docker)

```bash
npm install
npm start             # http://localhost:3000
npm test              # e2e-проверка (поднимает свой экземпляр на :3199)
```

## Запуск в Docker локально

```bash
docker compose up --build -d     # http://localhost:3000
docker compose logs -f game
```

Порт, БД и т.д. настраиваются переменными окружения — см. `.env.example`
(`PORT`, `DB_PATH`, `MATCH_DURATION_MS`, таймауты матчмейкинга...).

## Деплой на бесплатный хостинг

Сервер читает `PORT` из окружения и биндится на `0.0.0.0`, отдаёт `/healthz` —
требования типичных бесплатных платформ выполнены.

### Render.com (проще всего)
1. Залейте папку `GameServer` в Git-репозиторий.
2. New → **Web Service** → подключите репозиторий.
3. Runtime: **Docker** (Dockerfile подхватится автоматически).
4. Instance type: Free. Deploy.
5. WebSockets на Render поддерживаются из коробки; `PORT` платформа задаёт сама.

### Railway
1. New Project → Deploy from repo (с папкой `GameServer` как root directory).
2. Dockerfile определяется автоматически; `PORT` выдаётся платформой.
3. Для персистентности рекордов подключите Volume → смонтируйте в `/app/data`.

### Koyeb / Fly.io
Оба умеют сборку из Dockerfile (`fly launch` / создание сервиса из Git).
Пропишите health check на `GET /healthz`, порт — из переменной `PORT`.

### Важные ограничения free-тарифов
- **Один инстанс.** Очередь матчмейкинга и комнаты живут в памяти процесса:
  масштабирование на несколько реплик разорвёт поиск пары. Держите scale=1.
- **Эфемерный диск** (Render/Koyeb): SQLite-рекорды сбрасываются при редеплое,
  если не подключён постоянный диск/том.
- Бесплатные инстансы «засыпают» без трафика — первый запрос может проснуться
  с задержкой (это норма платформы, не бага).

## Протокол (кратко)

C→S: `auth {playerId,nickname}`, `matchmaking:find|cancel`, `room:create|join|leave`,
`game:input {mx,my,aim,shoot,mis}` (без ack, ~20 Гц), `game:buy {track}`,
`solo:submit {score}`.
S→C: `auth:ok`, `matchmaking:*`, `match:found`, `room:*`, `game:start`,
`game:state` (~15–30 Гц компактный снапшот), `game:over`.

Баланс игры (HP астероидов, цены апгрейдов, пороги комет/врагов) целиком
живёт в `shared/balance.js` — правится без пересборки образа (статика).
