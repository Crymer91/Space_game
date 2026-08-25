import { EventEmitter } from 'node:events';
import { generateRoomCode, randomId } from './utils.js';
import { saveMatch } from './db.js';

export const ROOM_STATUS = {
  WAITING: 'waiting',
  PLAYING: 'playing',
  CLOSED: 'closed',
};

class Room {
  constructor({ id, code, capacity, fillTimeoutMs, idleCloseMs }) {
    this.id = id;
    this.code = code;
    this.capacity = capacity;
    this.status = ROOM_STATUS.WAITING;
    this.players = new Map(); // socketId -> { socketId, playerId, nickname }
    this.createdAt = Date.now();
    this.startedAt = null;
    this.endedAt = null;
    this.winner = null;
    this.fillTimer = null;
    this.idleTimer = null;
    this.fillTimeoutMs = fillTimeoutMs;
    this.idleCloseMs = idleCloseMs;
  }

  get size() {
    return this.players.size;
  }

  get isFull() {
    return this.players.size >= this.capacity;
  }

  snapshot() {
    return {
      roomId: this.id,
      code: this.code,
      capacity: this.capacity,
      status: this.status,
      players: [...this.players.values()],
    };
  }
}

export class RoomManager {
  constructor({ io, db, config, logger }) {
    this.io = io;
    this.db = db;
    this.config = config;
    this.logger = logger;
    this.rooms = new Map(); // roomId -> Room
    this.byCode = new Map(); // code -> Room
    this.events = new EventEmitter(); // room-created | room-updated | room-started | room-closed
  }

  _uniqueCode() {
    let code = generateRoomCode(this.config.roomCodeLength);
    while (this.byCode.has(code)) {
      code = generateRoomCode(this.config.roomCodeLength);
    }
    return code;
  }

  _clearTimer(timer) {
    if (timer) clearTimeout(timer);
  }

  _armFillTimer(room) {
    room.fillTimer = setTimeout(() => {
      if (room.status === ROOM_STATUS.WAITING && !room.isFull) {
        this.closeRoom(room, 'fill-timeout');
      }
    }, room.fillTimeoutMs);
  }

  _armIdleTimer(room) {
    this._clearTimer(room.idleTimer);
    room.idleTimer = setTimeout(() => {
      if (room.status === ROOM_STATUS.WAITING && room.players.size < room.capacity) {
        this.closeRoom(room, 'idle-timeout');
      }
    }, room.idleCloseMs);
  }

  createRoom({ capacity, players, autoStart = false }) {
    const room = new Room({
      id: randomId('room'),
      code: this._uniqueCode(),
      capacity,
      fillTimeoutMs: this.config.fillTimeoutMs,
      idleCloseMs: this.config.idleCloseMs,
    });
    this.rooms.set(room.id, room);
    this.byCode.set(room.code, room);
    for (const { socket, player } of players) {
      this._joinRoom(room, socket, player);
    }
    if (autoStart) {
      this.startRoom(room);
    } else {
      this._armFillTimer(room);
    }
    this.events.emit('room-created');
    this.logger.info(`Room ${room.code} created capacity=${capacity} autoStart=${autoStart}`);
    return room;
  }

  _joinRoom(room, socket, player) {
    room.players.set(socket.id, {
      socketId: socket.id,
      playerId: player.playerId,
      nickname: player.nickname,
    });
    socket.data.roomId = room.id;
    socket.join(room.id);
    this._clearTimer(room.idleTimer);
    room.idleTimer = null;
    this.io.to(room.id).emit('room:update', room.snapshot());
    this.events.emit('room-updated');
  }

  joinByCode(code, socket, player) {
    const room = this.byCode.get(String(code).toUpperCase());
    if (!room) return { error: 'room-not-found' };
    if (room.status !== ROOM_STATUS.WAITING) return { error: 'room-unavailable' };
    if (room.isFull) return { error: 'room-full' };
    if ([...room.players.values()].some((p) => p.playerId === player.playerId)) {
      return { error: 'already-in-room' };
    }
    this._joinRoom(room, socket, player);
    if (room.isFull) this.startRoom(room);
    return { room };
  }

  startRoom(room) {
    if (room.status !== ROOM_STATUS.WAITING) return;
    room.status = ROOM_STATUS.PLAYING;
    room.startedAt = Date.now();
    this._clearTimer(room.fillTimer);
    room.fillTimer = null;
    this.io.to(room.id).emit('game:start', room.snapshot());
    this.events.emit('room-started', room);
    this.logger.info(`Room ${room.code} started`);
  }

  leaveRoom(socket, reason = 'left') {
    const room = this.rooms.get(socket.data.roomId);
    if (!room || room.status === ROOM_STATUS.CLOSED) return;
    const player = room.players.get(socket.id);
    room.players.delete(socket.id);
    socket.leave(room.id);
    socket.data.roomId = null;

    if (room.status === ROOM_STATUS.PLAYING) {
      // сессия идёт: уход любого игрока прерывает её
      this.closeRoom(room, 'player-left');
      return;
    }

    // комната ещё наполняется
    if (room.players.size === 0) {
      this.closeRoom(room, 'empty');
      return;
    }
    this.io.to(room.id).emit('room:update', room.snapshot());
    this.io.to(room.id).emit('room:player-left', {
      playerId: player?.playerId ?? null,
      reason,
    });
    this.events.emit('room-updated');
    this._armIdleTimer(room);
  }

  endGame(room, winnerPlayerId) {
    if (room.status !== ROOM_STATUS.PLAYING) return { error: 'room-not-playing' };
    const winner = winnerPlayerId
      ? [...room.players.values()].find((p) => p.playerId === winnerPlayerId)
      : null;
    if (winnerPlayerId && !winner) return { error: 'invalid-winner' };
    room.winner = winner ? winner.playerId : null;
    this.closeRoom(room, 'ended');
    return { ok: true };
  }

  closeRoom(room, reason) {
    if (room.status === ROOM_STATUS.CLOSED) return;
    room.status = ROOM_STATUS.CLOSED;
    room.endedAt = Date.now();
    this._clearTimer(room.fillTimer);
    room.fillTimer = null;
    this._clearTimer(room.idleTimer);
    room.idleTimer = null;

    if (room.startedAt) {
      saveMatch(this.db, {
        id: randomId('match'),
        roomCode: room.code,
        capacity: room.capacity,
        players: [...room.players.values()],
        winner: room.winner,
        createdAt: room.createdAt,
        endedAt: room.endedAt,
      });
    }

    this.io.to(room.id).emit('room:closed', {
      roomId: room.id,
      code: room.code,
      reason,
      winner: room.winner,
    });
    for (const p of room.players.values()) {
      const s = this.io.sockets.sockets.get(p.socketId);
      if (s) s.data.roomId = null;
    }
    this.io.socketsLeave(room.id);
    this.rooms.delete(room.id);
    this.byCode.delete(room.code);
    this.events.emit('room-closed', room);
    this.logger.info(`Room ${room.code} closed reason=${reason}`);
  }

  shutdown() {
    for (const room of [...this.rooms.values()]) {
      this.closeRoom(room, 'server-shutdown');
    }
  }
}