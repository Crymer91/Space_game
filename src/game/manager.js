// Реестр игровых сессий: одна комната (playing) = один GameSession.
import { GameSession } from './session.js';

export class GameManager {
  constructor({ io, config, logger }) {
    this.io = io;
    this.config = config;
    this.logger = logger;
    this.sessions = new Map(); // roomId -> GameSession
  }

  attach(room, roomManager) {
    if (room.status !== 'playing') return;
    if (this.sessions.has(room.id)) return;
    const session = new GameSession({
      room,
      io: this.io,
      config: this.config,
      logger: this.logger,
    });
    // естественное завершение матча: рассылаем результаты и закрываем комнату
    session.onOver = (results) => {
      this.io.to(room.id).emit('game:over', results);
      roomManager.endGame(room, results.winner);
    };
    this.sessions.set(room.id, session);
  }

  get(roomId) {
    return this.sessions.get(roomId) ?? null;
  }

  destroy(roomId) {
    const session = this.sessions.get(roomId);
    if (!session) return;
    session.destroy();
    this.sessions.delete(roomId);
    this.logger.info(`Game session destroyed room=${session.code}`);
  }

  shutdown() {
    for (const session of this.sessions.values()) session.destroy();
    this.sessions.clear();
  }
}
