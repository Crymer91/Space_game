// Хранилище игроков и матчей на JSON-файле.
// Без нативных модулей — образ собирается на любом base image
// (node:XX-alpine включительно, Python/node-gyp не нужны).
// API совместим с прежней SQLite-версией: createDb / upsertPlayer /
// getPlayerStats / submitScore / saveMatch, у дескриптора есть .close().
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const MAX_MATCHES = 1000; // храним последние матчи, чтобы файл не рос бесконечно

export function createDb(dbPath) {
  const file = path.resolve(dbPath);
  mkdirSync(path.dirname(file), { recursive: true });
  const db = {
    kind: 'json',
    path: file,
    data: { players: {}, matches: [], matchPlayers: [] },
  };
  if (existsSync(file)) {
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8'));
      db.data.players = parsed.players && typeof parsed.players === 'object' ? parsed.players : {};
      db.data.matches = Array.isArray(parsed.matches) ? parsed.matches : [];
      db.data.matchPlayers = Array.isArray(parsed.matchPlayers) ? parsed.matchPlayers : [];
    } catch {
      // повреждённый файл — начинаем с пустого хранилища
    }
  }
  // атомарная запись: сначала во временный файл, затем переименование
  db.flush = () => {
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(db.data));
    renameSync(tmp, file);
  };
  db.close = () => db.flush();
  return db;
}

export function upsertPlayer(db, playerId, nickname) {
  const now = Date.now();
  const p = db.data.players[playerId];
  if (!p) {
    db.data.players[playerId] = {
      nickname, createdAt: now, lastSeenAt: now,
      bestScore: 0, coinsSolo: 0, coinsMulti: 0,
      moduleState: {}, // { solo: {...}, multi: {...} } — состояние модулей (см. раздел «модули»)
    };
  } else {
    p.nickname = nickname;
    p.lastSeenAt = now;
    if (p.coinsSolo == null) p.coinsSolo = 0;
    if (p.coinsMulti == null) p.coinsMulti = 0;
    if (p.moduleState == null) p.moduleState = {};
  }
  db.flush();
}

export function getPlayerStats(db, playerId) {
  let played = 0;
  let wins = 0;
  for (const mp of db.data.matchPlayers) {
    if (mp.playerId !== playerId) continue;
    played++;
    if (mp.isWinner) wins++;
  }
  const p = db.data.players[playerId];
  const modules = p ? { solo: getModules(db, playerId, 'solo'), multi: getModules(db, playerId, 'multi') } : null;
  return {
    played, wins,
    bestScore: p?.bestScore ?? 0,
    coinsSolo: p?.coinsSolo ?? 0,
    coinsMulti: p?.coinsMulti ?? 0,
    modules,
  };
}

export function addCoins(db, playerId, mode, amount) {
  const p = db.data.players[playerId];
  if (!p || !Number.isFinite(amount) || amount <= 0) return;
  const key = mode === 'multi' ? 'coinsMulti' : 'coinsSolo';
  p[key] = (p[key] || 0) + Math.floor(amount);
  p.lastSeenAt = Date.now();
  db.flush();
}

// --- модули (Б1): состояние разблокировки/активации/уровня, раздельно solo/multi ---

function modeKey(mode) {
  return mode === 'multi' ? 'multi' : 'solo';
}

function ensureModuleState(p, mode) {
  const mk = modeKey(mode);
  if (p.moduleState == null) p.moduleState = {};
  const st = p.moduleState[mk] || (p.moduleState[mk] = {});
  if (st.unlocked == null) st.unlocked = {};
  if (st.active == null) st.active = {};
  if (st.levels == null) st.levels = {};
  return st;
}

export function getModules(db, playerId, mode) {
  const p = db.data.players[playerId];
  if (!p) return { unlocked: {}, active: {}, levels: {} };
  const st = ensureModuleState(p, mode);
  return { unlocked: st.unlocked, active: st.active, levels: st.levels };
}

// Разблокировка модуля (за монеты режима или бесплатно с босса, cost=0).
// Возвращает { ok:true, stats } или { error }.
export function unlockModule(db, playerId, mode, key, cost = 0) {
  const p = db.data.players[playerId];
  if (!p) return { error: 'not-found' };
  const coinKey = modeKey(mode) === 'multi' ? 'coinsMulti' : 'coinsSolo';
  const st = ensureModuleState(p, mode);
  if (st.unlocked[key]) return { error: 'already-unlocked' };
  if (p[coinKey] < cost) return { error: 'not-enough-coins' };
  p[coinKey] -= cost;
  st.unlocked[key] = true;
  p.lastSeenAt = Date.now();
  db.flush();
  return { ok: true, stats: getPlayerStats(db, playerId) };
}

// Активация/деактивация модуля. Активируется только разблокированный.
export function setModuleActive(db, playerId, mode, key, active, cost = 0) {
  const p = db.data.players[playerId];
  if (!p) return { error: 'not-found' };
  const coinKey = modeKey(mode) === 'multi' ? 'coinsMulti' : 'coinsSolo';
  const st = ensureModuleState(p, mode);
  if (active && !st.unlocked[key]) return { error: 'not-unlocked' };
  if (active && st.active[key]) return { error: 'already-active' };
  if (active && cost > 0 && p[coinKey] < cost) return { error: 'not-enough-coins' };
  if (active && cost > 0) p[coinKey] -= cost;
  st.active[key] = !!active;
  p.lastSeenAt = Date.now();
  db.flush();
  return { ok: true, stats: getPlayerStats(db, playerId) };
}

// Уровень модуля (уже активный). level = текущий уровень (0..max).
export function upgradeModule(db, playerId, mode, key, level, cost) {
  const p = db.data.players[playerId];
  if (!p) return { error: 'not-found' };
  const coinKey = modeKey(mode) === 'multi' ? 'coinsMulti' : 'coinsSolo';
  const st = ensureModuleState(p, mode);
  if (!st.unlocked[key]) return { error: 'not-unlocked' };
  if (p[coinKey] < cost) return { error: 'not-enough-coins' };
  p[coinKey] -= cost;
  st.levels[key] = (st.levels[key] || 0) + 1;
  p.lastSeenAt = Date.now();
  db.flush();
  return { ok: true, level: st.levels[key], stats: getPlayerStats(db, playerId) };
}

// Сохраняет рекорд одиночной игры (если побит) и возвращает обновлённую статистику
export function submitScore(db, playerId, score, { mode = 'solo', coins = 0 } = {}) {
  const p = db.data.players[playerId];
  if (p) {
    p.bestScore = Math.max(p.bestScore || 0, score);
    if (Number.isFinite(coins) && coins > 0) {
      addCoins(db, playerId, mode, coins); // flush внутри
    } else {
      p.lastSeenAt = Date.now();
      db.flush();
    }
  }
  return getPlayerStats(db, playerId);
}

export function saveMatch(db, { id, roomCode, capacity, players, winner, createdAt, endedAt }) {
  db.data.matches.push({ id, roomCode, capacity, players, winner, createdAt, endedAt });
  if (db.data.matches.length > MAX_MATCHES) {
    db.data.matches.splice(0, db.data.matches.length - MAX_MATCHES);
  }
  for (const p of players) {
    db.data.matchPlayers.push({
      matchId: id,
      playerId: p.playerId,
      nickname: p.nickname,
      isWinner: p.playerId === winner,
    });
  }
  db.flush();
}
