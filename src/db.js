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
    db.data.players[playerId] = { nickname, createdAt: now, lastSeenAt: now, bestScore: 0 };
  } else {
    p.nickname = nickname;
    p.lastSeenAt = now;
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
  return { played, wins, bestScore: db.data.players[playerId]?.bestScore ?? 0 };
}

// Сохраняет рекорд одиночной игры (если побит) и возвращает обновлённую статистику
export function submitScore(db, playerId, score) {
  const p = db.data.players[playerId];
  if (p) {
    p.bestScore = Math.max(p.bestScore || 0, score);
    p.lastSeenAt = Date.now();
    db.flush();
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
