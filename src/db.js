import { mkdirSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

export function createDb(dbPath) {
  mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS players (
      id TEXT PRIMARY KEY,
      nickname TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS matches (
      id TEXT PRIMARY KEY,
      room_code TEXT NOT NULL,
      capacity INTEGER NOT NULL,
      players TEXT NOT NULL,
      winner TEXT,
      created_at INTEGER NOT NULL,
      ended_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS match_players (
      match_id TEXT NOT NULL,
      player_id TEXT NOT NULL,
      nickname TEXT NOT NULL,
      is_winner INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (match_id, player_id)
    );
  `);

  // лёгкая миграция: колонка личного рекорда
  const cols = db.prepare('PRAGMA table_info(players)').all().map((c) => c.name);
  if (!cols.includes('best_score')) {
    db.exec('ALTER TABLE players ADD COLUMN best_score INTEGER NOT NULL DEFAULT 0');
  }
  return db;
}

export function upsertPlayer(db, playerId, nickname) {
  db.prepare(`
    INSERT INTO players (id, nickname, created_at, last_seen_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      nickname = excluded.nickname,
      last_seen_at = excluded.last_seen_at
  `).run(playerId, nickname, Date.now(), Date.now());
}

export function getPlayer(db, playerId) {
  return db.prepare('SELECT * FROM players WHERE id = ?').get(playerId) ?? null;
}

export function getPlayerStats(db, playerId) {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS played, COALESCE(SUM(is_winner), 0) AS wins
       FROM match_players WHERE player_id = ?`
    )
    .get(playerId);
  const player = db.prepare('SELECT best_score FROM players WHERE id = ?').get(playerId);
  return { played: row.played, wins: row.wins, bestScore: player?.best_score ?? 0 };
}

// Сохраняет рекорд одиночной игры (если побит) и возвращает обновлённую статистику
export function submitScore(db, playerId, score) {
  db.prepare(`
    UPDATE players
    SET best_score = MAX(best_score, ?), last_seen_at = ?
    WHERE id = ?
  `).run(score, Date.now(), playerId);
  return getPlayerStats(db, playerId);
}

export function saveMatch(db, { id, roomCode, capacity, players, winner, createdAt, endedAt }) {
  const insertMatch = db.prepare(`
    INSERT INTO matches (id, room_code, capacity, players, winner, created_at, ended_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const insertPlayer = db.prepare(`
    INSERT INTO match_players (match_id, player_id, nickname, is_winner)
    VALUES (?, ?, ?, ?)
  `);
  const tx = db.transaction(() => {
    insertMatch.run(id, roomCode, capacity, JSON.stringify(players), winner, createdAt, endedAt);
    for (const p of players) {
      insertPlayer.run(id, p.playerId, p.nickname, p.playerId === winner ? 1 : 0);
    }
  });
  tx();
}