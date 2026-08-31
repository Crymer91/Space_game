import { getPlayerStats, submitScore, upsertPlayer } from './db.js';

const MIN_PLAYER_ID_LENGTH = 3;
const MAX_PLAYER_ID_LENGTH = 64;
const MAX_NICKNAME_LENGTH = 32;

export function registerHandlers(io, { db, config, roomManager, matchmaking, gameManager, logger }) {
  io.on('connection', (socket) => {
    socket.data.player = null;
    socket.data.roomId = null;

    const fail = (ack, code, message) => {
      if (typeof ack === 'function') ack({ error: code, message });
      else socket.emit('error', { code, message });
    };

    const requireAuth = (handler) => (payload, ack) => {
      if (!socket.data.player) return fail(ack, 'not-authorized', 'Call auth first');
      handler(payload, ack);
    };

    socket.on('auth', (payload = {}, ack) => {
      if (socket.data.player) {
        return fail(ack, 'already-authed', 'Socket is already authenticated');
      }
      const playerId =
        typeof payload.playerId === 'string' ? payload.playerId.trim() : '';
      let nickname =
        typeof payload.nickname === 'string' ? payload.nickname.trim() : '';
      if (
        !playerId ||
        playerId.length < MIN_PLAYER_ID_LENGTH ||
        playerId.length > MAX_PLAYER_ID_LENGTH
      ) {
        return fail(ack, 'invalid-player-id', 'playerId must be 3-64 characters');
      }
      if (!nickname) nickname = `Player ${playerId.slice(0, 6)}`;
      if (nickname.length > MAX_NICKNAME_LENGTH) {
        nickname = nickname.slice(0, MAX_NICKNAME_LENGTH);
      }

      upsertPlayer(db, playerId, nickname);
      socket.data.player = { playerId, nickname };
      const data = { player: socket.data.player, stats: getPlayerStats(db, playerId) };
      socket.emit('auth:ok', data);
      if (typeof ack === 'function') ack({ ok: true, data });
      logger.info(`auth ${playerId} (${nickname})`);
    });

    socket.on('matchmaking:find', requireAuth((payload = {}, ack) => {
      const res = matchmaking.findMatch(socket, { capacity: payload.capacity });
      if (res.error) return fail(ack, res.error, `Cannot join queue: ${res.error}`);
      if (typeof ack === 'function') ack({ ok: true });
    }));

    socket.on('matchmaking:cancel', requireAuth((payload, ack) => {
      matchmaking.cancelFind(socket.id);
      if (typeof ack === 'function') ack({ ok: true });
    }));

    socket.on('room:create', requireAuth((payload = {}, ack) => {
      if (socket.data.roomId) return fail(ack, 'already-in-room', 'You are already in a room');
      const capacity = payload.capacity ?? config.defaultCapacity;
      if (
        !Number.isInteger(capacity) ||
        capacity < config.minCapacity ||
        capacity > config.maxCapacity
      ) {
        return fail(
          ack,
          'invalid-capacity',
          `Capacity must be ${config.minCapacity}-${config.maxCapacity}`
        );
      }
      const room = roomManager.createRoom({
        capacity,
        players: [{ socket, player: socket.data.player }],
        autoStart: false,
      });
      const data = { roomId: room.id, code: room.code, capacity };
      socket.emit('room:created', data);
      if (typeof ack === 'function') ack({ ok: true, data });
    }));

    socket.on('room:join', requireAuth((payload = {}, ack) => {
      const code =
        typeof payload.code === 'string' ? payload.code.trim().toUpperCase() : '';
      if (!code) return fail(ack, 'invalid-code', 'Missing room code');
      if (socket.data.roomId) return fail(ack, 'already-in-room', 'You are already in a room');
      const res = roomManager.joinByCode(code, socket, socket.data.player);
      if (res.error) return fail(ack, res.error, `Cannot join: ${res.error}`);
      if (typeof ack === 'function') {
        ack({ ok: true, data: { roomId: res.room.id, code: res.room.code } });
      }
    }));

    socket.on('room:leave', requireAuth((payload, ack) => {
      roomManager.leaveRoom(socket, 'left');
      if (typeof ack === 'function') ack({ ok: true });
    }));

    socket.on('room:message', requireAuth((payload = {}, ack) => {
      const room = roomManager.rooms.get(socket.data.roomId);
      if (!room) return fail(ack, 'not-in-room', 'You are not in a room');
      const text = typeof payload.text === 'string' ? payload.text.trim() : '';
      if (!text || text.length > config.maxMessageLength) {
        return fail(ack, 'invalid-message', 'Message is empty or too long');
      }
      io.to(room.id).emit('room:message', {
        roomId: room.id,
        from: socket.data.player.playerId,
        nickname: socket.data.player.nickname,
        text,
        at: Date.now(),
      });
      if (typeof ack === 'function') ack({ ok: true });
    }));

    socket.on('game:echo', requireAuth((payload = {}, ack) => {
      const room = roomManager.rooms.get(socket.data.roomId);
      if (!room) return fail(ack, 'not-in-room', 'You are not in a room');
      io.to(room.id).emit('game:echo', {
        roomId: room.id,
        from: socket.data.player.playerId,
        payload: payload.payload,
        at: Date.now(),
      });
      if (typeof ack === 'function') ack({ ok: true });
    }));

    socket.on('game:end', requireAuth((payload = {}, ack) => {
      const room = roomManager.rooms.get(socket.data.roomId);
      if (!room) return fail(ack, 'not-in-room', 'You are not in a room');
      const res = roomManager.endGame(room, payload?.winner);
      if (res.error) return fail(ack, res.error, `Cannot end game: ${res.error}`);
      if (typeof ack === 'function') ack({ ok: true });
    }));

    // ввод игрока в мультиплеере: без ack (высокая частота), сервер применяет последний инпут
    socket.on('game:input', requireAuth((payload = {}) => {
      const session = gameManager?.get(socket.data.roomId);
      if (session) session.onInput(socket.data.player.playerId, payload);
    }));

    // покупка апгрейда бластера
    socket.on('game:buy', requireAuth((payload = {}, ack) => {
      const session = gameManager?.get(socket.data.roomId);
      if (!session) return fail(ack, 'no-session', 'No active game in this room');
      const res = session.buy(socket.data.player.playerId, payload.track);
      if (res.error) return fail(ack, res.error, `Cannot buy: ${res.error}`);
      if (typeof ack === 'function') ack({ ok: true, data: res });
    }));

    // рекорд одиночной игры (без комнаты)
    socket.on('solo:submit', requireAuth((payload = {}, ack) => {
      const score = Number(payload.score);
      if (!Number.isFinite(score) || score < 0 || score > 1e7) {
        return fail(ack, 'invalid-score', 'score must be a number 0..10 000 000');
      }
      const stats = submitScore(db, socket.data.player.playerId, Math.floor(score));
      if (typeof ack === 'function') ack({ ok: true, data: stats });
    }));

    socket.on('disconnect', () => {
      matchmaking.onDisconnect(socket.id);
      if (socket.data.roomId) roomManager.leaveRoom(socket, 'disconnect');
    });
  });
}