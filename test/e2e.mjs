// E2E-проверка GameServer: поднимает сервер на тестовом порту и играет матч
// двумя клиентами: auth → matchmaking → game:start → снапшоты → покупка → рекорд.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { io } from 'socket.io-client';

const PORT = 3199;
const URL = `http://127.0.0.1:${PORT}`;
const dataDir = mkdtempSync(path.join(tmpdir(), 'ab-e2e-'));

let pass = 0;
let fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log('  ok -', name); }
  else { fail++; console.log('  FAIL -', name); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const once = (sock, ev, timeoutMs = 8000) => new Promise((resolve) => {
  const t = setTimeout(() => resolve(undefined), timeoutMs);
  sock.once(ev, (data) => { clearTimeout(t); resolve(data); });
});
const emitAck = (sock, ev, data = {}) => new Promise((resolve) => sock.emit(ev, data, resolve));

const server = spawn(process.execPath, ['src/server.js'], {
  cwd: path.resolve(import.meta.dirname, '..'),
  env: { ...process.env, PORT: String(PORT), DB_PATH: path.join(dataDir, 'test.db'), LOG_LEVEL: 'warn' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stdout.on('data', () => {});
server.stderr.on('data', (d) => process.stderr.write(d));

try {
  // ждём /healthz
  let healthy = false;
  for (let i = 0; i < 60 && !healthy; i++) {
    await sleep(250);
    try {
      const res = await fetch(`${URL}/healthz`);
      healthy = res.ok && !!(await res.json()).ok;
    } catch {}
  }
  ok(healthy, 'healthz отвечает');

  const a = io(URL, { transports: ['websocket'] });
  const b = io(URL, { transports: ['websocket'] });

  const authA = await emitAck(a, 'auth', { playerId: 'e2e-alpha', nickname: 'Alpha' });
  ok(authA?.ok, 'auth игрока A');
  await emitAck(b, 'auth', { playerId: 'e2e-beta', nickname: 'Beta' });

  const noAuth = await new Promise((resolve) => {
    const c = io(URL, { transports: ['websocket'] });
    c.on('connect', async () => {
      resolve(await emitAck(c, 'solo:submit', { score: 1 }));
      c.disconnect();
    });
  });
  ok(noAuth?.error === 'not-authorized', 'события без auth отклоняются');

  const found = Promise.all([once(a, 'match:found'), once(b, 'match:found')]);
  // подписываемся на game:start ДО поиска — иначе событие можно пропустить
  const started = Promise.all([once(a, 'game:start'), once(b, 'game:start')]);
  await emitAck(a, 'matchmaking:find', { capacity: 2 });
  await emitAck(b, 'matchmaking:find', { capacity: 2 });
  const [fa, fb] = await found;
  ok(!!fa && !!fb && fa.roomId === fb.roomId, 'матчмейкинг свёл пару в одну комнату');

  const [startA, startB] = await started;
  ok(startA && Array.isArray(startA.players) && startA.players.length === 2,
    'game:start получен обоими игроками');
  ok(startB && startB.roomId === startA.roomId, 'roomId совпадает у обоих');

  let snapshots = 0;
  let sawEnemyFields = true;
  a.on('game:state', (s) => {
    snapshots++;
    if (!Array.isArray(s.ps) || !Array.isArray(s.as)) sawEnemyFields = false;
  });
  await sleep(1500);
  ok(snapshots >= 10, `снапшоты идут (${snapshots} за 1.5 с)`);
  ok(sawEnemyFields, 'формат снапшота корректен');

  const buy = await emitAck(a, 'game:buy', { track: 'missiles' });
  ok(buy?.error === 'not-enough-coins', 'покупка без монет отклоняется');

  const submit = await emitAck(a, 'solo:submit', { score: 1234 });
  ok(submit?.ok && submit.data.bestScore >= 1234, 'рекорд сохраняется');

  a.disconnect();
  b.disconnect();
  await sleep(400);

  const health2 = await fetch(`${URL}/healthz`);
  ok(health2.ok, 'сервер жив после матча');
} finally {
  server.kill();
  await sleep(300);
  rmSync(dataDir, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
