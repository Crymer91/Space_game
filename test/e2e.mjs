// E2E-проверка GameServer: поднимает сервер на тестовом порту и играет матч
// двумя клиентами: auth → matchmaking → game:start → снапшоты → покупка → рекорд.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { io } from 'socket.io-client';
import { createWorld, stepWorld, snapshotOf, selectCard, expThreshold } from '../shared/world.js';

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
  ok(buy?.error === 'store-disabled', 'покупка внутри матча отключена (монеты тратятся в Ангаре)');

  const submit = await emitAck(a, 'solo:submit', { score: 1234, coins: 7 });
  ok(submit?.ok && submit.data.bestScore >= 1234, 'рекорд сохраняется');
  ok(submit.data.coinsSolo >= 7, 'монеты solo попадают в раздельный банк coinsSolo');
  ok(submit.data.coinsMulti === 0, 'банк мультиплеера не смешивается с solo');

  // ---- модули (Б1): разблокировка → активация → усиление ----
  const modUnlock = await emitAck(a, 'module:unlock', { key: 'rockets', mode: 'solo' });
  ok(modUnlock?.ok && modUnlock.data.modules?.solo?.unlocked?.rockets === true,
    'ракеты разблокируются бесплатно (с Фантома) и попадают в solo');
  const modUnlockAgain = await emitAck(a, 'module:unlock', { key: 'rockets', mode: 'solo' });
  ok(modUnlockAgain?.error === 'already-unlocked', 'повторная разблокировка отклоняется');
  const badMod = await emitAck(a, 'module:unlock', { key: 'nope', mode: 'solo' });
  ok(badMod?.error === 'unknown-module', 'неизвестный модуль отклоняется');
  // активация за 10 монет из solo-банка (сейчас 7 — не хватает)
  const modAct = await emitAck(a, 'module:setActive', { key: 'rockets', mode: 'solo', active: true });
  ok(modAct?.error === 'not-enough-coins', 'активация стоит монет из банка режима');
  const modUpNo = await emitAck(a, 'module:upgrade', { key: 'rockets', mode: 'solo' });
  ok(modUpNo?.error === 'not-enough-coins', 'улучшение требует монет');
  // пополняем solo-банк и активируем
  await emitAck(a, 'solo:submit', { score: 2000, coins: 20 });
  const modAct2 = await emitAck(a, 'module:setActive', { key: 'rockets', mode: 'solo', active: true });
  ok(modAct2?.ok && modAct2.data.modules?.solo?.active?.rockets === true,
    'активация модуля после оплаты успешна');
  ok(modAct2.data.coinsSolo < 27, 'монеты списались из solo-банка');
  const modUp = await emitAck(a, 'module:upgrade', { key: 'rockets', mode: 'solo' });
  ok(modUp?.ok && modUp.data.modules?.solo?.levels?.rockets === 1,
    'уровень модуля ракеты растёт (0 → 1)');
  const modUpMulti = await emitAck(a, 'module:upgrade', { key: 'rockets', mode: 'multi' });
  ok(modUpMulti?.error === 'not-unlocked', 'банк мультиплеера независим от solo');

  // ---- карточки уровня (А3): сервер принимает выбор только по pending карточкам ----
  const cardNo = await emitAck(a, 'card:select', { cardId: 'damage' });
  ok(cardNo?.error === 'no-cards', 'выбор карточки без pending отклоняется');
  const cardBad = await emitAck(b, 'card:select', { cardId: 'nope' });
  ok(cardBad?.error === 'no-cards', 'выбор без pending отклоняется и для второго игрока');
  const cardNoAuth = await new Promise((resolve) => {
    const c = io(URL, { transports: ['websocket'] });
    c.on('connect', async () => {
      resolve(await emitAck(c, 'card:select', { cardId: 'damage' }));
      c.disconnect();
    });
  });
  ok(cardNoAuth?.error === 'not-authorized', 'card:select без auth отклоняется');

  // ---- Rogue-like карточки (А3): уровень → 3 карточки → бесплатный выбор ----
  // Проверяем общую симуляцию (одну для solo и multi) детерминированно: без сети.
  {
    const world = createWorld({ playerIds: ['u'], nicknames: { u: 'Unit' }, durationMs: null, seed: 42 });
    const p = world.players[0];
    // порог 1→2 = БАЗА (10); ставим 9 экспы и кладём 1 сферу точно в игрока
    p.energy = expThreshold(p.level) - 1;
    world.energySpheres.push({ id: 1, x: p.x, y: p.y, vx: 0, vy: 0, born: world.t });
    stepWorld(world, 1 / 60, { u: { mx: 0, my: 0, shoot: false } });
    ok(p.level === 2, 'уровень ↑ при достижении порога экспы');
    ok(Array.isArray(world.pendingCards.u) && world.pendingCards.u.length === 3,
      'генерируются 3 случайные карточки');
    ok(world.pendingCards.u.every((c) => c.id && c.name && c.desc),
      'карточки содержат id/название/описание');
    const snap = snapshotOf(world);
    ok(snap.pc && snap.pc.u && snap.pc.u.length === 3, 'снапшот отдаёт карточки клиенту');
    const spent = p.energy;
    const res = selectCard(world, 'u', world.pendingCards.u[0].id);
    ok(res.ok && world.pendingCards.u == null, 'выбор карточки применён, pending очищен');
    ok(p.energy === spent, 'энергия не списывается при выборе карточки');
    ok(expThreshold(2) === expThreshold(1) * 2, 'порог следующего уровня растёт в ×2');
  }

  // ---- Новые противники (В4): бронированный / очередь / орбитальный ----
  {
    const fresh = () => {
      const w = createWorld({ playerIds: ['u'], nicknames: { u: 'Unit' }, durationMs: null, seed: 11 });
      const p = w.players[0];
      p.lives = 9999;
      p.invulnUntil = 1e9;
      return { w, p };
    };
    const stepN = (w, n) => {
      for (let i = 0; i < n; i++) stepWorld(w, 1 / 60, { u: { mx: 0, my: 0, shoot: false } });
    };
    // 1) бронированный: урон сначала по броне, монета восполняет +10%
    {
      const { w, p } = fresh();
      w.enemies.push({
        id: 'v4-arm', kind: 'armored', x: p.x + 90, y: p.y, vx: 0, vy: 0, a: 0,
        r: 20, hp: 5, maxHp: 5, armor: 5, maxArmor: 5, fireCdAt: 0, strafe: 1,
      });
      w.bullets.push({ id: 1, x: p.x, y: p.y, vx: 560, vy: 0, a: 0, owner: 'u', born: 0 });
      stepN(w, 60);
      const e = w.enemies.find((x) => x.id === 'v4-arm');
      ok(e && e.hp === 5 && e.armor === 4, 'броня поглощает урон раньше HP');
      w.coins.push({ id: 2, x: e.x - 60, y: e.y - 60, vx: 0, vy: 0, born: w.t });
      stepN(w, 150);
      const e2 = w.enemies.find((x) => x.id === 'v4-arm');
      ok(e2 && e2.armor >= 4.5, 'монета восполняет броню (+10%)');
    }
    // 2) очередной стрелок: несколько выстрелов подряд
    {
      const { w, p } = fresh();
      w.enemies.push({
        id: 'v4-bur', kind: 'burst', x: p.x + 340, y: p.y, vx: 0, vy: 0, a: 0,
        r: 18, hp: 7, maxHp: 7, burstLeft: 0, burstNextAt: 0, burstCdUntil: 0,
        powLvl: 0, fireCdAt: 0, strafe: 1,
      });
      let fired = 0;
      for (let i = 0; i < 180; i++) {
        const before = w.bullets.length;
        stepWorld(w, 1 / 60, { u: { mx: 0, my: 0, shoot: false } });
        fired += Math.max(0, w.bullets.length - before);
      }
      ok(fired >= 5, `очередной стрелок даёт очередь выстрелов (было ${fired})`);
    }
    // 3) орбитальный: ломает метеорит на пути, сам жив
    {
      const { w, p } = fresh();
      w.enemies.push({
        id: 'v4-orb', kind: 'orbital', x: p.x + 200, y: p.y, vx: 0, vy: 0, a: 0,
        r: 17, hp: 6, maxHp: 6, orbitR: 240, orbA: 0, orbDir: 1,
      });
      w.asteroids.push({
        id: 9, type: 'small', x: p.x + 195, y: p.y + 5, vx: 0, vy: 0,
        r: 14, hp: 1, maxHp: 1, rot: 0, rotSpeed: 0, shapeSeed: 1,
      });
      stepN(w, 120);
      ok(!w.asteroids.some((a) => a.id === 9), 'орбитальный уничтожает метеорит на пути');
      ok(w.enemies.some((x) => x.id === 'v4-orb'), 'орбитальный остаётся жив');
    }
  }

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
