// E2E-проверка GameServer: поднимает сервер на тестовом порту и играет матч
// двумя клиентами: auth → matchmaking → game:start → снапшоты → покупка → рекорд.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { io } from 'socket.io-client';
import { createWorld, stepWorld, snapshotOf, selectCard, expThreshold, forcePush } from '../shared/world.js';
import { BALANCE } from '../shared/balance.js';

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

  // ---- Дредноут (В3): броня → HP, монета восполняет броню, фаза 2, очередь ----
  {
    const fresh = () => {
      const w = createWorld({ playerIds: ['u'], nicknames: { u: 'Unit' }, durationMs: null, seed: 12 });
      const p = w.players[0];
      p.lives = 9999;
      p.invulnUntil = 1e9;
      return { w, p };
    };
    const stepN = (w, n) => {
      for (let i = 0; i < n; i++) stepWorld(w, 1 / 60, { u: { mx: 0, my: 0, shoot: false } });
    };
    // 1) броня поглощает урон раньше HP
    {
      const { w, p } = fresh();
      w.bosses.push({
        id: 'v3-dr', key: 'dreadnought', x: p.x + 120, y: p.y, vx: 0, vy: 0, a: 0,
        hp: 140, maxHp: 140, armor: 70, maxArmor: 70, phase: 1, phaseFwdAt: 70, fireCdAt: 1e9,
      });
      w.bullets.push({ id: 1, x: p.x, y: p.y, vx: 560, vy: 0, a: 0, owner: 'u', born: 0 });
      stepN(w, 60);
      const b = w.bosses.find((x) => x.id === 'v3-dr');
      ok(b && b.hp === 140 && b.armor === 69, 'дредноут: броня поглощает урон раньше HP');
    }
    // 2) монета восполняет броню дредноута
    {
      const { w, p } = fresh();
      w.bosses.push({
        id: 'v3-dr', key: 'dreadnought', x: p.x + 120, y: p.y, vx: 0, vy: 0, a: 0,
        hp: 140, maxHp: 140, armor: 20, maxArmor: 70, phase: 1, phaseFwdAt: 70, fireCdAt: 1e9,
      });
      const b = w.bosses[0];
      w.coins.push({ id: 2, x: b.x + 40, y: b.y, vx: 0, vy: 0, born: w.t });
      stepN(w, 10);
      const b2 = w.bosses.find((x) => x.id === 'v3-dr');
      ok(b2 && b2.armor > 20, `монета восполняет броню дредноута (было 20, стало ${b2 && b2.armor})`);
    }
    // 3) фаза 2 при HP < 50%; 4) в фазе 2 — очередь из 3 залпов по 3 пули
    {
      const { w, p } = fresh();
      w.bosses.push({
        id: 'v3-dr', key: 'dreadnought', x: p.x + 300, y: p.y, vx: 0, vy: 0, a: 0,
        hp: 60, maxHp: 140, armor: 0, maxArmor: 0, phase: 1, phaseFwdAt: 70, fireCdAt: 1e9,
      });
      // пуля игрока доводит HP ниже 50% → смена фазы при нанесении урона
      w.bullets.push({ id: 1, x: p.x, y: p.y, vx: 560, vy: 0, a: 0, owner: 'u', born: 0 });
      stepN(w, 60);
      const b = w.bosses.find((x) => x.id === 'v3-dr');
      ok(b && b.phase === 2, 'дредноут переходит в фазу 2 при HP < 50%');
      // сбрасываем перезарядку и считаем очередь в фазе 2
      b.fireCdAt = 0;
      let fired = 0;
      for (let i = 0; i < 45; i++) {
        const before = w.bullets.length;
        stepWorld(w, 1 / 60, { u: { mx: 0, my: 0, shoot: false } });
        fired += Math.max(0, w.bullets.length - before);
      }
      const b2 = w.bosses.find((x) => x.id === 'v3-dr');
      ok(b2 && b2.phase === 2 && fired >= 6 && fired <= 12, `дредноут в фазе 2 стреляет очередью по 3 залпа (пуль: ${fired})`);
    }
  }

  // ---- Боссы В1: варианты/фазы, телепорт, клоны, лазеры ----
  {
    const fresh = () => {
      const w = createWorld({ playerIds: ['u'], nicknames: { u: 'Unit' }, durationMs: null, seed: 41 });
      const p = w.players[0];
      p.lives = 9999;
      p.invulnUntil = 1e9;
      return { w, p };
    };
    const stepN = (w, n) => {
      for (let i = 0; i < n; i++) stepWorld(w, 1 / 60, { u: { mx: 0, my: 0, shoot: false } });
    };
    const mkBoss = (key, extra) => Object.assign({
      id: 'v1-b', key, x: 400, y: 300, vx: 0, vy: 0, a: 0,
      hp: 9999, maxHp: 9999, armor: 0, maxArmor: 0,
      phase: 1, maxPhase: 1, nextPhaseAt: 0, phaseFwdAt: 0,
      burstLeft: 0, burstNextAt: 0,
      fireCdAt: 1e9, mineCdAt: 1e9,
      tpAt: null, cloneAt: null, spinA: 0, laserAt: null,
      born: 0,
    }, extra);
    // 1) конфиг: 9 вариантов, дредноут++ стартует фазы 2, в волнах есть усиленные версии
    {
      const keys = ['dreadnought','dreadnought+','dreadnought++','phantom','phantom+','phantom++','leviathan','leviathan+','leviathan++'];
      ok(keys.every((k) => BALANCE.bosses.types[k]), 'в balance есть все 9 версий боссов');
      ok(BALANCE.bosses.types['dreadnought++'].startPhase === 2, 'дредноут++ стартует сразу со 2-й фазы');
      const bs = BALANCE.waves.list.flatMap((wave) => wave.bosses || []);
      ok(['dreadnought+','phantom+','leviathan+'].every((k) => bs.includes(k)), 'в поздних волнах есть боссы с +');
      ok(['dreadnought++','phantom++','leviathan++'].every((k) => bs.includes(k)), 'в поздних волнах есть боссы с ++');
    }
    // 2) дредноут++: из фазы 2 в фазу 3 при HP ниже 33%
    {
      const { w, p } = fresh();
      const def = BALANCE.bosses.types['dreadnought++'];
      const port = def.hp * def.phasesAt[0]; // 33% от максимума
      w.bosses.push(mkBoss('dreadnought++', { hp: port + 0.5, maxHp: def.hp, phase: 2, maxPhase: 3, nextPhaseAt: port, phaseFwdAt: port, x: p.x + 120, y: p.y }));
      const b = w.bosses[0];
      w.bullets.push({ id: 90, x: b.x, y: b.y, vx: 0, vy: 0, a: 0, owner: 'u', born: 0 });
      stepN(w, 10);
      const b2 = w.bosses.find((x) => x.id === 'v1-b');
      ok(b2 && b2.phase === 3, 'дредноут++ переходит в фазу 3 при HP < 33%');
    }
    // 3) фантом+ в фазе 2 телепортируется: резкий скачок позиции
    {
      const { w, p } = fresh();
      w.bosses.push(mkBoss('phantom+', { phase: 2, maxPhase: 2, tpAt: 1, x: p.x + 200, y: p.y }));
      let maxJump = 0;
      let prev = { x: w.bosses[0].x, y: w.bosses[0].y };
      for (let i = 0; i < 15; i++) {
        stepWorld(w, 1 / 60, { u: { mx: 0, my: 0, shoot: false } });
        const b = w.bosses[0];
        const d = Math.hypot(b.x - prev.x, b.y - prev.y);
        if (d > maxJump) maxJump = d;
        prev = { x: b.x, y: b.y };
      }
      ok(maxJump > 200, `фантом+ телепортируется в фазе 2 (скачок ${Math.round(maxJump)})`);
    }
    // 4) фантом++ в фазе 3 создаёт клонов, убийство клона не даёт наград
    {
      const { w, p } = fresh();
      w.bosses.push(mkBoss('phantom++', { phase: 3, maxPhase: 3, cloneAt: 1, x: p.x + 300, y: p.y }));
      stepN(w, 120);
      const clones = w.bosses.filter((x) => x.clone);
      ok(clones.length >= 1, 'фантом++ в фазе 3 создаёт клонов');
      if (clones.length) {
        const c = clones[0];
        const scoreBefore = p.score;
        const crystalsBefore = w.crystals.length;
        c.hp = 0.5;
        w.bullets.push({ id: 120, x: c.x, y: c.y, vx: 0, vy: 0, a: 0, owner: 'u', born: 0 });
        stepN(w, 10);
        const still = w.bosses.find((x) => x.id === c.id);
        if (!still) {
          ok(p.score === scoreBefore, 'убийство клона фантома не даёт очков');
          ok(w.crystals.length === crystalsBefore, 'убийство клона фантома не даёт дропа');
        }
      }
    }
    // 5) босс-луч левиафана++ наносит урон игроку
    {
      const { w, p } = fresh();
      p.invulnUntil = 0;
      p.lives = 1000;
      w.bosses.push(mkBoss('leviathan++', { phase: 3, maxPhase: 3, x: p.x - 600, y: p.y }));
      const b = w.bosses[0];
      w.bossLasers.push({ id: 1, bossId: b.id, x: b.x, y: b.y, spin: 0, a: 0, aStart: 0, until: w.t + 4000, nextTick: 0, dps: 26, tickMs: 100, width: 12, len: 760, dead: false });
      stepN(w, 90);
      ok(p.lives < 1000, `босс-луч наносит урон игроку (жизни ${p.lives})`);
    }
    // 6) god mode: урон игроку не наносится, жизни не тратятся
    {
      const w = createWorld({ playerIds: ['u'], nicknames: { u: 'Unit' }, durationMs: null, seed: 41, godMode: true });
      const p = w.players[0];
      p.invulnUntil = 0;
      p.lives = 5;
      w.bosses.push(mkBoss('leviathan++', { phase: 3, maxPhase: 3, x: 400, y: 300 }));
      w.bosses[0].x = p.x - 600;
      w.bossLasers.push({ id: 2, bossId: w.bosses[0].id, x: w.bosses[0].x, y: p.y, spin: 0, a: 0, aStart: 0, until: w.t + 4000, nextTick: 0, dps: 26, tickMs: 100, width: 12, len: 760, dead: false });
      for (let i = 0; i < 90; i++) stepWorld(w, 1 / 60, { u: { mx: 0, my: 0, shoot: false } });
      ok(p.lives === 5 && p.alive, 'god mode: жизни не тратятся, игрок жив');
      ok(snapshotOf(w).gm === 1, 'god mode: снапшот несёт флаг gm=1');
    }
  }

  // ---- В2: гудок-волна (forcePush) + отложенный спавн босса ----
  {
    const fresh = () => {
      const w = createWorld({ playerIds: ['u'], nicknames: { u: 'Unit' }, durationMs: null, seed: 12 });
      const p = w.players[0];
      p.lives = 9999;
      p.invulnUntil = 1e9;
      return { w, p };
    };
    const stepN = (w, n) => {
      for (let i = 0; i < n; i++) stepWorld(w, 1 / 60, { u: { mx: 0, my: 0, shoot: false } });
    };
    // 1) forcePush: объект в радиусе получает импульс от точки входа
    {
      const { w, p } = fresh();
      const coin = { id: 99, x: p.x + 400, y: p.y, vx: 0, vy: 0, born: 0 };
      w.coins.push(coin);
      forcePush(w, p.x, p.y, 520, 460);
      ok(coin.vx > 0, 'forcePush: монета отталкивается от эпицентра волны');
      const coin2 = { id: 100, x: p.x + 600, y: p.y, vx: 0, vy: 0, born: 0 };
      w.coins.push(coin2);
      forcePush(w, p.x, p.y, 520, 460);
      ok(coin2.vx === 0, 'forcePush: объект за пределами радиуса не затронут');
    }
    // 2) отложенный спавн: босс появляется после warnMs
    {
      const { w, p } = fresh();
      const waveIndex = 2; // после ++ станет 3 → волна с боссом dreadnought
      w.waveIndex = waveIndex;
      w.wavePhase = 'cooldown';
      w.waveTimer = 0;
      stepN(w, 1);
      ok(w.pendingBosses.length === 1, 'после старта волны — босс в очереди предупреждения');
      ok(w.bosses.length === 0, 'босс ещё не появился');
      const s = snapshotOf(w);
      ok(s.pb && s.pb.length === 1, 'снапшот содержит pb (значки предупреждения)');
      ok(s.pb[0].k === 'dreadnought', 'pb ключ совпадает с ключом босса');
      stepN(w, 125); // > warnMs (2000ms)
      ok(w.pendingBosses.length === 0, 'очередь предупреждений пуста после входа');
      ok(w.bosses.length === 1, 'босс появился после warnMs');
      ok(w.bosses[0].key === 'dreadnought', 'появился дредноут');
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
