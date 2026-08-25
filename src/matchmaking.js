export class MatchmakingQueue {
  constructor({ io, roomManager, config, logger }) {
    this.io = io;
    this.roomManager = roomManager;
    this.config = config;
    this.logger = logger;
    this.entries = new Map(); // socketId -> entry
  }

  findMatch(socket, { capacity } = {}) {
    if (socket.data.roomId) return { error: 'already-in-room' };
    const cap = capacity ?? this.config.defaultCapacity;
    if (!Number.isInteger(cap) || cap < this.config.minCapacity || cap > this.config.maxCapacity) {
      return { error: 'invalid-capacity' };
    }
    this._removeEntry(socket.id);

    const entry = {
      socketId: socket.id,
      playerId: socket.data.player.playerId,
      nickname: socket.data.player.nickname,
      capacity: cap,
      enqueuedAt: Date.now(),
    };
    entry.timer = setTimeout(() => this._timeoutEntry(entry), this.config.queueTimeoutMs);
    this.entries.set(socket.id, entry);
    this.io.to(socket.id).emit('matchmaking:queued', {
      capacity: cap,
      position: this._positionOf(entry),
    });
    this._tryFormRooms();
    return { ok: true };
  }

  cancelFind(socketId) {
    const removed = this._removeEntry(socketId);
    if (removed) this.io.to(socketId).emit('matchmaking:cancelled');
  }

  onDisconnect(socketId) {
    this._removeEntry(socketId);
  }

  shutdown() {
    for (const entry of this.entries.values()) {
      clearTimeout(entry.timer);
    }
    this.entries.clear();
  }

  _positionOf(entry) {
    let position = 0;
    for (const e of this.entries.values()) {
      if (e.capacity === entry.capacity && e.enqueuedAt <= entry.enqueuedAt) position++;
    }
    return position;
  }

  _removeEntry(socketId) {
    const entry = this.entries.get(socketId);
    if (!entry) return null;
    clearTimeout(entry.timer);
    this.entries.delete(socketId);
    return entry;
  }

  _timeoutEntry(entry) {
    if (this.entries.get(entry.socketId) !== entry) return;
    this.entries.delete(entry.socketId);
    this.io.to(entry.socketId).emit('matchmaking:timeout', { capacity: entry.capacity });
    this.logger.info(`Queue entry timed out for ${entry.playerId} capacity=${entry.capacity}`);
  }

  _tryFormRooms() {
    const groups = new Map(); // capacity -> [entries]
    for (const entry of this.entries.values()) {
      if (!groups.has(entry.capacity)) groups.set(entry.capacity, []);
      groups.get(entry.capacity).push(entry);
    }
    for (const [capacity, list] of groups) {
      while (list.length >= capacity) {
        this._formRoom(list.splice(0, capacity));
      }
    }
  }

  _formRoom(group) {
    const players = [];
    for (const entry of group) {
      const socket = this.io.sockets.sockets.get(entry.socketId);
      if (!socket) continue;
      players.push({ socket, player: { playerId: entry.playerId, nickname: entry.nickname } });
    }
    // часть клиентов отвалилась — не создаём неполную комнату, они остаются в очереди
    if (players.length !== group.length) return;

    for (const entry of group) this._removeEntry(entry.socketId);
    const room = this.roomManager.createRoom({
      capacity: group[0].capacity,
      players,
      autoStart: true,
    });
    for (const p of players) {
      this.io.to(p.socket.id).emit('match:found', {
        roomId: room.id,
        code: room.code,
        capacity: room.capacity,
      });
    }
    this.logger.info(`Match formed: room ${room.code} players=${players.length}`);
  }
}