// Ядро симуляции «Asteroid Blaster». Один и тот же код крутится на сервере
// (мультиплеер) и в браузере (одиночный режим). Только чистая логика,
// без Node/browser API — файл совместим с обоими окружениями.

import { BALANCE } from './balance.js';

const B = BALANCE;

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rand(rng, min, max) {
  return min + rng() * (max - min);
}

function randInt(rng, min, max) {
  return Math.floor(rand(rng, min, max + 1));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

const EMPTY_INPUT = Object.freeze({ mx: 0, my: 0, aim: undefined, shoot: false });

export function createWorld({ playerIds, nicknames = {}, durationMs = B.matchDurationMs, seed = 1 }) {
  const world = {
    rng: mulberry32(seed),
    t: 0, // время симуляции, мс
    durationMs: durationMs == null ? null : durationMs,
    timeLeftMs: durationMs == null ? null : durationMs,
    status: 'running',
    spawnTimerMs: 500,
    nextAsteroidId: 1,
    nextBulletId: 1,
    nextCoinId: 1,
    nextFxId: 1,
    players: [],
    asteroids: [],
    bullets: [],
    coins: [],
    enemies: [],
    missiles: [],
    fx: [],
    nextEnemyId: 1,
    nextMissileId: 1,
    cometsUnlocked: false,
    enemiesUnlocked: false,
    cometTimerMs: 1000,
    enemyTimerMs: B.enemies.firstSpawnDelayMs,
  };
  let i = 0;
  for (const id of playerIds) {
    world.players.push({
      id,
      nick: nicknames[id] || id,
      slot: i++,
      x: B.world.width / 2 + (i % 2 === 1 ? -140 : 140),
      y: B.world.height / 2,
      vx: 0,
      vy: 0,
      a: i % 2 === 1 ? Math.PI / 2 : -Math.PI / 2,
      alive: true,
      out: false, // потерял все жизни
      lives: B.ship.lives,
      coins: 0,
      score: 0,
      kills: 0,
      deaths: 0,
      dmgLvl: 0,
      rateLvl: 0,
      cooldownAt: 0,
      respawnAt: 0,
      invulnUntil: B.ship.invulnMs, // неуязвимость на старте
      missiles: 0, // боезапас самонаводящихся ракет
      missileCdAt: 0,
    });
  }
  return world;
}

export function bulletDamage(p) {
  return 1 + p.dmgLvl * B.upgrades.damage.dmgPerLevel;
}

export function fireCooldownMs(p) {
  return B.ship.fireCooldownMs * Math.pow(B.upgrades.firerate.cooldownFactor, p.rateLvl);
}

export function upgradeCost(track, level) {
  const def = B.upgrades[track];
  if (!def) return null;
  return def.costs[level] ?? null; // null = максимальный уровень
}

export function buyUpgrade(world, playerId, track) {
  if (world.status !== 'running') return { error: 'match-over' };
  const p = world.players.find((pl) => pl.id === playerId);
  if (!p || !p.alive) return { error: 'not-found' };

  if (track === 'life') {
    const def = B.upgrades.life;
    if (!def) return { error: 'bad-track' };
    if (p.lives >= def.maxLives) return { error: 'max-level' };
    if (p.coins < def.cost) return { error: 'not-enough-coins' };
    p.coins -= def.cost;
    p.lives++;
    addFx(world, 'upgrade', p.x, p.y, 1);
    return { ok: true, track, cost: def.cost };
  }

  if (track === 'missiles') {
    const def = B.upgrades.missiles;
    if (!def) return { error: 'bad-track' };
    if (p.missiles >= def.maxAmmo) return { error: 'max-level' };
    if (p.coins < def.cost) return { error: 'not-enough-coins' };
    p.coins -= def.cost;
    p.missiles = Math.min(def.maxAmmo, p.missiles + def.pack);
    addFx(world, 'upgrade', p.x, p.y, 1);
    return { ok: true, track, cost: def.cost };
  }

  if (!B.upgrades[track]) return { error: 'bad-track' };
  const cost = upgradeCost(track, p[track === 'damage' ? 'dmgLvl' : 'rateLvl']);
  if (cost == null) return { error: 'max-level' };
  if (p.coins < cost) return { error: 'not-enough-coins' };
  p.coins -= cost;
  if (track === 'damage') p.dmgLvl++;
  else p.rateLvl++;
  addFx(world, 'upgrade', p.x, p.y, 1);
  return { ok: true, track, cost };
}

function addFx(world, type, x, y, size = 1) {
  world.fx.push({ id: world.nextFxId++, type, x, y, size, bornAt: world.t });
  if (world.fx.length > 48) world.fx.splice(0, world.fx.length - 48);
}

function spawnBullet(world, p) {
  const nose = B.ship.radius + 6;
  world.bullets.push({
    id: world.nextBulletId++,
    x: p.x + Math.cos(p.a) * nose,
    y: p.y + Math.sin(p.a) * nose,
    vx: Math.cos(p.a) * B.bullet.speed + p.vx * 0.35,
    vy: Math.sin(p.a) * B.bullet.speed + p.vy * 0.35,
    a: p.a,
    owner: p.id,
    born: world.t,
  });
  addFx(world, 'shoot', p.x + Math.cos(p.a) * nose, p.y + Math.sin(p.a) * nose, 1);
}

function asteroidDef(type) {
  return B.asteroid[type];
}

function pickAsteroidType(world) {
  const W = B.waves;
  const prog = Math.min(1, world.t / W.rampMs);
  const weights = {
    small: lerp(W.weightsStart.small, W.weightsEnd.small, prog),
    medium: lerp(W.weightsStart.medium, W.weightsEnd.medium, prog),
    large: lerp(W.weightsStart.large, W.weightsEnd.large, prog),
  };
  const total = weights.small + weights.medium + weights.large;
  let r = world.rng() * total;
  for (const key of ['small', 'medium', 'large']) {
    r -= weights[key];
    if (r <= 0) return key;
  }
  return 'small';
}

function spawnAsteroid(world, type, atX, atY, speedScale = 1) {
  const def = asteroidDef(type);
  const w = B.world.width;
  const h = B.world.height;
  let x = atX;
  let y = atY;
  if (x == null || y == null) {
    // спавн на случайной кромке, подальше от живых кораблей
    for (let attempt = 0; attempt < 8; attempt++) {
      const side = randInt(world.rng, 0, 3);
      const m = 60;
      if (side === 0) { x = rand(world.rng, 0, w); y = -m; }
      else if (side === 1) { x = w + m; y = rand(world.rng, 0, h); }
      else if (side === 2) { x = rand(world.rng, 0, w); y = h + m; }
      else { x = -m; y = rand(world.rng, 0, h); }
      const tooClose = world.players.some(
        (p) => !p.out && p.alive && Math.hypot(p.x - x, p.y - y) < 220
      );
      if (!tooClose) break;
    }
  }
  const rMax = def.radiusMax;
  // направление внутрь поля с разбросом
  const tx = rand(world.rng, w * 0.2, w * 0.8);
  const ty = rand(world.rng, h * 0.2, h * 0.8);
  const ang = Math.atan2(ty - y, tx - x) + rand(world.rng, -0.5, 0.5);
  const sp = rand(world.rng, def.speedMin, def.speedMax) * speedScale;
  world.asteroids.push({
    id: world.nextAsteroidId++,
    type,
    x,
    y,
    vx: Math.cos(ang) * sp,
    vy: Math.sin(ang) * sp,
    r: rand(world.rng, def.radiusMin, def.radiusMax),
    hp: def.hp,
    maxHp: def.hp,
    rot: rand(world.rng, 0, Math.PI * 2),
    rotSpeed: rand(world.rng, -1.4, 1.4),
    shapeSeed: randInt(world.rng, 1, 1e9),
  });
}

function spawnCoinBurst(world, x, y, count) {
  for (let i = 0; i < count; i++) {
    const ang = world.rng() * Math.PI * 2;
    const sp = rand(world.rng, 40, 170);
    world.coins.push({
      id: world.nextCoinId++,
      x,
      y,
      vx: Math.cos(ang) * sp,
      vy: Math.sin(ang) * sp,
      born: world.t,
    });
  }
}

function destroyAsteroid(world, a, owner) {
  const def = asteroidDef(a.type);
  if (owner) {
    owner.score += def.score;
    owner.kills++;
  }
  const coins = randInt(world.rng, def.coinsMin, def.coinsMax);
  if (coins > 0) spawnCoinBurst(world, a.x, a.y, coins);
  addFx(world, 'boom', a.x, a.y, a.maxHp >= 10 ? 3 : a.maxHp >= 5 ? 2 : 1);
  a.dead = true;

  const A = B.asteroid;
  if (a.type === 'large' && A.splitLargeIntoMediums > 0) {
    for (let i = 0; i < A.splitLargeIntoMediums; i++) {
      spawnAsteroid(world, 'medium', a.x, a.y, 1.05);
    }
  } else if (a.type === 'medium' && A.splitMediumIntoSmalls > 0) {
    for (let i = 0; i < A.splitMediumIntoSmalls; i++) {
      spawnAsteroid(world, 'small', a.x, a.y, 1.1);
    }
  }
}

function shipHit(world, p, now) {
  p.lives--;
  p.deaths++;
  p.alive = false;
  addFx(world, 'boom', p.x, p.y, 2.4);

  if (B.ship.dropCoinsOnDeath && p.coins > 0) {
    const drop = Math.floor(p.coins / 2);
    if (drop > 0) {
      p.coins -= drop;
      spawnCoinBurst(world, p.x, p.y, drop);
    }
  }

  if (p.lives <= 0) {
    p.out = true;
  } else {
    p.respawnAt = now + B.ship.respawnMs;
  }
}

function respawnShip(world, p) {
  const w = B.world.width;
  const h = B.world.height;
  let best = null;
  for (let attempt = 0; attempt < 25; attempt++) {
    const x = rand(world.rng, 90, w - 90);
    const y = rand(world.rng, 90, h - 90);
    let ok = true;
    for (const a of world.asteroids) {
      if (Math.hypot(a.x - x, a.y - y) < a.r + 150) { ok = false; break; }
    }
    if (ok) {
      for (const o of world.players) {
        if (o !== p && o.alive && !o.out && Math.hypot(o.x - x, o.y - y) < 130) { ok = false; break; }
      }
    }
    if (ok) { best = { x, y }; break; }
    if (!best) best = { x, y }; // запасной вариант — последняя попытка
  }
  p.x = best.x;
  p.y = best.y;
  p.vx = 0;
  p.vy = 0;
  p.alive = true;
  p.invulnUntil = world.t + B.ship.invulnMs;
  addFx(world, 'spawn', p.x, p.y, 1);
}

function wrap(v, max, margin) {
  if (v < -margin) return max + margin;
  if (v > max + margin) return -margin;
  return v;
}

// --- кометы: быстрые «снаряды», летящие насквозь ---

function edgePoint(world) {
  const w = B.world.width;
  const h = B.world.height;
  const side = randInt(world.rng, 0, 3);
  const m = 60;
  if (side === 0) return { x: rand(world.rng, 0, w), y: -m };
  if (side === 1) return { x: w + m, y: rand(world.rng, 0, h) };
  if (side === 2) return { x: rand(world.rng, 0, w), y: h + m };
  return { x: -m, y: rand(world.rng, 0, h) };
}

function spawnComet(world) {
  const def = asteroidDef('comet');
  const w = B.world.width;
  const h = B.world.height;
  const at = edgePoint(world);
  const tx = rand(world.rng, w * 0.15, w * 0.85);
  const ty = rand(world.rng, h * 0.15, h * 0.85);
  const ang = Math.atan2(ty - at.y, tx - at.x);
  const sp = rand(world.rng, def.speedMin, def.speedMax);
  world.asteroids.push({
    id: world.nextAsteroidId++,
    type: 'comet',
    x: at.x,
    y: at.y,
    vx: Math.cos(ang) * sp,
    vy: Math.sin(ang) * sp,
    r: rand(world.rng, def.radiusMin, def.radiusMax),
    hp: def.hp,
    maxHp: def.hp,
    rot: ang, // комета ориентирована по полёту
    rotSpeed: 0,
    shapeSeed: randInt(world.rng, 1, 1e9),
    entered: false, // станет true, когда комета войдёт в поле
  });
}

// --- вражеские корабли-охотники ---

function spawnEnemy(world) {
  const E = B.enemies;
  const w = B.world.width;
  const h = B.world.height;
  let x = w / 2;
  let y = -60;
  for (let attempt = 0; attempt < 10; attempt++) {
    const at = edgePoint(world);
    x = at.x;
    y = at.y;
    const tooClose = world.players.some(
      (p) => !p.out && p.alive && Math.hypot(p.x - x, p.y - y) < 260
    );
    if (!tooClose) break;
  }
  world.enemies.push({
    id: 'en' + world.nextEnemyId++,
    x,
    y,
    vx: 0,
    vy: 0,
    a: Math.atan2(h / 2 - y, w / 2 - x),
    hp: E.hp,
    maxHp: E.hp,
    fireCdAt: world.t + 1200,
    strafe: world.rng() < 0.5 ? 1 : -1,
  });
}

export function killEnemy(world, e, owner) {
  e.dead = true;
  if (owner) {
    owner.score += B.enemies.score;
    owner.kills++;
  }
  spawnCoinBurst(world, e.x, e.y, randInt(world.rng, B.enemies.coinsMin, B.enemies.coinsMax));
  addFx(world, 'boom', e.x, e.y, 2.6);
}

function updateEnemies(world, dt, now) {
  const E = B.enemies;
  const w = B.world.width;
  const h = B.world.height;
  for (const e of world.enemies) {
    // цель — ближайший живой игрок
    let target = null;
    let bd = Infinity;
    for (const p of world.players) {
      if (!p.alive || p.out) continue;
      const d = Math.hypot(p.x - e.x, p.y - e.y);
      if (d < bd) { bd = d; target = p; }
    }
    let ax = 0;
    let ay = 0;
    if (target && bd < E.engageDistMax * 1.6) {
      const nx = (target.x - e.x) / (bd || 1);
      const ny = (target.y - e.y) / (bd || 1);
      if (bd > E.preferredDistMax) { ax = nx; ay = ny; }
      else if (bd < E.preferredDistMin) { ax = -nx; ay = -ny; }
      else { ax = -ny * e.strafe; ay = nx * e.strafe; }

      // прицел с опережением по скорости цели
      const lead = bd / E.bulletSpeed;
      const want = Math.atan2(
        target.y + target.vy * lead - e.y,
        target.x + target.vx * lead - e.x
      );
      let da = (want - e.a) % (Math.PI * 2);
      if (da > Math.PI) da -= Math.PI * 2;
      if (da < -Math.PI) da += Math.PI * 2;
      const turn = E.turnRate * dt;
      e.a += Math.max(-turn, Math.min(turn, da));

      if (Math.abs(da) < 0.18 && now >= e.fireCdAt && bd < E.engageDistMax) {
        e.fireCdAt = now + E.fireCooldownMs * rand(world.rng, 0.75, 1.3);
        const nose = E.radius + 6;
        world.bullets.push({
          id: world.nextBulletId++,
          x: e.x + Math.cos(e.a) * nose,
          y: e.y + Math.sin(e.a) * nose,
          vx: Math.cos(e.a) * E.bulletSpeed,
          vy: Math.sin(e.a) * E.bulletSpeed,
          a: e.a,
          owner: null,
          enemy: true,
          born: world.t,
        });
        addFx(world, 'shoot', e.x + Math.cos(e.a) * nose, e.y + Math.sin(e.a) * nose, 1);
      }
    }
    e.vx += ax * E.accel * dt;
    e.vy += ay * E.accel * dt;
    const damp = Math.exp(-2 * dt);
    e.vx *= damp;
    e.vy *= damp;
    const sp = Math.hypot(e.vx, e.vy);
    if (sp > E.maxSpeed) { e.vx *= E.maxSpeed / sp; e.vy *= E.maxSpeed / sp; }
    e.x += e.vx * dt;
    e.y += e.vy * dt;
    // не даём врагу улететь далеко за поле
    e.x = Math.max(-80, Math.min(w + 80, e.x));
    e.y = Math.max(-80, Math.min(h + 80, e.y));
  }
  world.enemies = world.enemies.filter((en) => !en.dead);
}

// --- самонаводящиеся ракеты ---

function detonateMissile(world, k, small = false) {
  if (k.dead) return;
  k.dead = true;
  const M = B.missile;
  addFx(world, 'boom', k.x, k.y, small ? 1.4 : 2.4);
  const R = small ? M.blastRadius * 0.4 : M.blastRadius;
  const dmg = small ? 2 : M.blastDamage;
  const owner = world.players.find((p) => p.id === k.owner) || null;
  // урон получают только астероиды, кометы и враги — игроков не задевает
  for (const a of world.asteroids) {
    if (a.dead) continue;
    if (Math.hypot(a.x - k.x, a.y - k.y) <= R + a.r * 0.5) {
      a.hp -= dmg;
      if (a.hp <= 0) destroyAsteroid(world, a, owner);
    }
  }
  for (const en of world.enemies) {
    if (en.dead) continue;
    if (Math.hypot(en.x - k.x, en.y - k.y) <= R) {
      en.hp -= dmg;
      if (en.hp <= 0) killEnemy(world, en, owner);
    }
  }
}

function updateMissiles(world, dt, now) {
  const M = B.missile;
  for (const k of world.missiles) {
    // ближайшая цель — астероид или враг (враги чуть приоритетнее)
    let best = null;
    let bd = Infinity;
    for (const en of world.enemies) {
      const d = Math.hypot(en.x - k.x, en.y - k.y) * 0.7;
      if (d < bd) { bd = d; best = en; }
    }
    for (const a of world.asteroids) {
      const d = Math.hypot(a.x - k.x, a.y - k.y);
      if (d < bd) { bd = d; best = a; }
    }
    if (best) {
      const want = Math.atan2(best.y - k.y, best.x - k.x);
      let da = (want - k.a) % (Math.PI * 2);
      if (da > Math.PI) da -= Math.PI * 2;
      if (da < -Math.PI) da += Math.PI * 2;
      const turn = M.turnRate * dt;
      k.a += Math.max(-turn, Math.min(turn, da));
      const rr = (best.type != null ? best.r : B.enemies.radius) + 16;
      if (bd < rr) {
        detonateMissile(world, k);
        continue;
      }
    }
    k.spd = Math.min(k.spd + M.accel * dt, M.maxSpeed);
    k.x += Math.cos(k.a) * k.spd * dt;
    k.y += Math.sin(k.a) * k.spd * dt;
    if (now - k.born > M.lifeMs) detonateMissile(world, k, true);
  }
  world.missiles = world.missiles.filter((k) => !k.dead);
}

export function stepWorld(world, dtSec, inputs) {
  if (world.status !== 'running') return;
  const dt = Math.min(Math.max(dtSec, 0), 0.05); // защита от скачков времени
  world.t += dt * 1000;
  const now = world.t;
  const w = B.world.width;
  const h = B.world.height;
  const S = B.ship;

  // --- корабли ---
  for (const p of world.players) {
    if (p.out) continue;
    if (!p.alive) {
      if (p.lives > 0 && now >= p.respawnAt) respawnShip(world, p);
      else continue;
    }
    const inp = inputs[p.id] || EMPTY_INPUT;
    let mx = Number.isFinite(inp.mx) ? Math.max(-1, Math.min(1, inp.mx)) : 0;
    let my = Number.isFinite(inp.my) ? Math.max(-1, Math.min(1, inp.my)) : 0;
    const len = Math.hypot(mx, my);
    if (len > 1) { mx /= len; my /= len; }

    p.vx += mx * S.accel * dt;
    p.vy += my * S.accel * dt;
    const damp = Math.exp(-S.friction * dt);
    p.vx *= damp;
    p.vy *= damp;
    const sp = Math.hypot(p.vx, p.vy);
    if (sp > S.maxSpeed) { p.vx *= S.maxSpeed / sp; p.vy *= S.maxSpeed / sp; }
    p.x += p.vx * dt;
    p.y += p.vy * dt;

    const R = S.radius;
    if (p.x < R) { p.x = R; p.vx *= -0.4; }
    if (p.x > w - R) { p.x = w - R; p.vx *= -0.4; }
    if (p.y < R) { p.y = R; p.vy *= -0.4; }
    if (p.y > h - R) { p.y = h - R; p.vy *= -0.4; }

    if (Number.isFinite(inp.aim)) p.a = inp.aim;
    p.thrust = len > 0.15;

    if (inp.shoot && now >= p.cooldownAt) {
      p.cooldownAt = now + fireCooldownMs(p);
      spawnBullet(world, p);
    }

    // пуск самонаводящейся ракеты (ПКМ / F)
    if (inp.mis && now >= p.missileCdAt && p.missiles > 0) {
      p.missileCdAt = now + B.upgrades.missiles.fireCooldownMs;
      p.missiles--;
      world.missiles.push({
        id: world.nextMissileId++,
        x: p.x + Math.cos(p.a) * (S.radius + 8),
        y: p.y + Math.sin(p.a) * (S.radius + 8),
        a: p.a,
        spd: 150,
        owner: p.id,
        born: world.t,
      });
      addFx(world, 'shoot', p.x + Math.cos(p.a) * S.radius, p.y + Math.sin(p.a) * S.radius, 1);
    }
  }

  // --- пули ---
  const bm = 30; // запас за краем
  for (const b of world.bullets) {
    b.x += b.vx * dt;
    b.y += b.vy * dt;
  }
  world.bullets = world.bullets.filter(
    (b) => now - b.born < B.bullet.lifeMs &&
      b.x > -bm && b.x < w + bm && b.y > -bm && b.y < h + bm
  );

  // --- астероиды и кометы ---
  for (const a of world.asteroids) {
    a.x += a.vx * dt;
    a.y += a.vy * dt;
    a.rot += a.rotSpeed * dt;
    if (a.type === 'comet') {
      // комета летит насквозь и удаляется, вылетев за поле
      const m = a.r + 60;
      if (!a.entered && a.x > -10 && a.x < w + 10 && a.y > -10 && a.y < h + 10) {
        a.entered = true;
      }
      if (a.entered &&
        (a.x < -m || a.x > w + m || a.y < -m || a.y > h + m)) {
        a.dead = true;
      }
    } else {
      a.x = wrap(a.x, w, a.r + 10);
      a.y = wrap(a.y, h, a.r + 10);
    }
  }

  // --- столкновения: пули игроков × астероиды ---
  for (const b of world.bullets) {
    if (b.dead || b.enemy) continue;
    for (const a of world.asteroids) {
      if (a.dead) continue;
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const rr = a.r + B.bullet.radius;
      if (dx * dx + dy * dy <= rr * rr) {
        const owner = world.players.find((p) => p.id === b.owner) || null;
        a.hp -= owner ? bulletDamage(owner) : 1;
        b.dead = true;
        if (a.hp <= 0) destroyAsteroid(world, a, owner);
        else addFx(world, 'hit', b.x, b.y, 1);
        break;
      }
    }
  }
  world.bullets = world.bullets.filter((b) => !b.dead);
  world.asteroids = world.asteroids.filter((a) => !a.dead);

  // --- столкновения: пули игроков × враги ---
  for (const b of world.bullets) {
    if (b.dead || b.enemy) continue;
    for (const e of world.enemies) {
      if (e.dead) continue;
      const dx = e.x - b.x;
      const dy = e.y - b.y;
      const rr = B.enemies.radius + B.bullet.radius;
      if (dx * dx + dy * dy <= rr * rr) {
        const owner = world.players.find((p) => p.id === b.owner) || null;
        e.hp -= owner ? bulletDamage(owner) : 1;
        b.dead = true;
        if (e.hp <= 0) killEnemy(world, e, owner);
        else addFx(world, 'hit', b.x, b.y, 1);
        break;
      }
    }
  }
  world.enemies = world.enemies.filter((e) => !e.dead);

  // --- столкновения: корабли × всё опасное ---
  for (const p of world.players) {
    if (!p.alive || p.out || now < p.invulnUntil) continue;
    let hit = false;
    for (const a of world.asteroids) {
      const dx = a.x - p.x;
      const dy = a.y - p.y;
      const rr = a.r + S.radius * 0.85; // чуть щадящий хитбокс
      if (dx * dx + dy * dy <= rr * rr) { hit = true; break; }
    }
    if (!hit) {
      for (const b of world.bullets) {
        if (!b.enemy || b.dead) continue;
        const dx = b.x - p.x;
        const dy = b.y - p.y;
        const rr = S.radius * 0.9 + B.bullet.radius;
        if (dx * dx + dy * dy <= rr * rr) { b.dead = true; hit = true; break; }
      }
    }
    if (!hit) {
      for (const e of world.enemies) {
        const dx = e.x - p.x;
        const dy = e.y - p.y;
        const rr = e.r == undefined ? B.enemies.radius + S.radius * 0.85 : e.r + S.radius * 0.85;
        if (dx * dx + dy * dy <= rr * rr) { hit = true; break; }
      }
    }
    if (hit) shipHit(world, p, now);
  }

  // --- монеты ---
  const C = B.coin;
  const coinDamp = Math.exp(-C.driftDamping * dt);
  for (const c of world.coins) {
    c.vx *= coinDamp;
    c.vy *= coinDamp;
    // магнит: притяжение к ближайшему живому кораблю
    let target = null;
    let bestD = C.magnetRadius;
    for (const p of world.players) {
      if (!p.alive || p.out) continue;
      const d = Math.hypot(p.x - c.x, p.y - c.y);
      if (d < bestD) { bestD = d; target = p; }
    }
    if (target) {
      const d = Math.max(bestD, 1);
      c.vx += ((target.x - c.x) / d) * C.magnetPull * dt;
      c.vy += ((target.y - c.y) / d) * C.magnetPull * dt;
    }
    c.x += c.vx * dt;
    c.y += c.vy * dt;
    c.x = Math.max(C.radius, Math.min(w - C.radius, c.x));
    c.y = Math.max(C.radius, Math.min(h - C.radius, c.y));

    if (target && Math.hypot(target.x - c.x, target.y - c.y) < C.pickupRadius) {
      c.dead = true;
      target.coins++;
      target.score += C.scorePerCoin;
      addFx(world, 'coin', c.x, c.y, 1);
    } else if (now - c.born > C.lifeMs) {
      c.dead = true;
    }
  }
  world.coins = world.coins.filter((c) => !c.dead);

  // --- враги и ракеты ---
  updateEnemies(world, dt, now);
  updateMissiles(world, dt, now);
  // уничтоженное здесь же убираем из мира, чтобы не попало в снапшот
  world.enemies = world.enemies.filter((e) => !e.dead);
  world.missiles = world.missiles.filter((k) => !k.dead);
  world.asteroids = world.asteroids.filter((a) => !a.dead);

  // --- эффекты: удаляем старше 600 мс ---
  world.fx = world.fx.filter((f) => now - f.bornAt < 600);

  // --- волны астероидов ---
  world.spawnTimerMs -= dt * 1000;
  if (world.spawnTimerMs <= 0) {
    const W = B.waves;
    const prog = Math.min(1, world.t / W.rampMs);
    const interval = lerp(W.startIntervalMs, W.minIntervalMs, prog);
    world.spawnTimerMs += interval * rand(world.rng, 0.75, 1.25);
    if (world.asteroids.length < B.asteroid.maxCount) {
      spawnAsteroid(world, pickAsteroidType(world));
    }
  }

  // --- уровни угрозы по счёту ---
  const maxScore = world.players.reduce((m, p) => Math.max(m, p.score), 0);
  if (!world.cometsUnlocked && maxScore >= B.comets.unlockScore) {
    world.cometsUnlocked = true;
    world.cometTimerMs = 600;
    addFx(world, 'warning', w / 2, 100, 1);
  }
  if (!world.enemiesUnlocked && maxScore >= B.enemies.unlockScore) {
    world.enemiesUnlocked = true;
    world.enemyTimerMs = B.enemies.firstSpawnDelayMs;
    addFx(world, 'warning', w / 2, 140, 2);
  }
  if (world.cometsUnlocked) {
    world.cometTimerMs -= dt * 1000;
    if (world.cometTimerMs <= 0) {
      world.cometTimerMs += rand(world.rng, B.comets.intervalMinMs, B.comets.intervalMaxMs);
      if (world.asteroids.length < B.asteroid.maxCount + 6) spawnComet(world);
    }
  }
  if (world.enemiesUnlocked) {
    world.enemyTimerMs -= dt * 1000;
    if (world.enemyTimerMs <= 0) {
      world.enemyTimerMs += rand(world.rng, B.enemies.intervalMinMs, B.enemies.intervalMaxMs);
      if (world.enemies.length < B.enemies.maxAlive) spawnEnemy(world);
    }
  }

  // --- конец матча ---
  const everyoneOut = world.players.every((p) => p.out);
  let timeUp = false;
  if (world.durationMs != null) {
    world.timeLeftMs = Math.max(0, world.durationMs - world.t);
    if (world.timeLeftMs <= 0) timeUp = true;
  }
  if (everyoneOut || timeUp) world.status = 'over';
}

// Компактный снимок состояния для сети/рендера
export function snapshotOf(world) {
  return {
    st: world.status,
    t: Math.round(world.t),
    tl: world.timeLeftMs == null ? null : Math.round(world.timeLeftMs),
    ps: world.players.map((p) => ({
      i: p.id,
      n: p.nick,
      sl: p.slot,
      x: Math.round(p.x * 10) / 10,
      y: Math.round(p.y * 10) / 10,
      a: Math.round(p.a * 100) / 100,
      al: p.alive ? 1 : 0,
      o: p.out ? 1 : 0,
      l: p.lives,
      c: p.coins,
      s: p.score,
      k: p.kills,
      d: p.deaths,
      dl: p.dmgLvl,
      rl: p.rateLvl,
      rs: p.alive ? 0 : Math.max(0, p.respawnAt - world.t),
      iv: Math.max(0, p.invulnUntil - world.t),
      th: p.thrust ? 1 : 0,
      mk: p.missiles || 0,
    })),
    as: world.asteroids.map((a) => {
      const o = {
        i: a.id,
        tp: a.type,
        x: Math.round(a.x * 10) / 10,
        y: Math.round(a.y * 10) / 10,
        r: Math.round(a.r * 10) / 10,
        hp: a.hp,
        mh: a.maxHp,
        ro: Math.round(a.rot * 100) / 100,
        sd: a.shapeSeed,
      };
      if (a.type === 'comet') {
        o.vx = Math.round(a.vx);
        o.vy = Math.round(a.vy);
      }
      return o;
    }),
    bs: world.bullets.map((b) => ({
      i: b.id,
      x: Math.round(b.x),
      y: Math.round(b.y),
      a: Math.round(b.a * 100) / 100,
      e: b.enemy ? 1 : undefined,
    })),
    es: world.enemies.map((e) => ({
      i: e.id,
      x: Math.round(e.x * 10) / 10,
      y: Math.round(e.y * 10) / 10,
      a: Math.round(e.a * 100) / 100,
      h: e.hp,
      hm: e.maxHp,
    })),
    rk: world.missiles.map((k) => ({
      i: k.id,
      x: Math.round(k.x),
      y: Math.round(k.y),
      a: Math.round(k.a * 100) / 100,
    })),
    cs: world.coins.map((c) => ({ i: c.id, x: Math.round(c.x), y: Math.round(c.y) })),
    fx: world.fx.map((f) => ({ i: f.id, tp: f.type, x: Math.round(f.x), y: Math.round(f.y), z: f.size })),
  };
}
