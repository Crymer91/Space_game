# AGENTS.md — Asteroid Blaster

## Project

Single-package Node.js (ESM) game: Socket.IO server + Canvas 2D web client.
No build step, no transpiler, no native modules. Pure JS everywhere.

## Commands

| Task | Command |
|------|---------|
| Install deps | `npm install` |
| Run server | `npm start` → `http://localhost:3000` |
| Dev mode (auto-restart) | `npm run dev` |
| E2E test | `npm test` → spawns own server on `:3199` with temp DB |
| Docker | `docker compose up --build -d` |

No lint, typecheck, or formatter is configured. Run `npm test` to verify changes.

## Changelog (mandatory)

After **any** change that adds, fixes, or tunes a feature (gameplay, balance, UI,
rendering, server, tests, config, etc.), record it in **`CHANGELOG.md`**.

- Add a concise bullet under the current or new dated `## YYYY-MM-DD` section
  (use today's date; create the heading if it doesn't exist).
- The log must cover **all** features and improvements regardless of author —
  including work by other people or other sessions.
- Bullets should describe the user-visible or behavioral effect, in Russian,
  one line each.
- Run `npm test` for logic/server changes before finalizing; update the
  changelog for the verified change as the last step.

## Architecture

```
src/server.js      — entry point: HTTP + Socket.IO + static file serving
src/events.js      — socket event handlers (auth, matchmaking, game)
src/rooms.js       — room management by code
src/matchmaking.js — random-pair queue
src/db.js          — JSON file storage (no SQLite despite .env.example comment)
src/game/          — authoritative server simulation (~30 Hz tick)
  manager.js       — attaches/destroys game sessions per room
  session.js       — single match simulation
shared/            — shared code loaded by both server AND browser
  balance.js       — all game balance (HP, prices, thresholds) — edit here to tune gameplay
  world.js         — shared simulation helpers
public/            — browser client (served as static files)
  index.html
  js/main.js       — client entry
  js/net.js        — Socket.IO client
  js/render.js     — Canvas 2D rendering
  js/input.js      — input handling
  js/multi.js      — multiplayer UI
  js/local.js      — local/solo mode
```

## Key conventions

- **ESM only** — `"type": "module"` in package.json. Use `import`, never `require`.
- **`config.js`** (root) reads env via `dotenv/config`. All tunables flow through it.
- **`shared/` is dual-context** — files here run on both Node.js and in the browser. No Node-specific APIs (`fs`, `path`, etc.) in shared code.
- **`shared/balance.js`** is the single source of truth for game tuning. Changing it affects both server simulation and client UI without rebuild.
- **Static serving**: server serves `public/` and also exposes `shared/` at `/shared/` URL path.
- **No TypeScript**, no JSX, no CSS preprocessors.

## E2E test

`npm test` runs `test/e2e.mjs` which:
1. Spawns a fresh server on port **3199** with a temp DB directory.
2. Connects two Socket.IO clients, runs auth → matchmaking → gameplay → score submission.
3. Cleans up server process and temp files automatically.
4. **No external services required** — fully self-contained.
5. Requires `socket.io-client` (devDependency), which is not installed in Docker (prod only).

## Gotchas

- **Single-process only** — matchmaking and rooms live in memory. Scaling to multiple replicas breaks pairing.
- **DB is a JSON file** (despite `.env.example` saying "SQLite"). Config key is `DB_PATH`.
- **`DB_PATH` in Docker** defaults to `/app/data/server.db.json` and is backed by a Docker volume.
- **Docker build** uses `--omit=dev`, so `socket.io-client` is absent in the container. E2E tests cannot run inside Docker.
- **Free hosting platforms** put instances to sleep; first request after idle has a cold-start delay.
