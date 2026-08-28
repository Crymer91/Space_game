// Точка входа клиента: экраны, меню, звук, запуск режимов (соло/мультиплеер).
import { net, connect, api, getIdentity, saveNickname, isConnected } from './net.js';
import { createInput } from './input.js';
import { createRenderer } from './render.js';
import { startLocalGame } from './local.js';
import { startMultiGame } from './multi.js';

const $ = (id) => document.getElementById(id);
const els = {
  menuScreen: $('menuScreen'),
  gameScreen: $('gameScreen'),
  waitOverlay: $('waitOverlay'),
  waitTitle: $('waitTitle'),
  waitInfo: $('waitInfo'),
  waitCode: $('waitCode'),
  waitCancelBtn: $('waitCancelBtn'),
  overOverlay: $('overOverlay'),
  overTitle: $('overTitle'),
  overReason: $('overReason'),
  overRows: $('overRows'),
  overRecord: $('overRecord'),
  againBtn: $('againBtn'),
  toMenuBtn: $('toMenuBtn'),
  gameHint: $('gameHint'),
  announce: $('announce'),
  nickInput: $('nickInput'),
  connState: $('connState'),
  soloBtn: $('soloBtn'),
  findBtn: $('findBtn'),
  createBtn: $('createBtn'),
  joinCodeInput: $('joinCodeInput'),
  joinBtn: $('joinBtn'),
  menuError: $('menuError'),
  recordLine: $('recordLine'),
};

const canvas = $('gameCanvas');
const renderer = createRenderer(canvas);
const input = createInput(canvas, () => renderer.getView());

let current = null; // { mode: 'solo'|'multi', controller }
let selfId = null;
let overShown = false;
let lastMode = null;

// ===================== ЗВУК (WebAudio, без файлов) =====================
let audioCtx = null;
let soundsThisWindow = 0;

function ensureAudio() {
  if (!audioCtx) {
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
    catch { return null; }
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

function tone({ type = 'sine', from = 440, to = from, dur = 0.1, vol = 0.1 }) {
  const ctx = ensureAudio();
  if (!ctx) return;
  const t0 = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(from, t0);
  osc.frequency.exponentialRampToValueAtTime(Math.max(to, 1), t0 + dur);
  gain.gain.setValueAtTime(vol, t0);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function noiseBurst({ dur = 0.35, vol = 0.25, cutoff = 900 }) {
  const ctx = ensureAudio();
  if (!ctx) return;
  const t0 = ctx.currentTime;
  const len = Math.floor(ctx.sampleRate * dur);
  const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = cutoff;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(vol, t0);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(filter).connect(gain).connect(ctx.destination);
  src.start(t0);
}

renderer.onFx((f, state) => {
  // глобальные оповещения об угрозах — без приглушения по расстоянию
  if (f.tp === 'warning') {
    if (f.z >= 3) showAnnounce(f.z===3?'☠ БОСС ДРЕДНОУТ!':f.z===4?'☠ БОСС ФАНТОМ!':'☠ БОСС ЛЕВИАФАН!');
    else showAnnounce(f.z === 2 ? '⚠ ВРАЖЕСКИЕ КОРАБЛИ!' : '⚠ СКОРОСТНЫЕ КОМЕТЫ!');
    tone({ type: 'sawtooth', from: 620, to: 330, dur: 0.42, vol: 0.12 });
    setTimeout(() => tone({ type: 'sawtooth', from: 620, to: 330, dur: 0.42, vol: 0.12 }), 500);
    return;
  }
  // приглушение по расстоянию до своего корабля + защита от звукового шторма
  if (soundsThisWindow > 10) return;
  let vol = 1;
  if (state) {
    const me = state.ps.find((p) => p.i === selfId);
    if (me) {
      const d = Math.hypot(f.x - me.x, f.y - me.y);
      vol = Math.max(0, 1 - d / 1300);
      if (vol <= 0.02) return;
    }
  }
  soundsThisWindow++;
  setTimeout(() => { soundsThisWindow--; }, 120);

  switch (f.tp) {
    case 'shoot': tone({ type: 'square', from: 760, to: 190, dur: 0.06, vol: 0.05 * vol }); break;
    case 'hit': tone({ type: 'triangle', from: 220, to: 160, dur: 0.04, vol: 0.07 * vol }); break;
    case 'boom': noiseBurst({ dur: 0.3 + f.z * 0.08, vol: 0.16 * Math.min(f.z, 2.5) * vol, cutoff: 500 + 300 / f.z }); break;
    case 'coin': tone({ type: 'sine', from: 880, to: 1420, dur: 0.09, vol: 0.09 * vol }); break;
    case 'spawn': tone({ type: 'sine', from: 280, to: 940, dur: 0.22, vol: 0.08 * vol }); break;
    case 'upgrade': tone({ type: 'sine', from: 620, to: 620, dur: 0.09, vol: 0.09 * vol }); tone({ type: 'sine', from: 930, to: 930, dur: 0.12, vol: 0.08 * vol }); break;
    case 'shield': tone({ type: 'sine', from: 400, to: 800, dur: 0.18, vol: 0.09 * vol }); break;
    case 'laser': noiseBurst({ dur: 0.35, vol: 0.12*vol, cutoff: 2200 }); break;
    case 'mine': tone({ type: 'triangle', from: 180, to: 90, dur: 0.15, vol: 0.08*vol }); break;
  }
});
document.addEventListener('pointerdown', ensureAudio, { once: true });

// ===================== ЭКРАНЫ =====================
function showMenu() {
  stopGame();
  els.gameScreen.classList.add('hidden');
  els.overOverlay.classList.add('hidden');
  els.waitOverlay.classList.add('hidden');
  els.menuScreen.classList.remove('hidden');
  input.setActive(false);
}

function showGame() {
  els.menuScreen.classList.add('hidden');
  els.waitOverlay.classList.add('hidden');
  els.overOverlay.classList.add('hidden');
  els.gameScreen.classList.remove('hidden');
  input.setActive(true);
}

function showWait(title, info, code = null) {
  els.waitTitle.textContent = title;
  els.waitInfo.textContent = info;
  if (code) {
    els.waitCode.textContent = code;
    els.waitCode.classList.remove('hidden');
  } else {
    els.waitCode.classList.add('hidden');
  }
  els.waitOverlay.classList.remove('hidden');
}

function hideWait() {
  els.waitOverlay.classList.add('hidden');
}

function fmtTime(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  return Math.floor(total / 60) + ':' + String(total % 60).padStart(2, '0');
}

function showOver(results, mode) {
  overShown = true;
  input.setActive(false);
  const players = [...(results.players || [])].sort((a, b) => b.score - a.score);
  els.overTitle.textContent =
    results.reason === 'time-up' ? 'Время вышло!' :
    results.winner ? 'Есть победитель!' : 'Ничья!';
  els.overReason.textContent =
    results.reason === 'time-up' ? 'Матч завершён по таймеру' : 'Все корабли уничтожены';

  els.overRows.innerHTML = players.map((p) => `
    <tr class="${p.playerId === results.winner ? 'winner' : ''}">
      <td>${escapeHtml(p.nickname)}</td>
      <td>${p.score}</td>
      <td>${p.kills}</td>
      <td>${p.coinsEarned}</td>
    </tr>`).join('');

  if (mode === 'solo' && players[0]) {
    els.overRecord.textContent = `Ваш результат: ${players[0].score} очков · время полёта ${fmtTime(players[0].timeMs ?? 0)}`;
  } else {
    els.overRecord.textContent = '';
  }
  els.overOverlay.classList.remove('hidden');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

function toast(msg, isError = false) {
  els.menuError.textContent = msg;
  els.menuError.style.color = isError ? 'var(--err)' : 'var(--ok)';
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { els.menuError.textContent = ''; }, 4000);
}

// ===================== РЕЖИМЫ =====================
function stopGame() {
  if (current?.controller?.stop) current.controller.stop();
  current = null;
  overShown = false;
}

// ===================== ПОКУПКА АПГРЕЙДОВ =====================
const BUY_ERRORS = {
  'not-enough-coins': 'Не хватает монет',
  'max-level': 'Максимальный уровень',
  'match-over': 'Матч окончен',
  'not-found': 'Корабль уничтожен — покупка недоступна',
};

let hintTimer = null;
function showGameHint(text) {
  els.gameHint.textContent = text;
  els.gameHint.classList.remove('hidden');
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => els.gameHint.classList.add('hidden'), 1600);
}

let announceTimer = null;
function showAnnounce(text) {
  els.announce.textContent = text;
  els.announce.classList.remove('hidden');
  clearTimeout(announceTimer);
  announceTimer = setTimeout(() => els.announce.classList.add('hidden'), 2600);
}

function onBuyResult(res) {
  if (res && res.error) showGameHint(BUY_ERRORS[res.error] || res.message || 'Не удалось купить');
}

async function tryBuy(track) {
  if (!current?.controller?.buy) return;
  const res = await current.controller.buy(track);
  onBuyResult(res);
}

function startSolo() {
  stopGame();
  lastMode = 'solo';
  selfId = 'you';
  showGame();
  renderer.resetFx();
  current = {
    mode: 'solo',
    controller: startLocalGame({
      renderer,
      input,
      nickname: els.nickInput.value.trim(),
      onBuyResult,
      onOver: async (results) => {
        if (isConnected()) {
          const res = await api.submitSoloScore(results.players[0]?.score || 0);
          if (res.ok) updateRecordLine(res.data);
        }
        showOver(results, 'solo');
      },
    }),
  };
}

async function findMatch() {
  if (!requireOnline()) return;
  saveNick();
  showWait('Поиск соперника…', 'Ищем свободного пилота в очереди');
  const res = await api.findMatch(2);
  if (res.error) {
    hideWait();
    toast(res.message || 'Не удалось встать в очередь', true);
  }
}

async function createRoom() {
  if (!requireOnline()) return;
  saveNick();
  const res = await api.createRoom(2);
  if (res.error) {
    toast(res.message || 'Не удалось создать комнату', true);
    return;
  }
  showWait('Комната создана', 'Отправьте код сопернику — игра начнётся автоматически', res.data.code);
}

async function joinRoom() {
  if (!requireOnline()) return;
  saveNick();
  const code = els.joinCodeInput.value.trim().toUpperCase();
  if (!code) return;
  const res = await api.joinRoom(code);
  if (res.error) {
    toast({ 'room-not-found': 'Комната не найдена', 'room-full': 'Комната заполнена', 'room-unavailable': 'Комната недоступна' }[res.error] || res.message || 'Ошибка входа', true);
    return;
  }
  showWait('Вход в комнату ' + code, 'Ожидаем старта…');
}

function startMulti() {
  stopGame();
  lastMode = 'multi';
  selfId = getPlayerIdSafe();
  showGame();
  renderer.resetFx();
  current = {
    mode: 'multi',
    controller: startMultiGame({
      net,
      renderer,
      input,
      selfId,
      onBuyResult,
      onOver: () => {},
    }),
  };
}

function requireOnline() {
  if (!isConnected()) {
    toast('Нет соединения с сервером', true);
    return false;
  }
  return true;
}

function saveNick() {
  const nick = els.nickInput.value.trim();
  if (nick) saveNickname(nick);
}

function getPlayerIdSafe() {
  return getIdentity().playerId;
}

// ===================== СОБЫТИЯ СЕТИ =====================
net.on('net:connected', () => {
  els.connState.className = 'conn-state online';
  els.connState.innerHTML = '<span class="dot"></span>онлайн';
});

net.on('net:disconnected', () => {
  els.connState.className = 'conn-state offline';
  els.connState.innerHTML = '<span class="dot"></span>нет связи';
  if (current?.mode === 'multi' && !overShown) {
    toast('Соединение потеряно', true);
    showMenu();
  }
});

net.on('auth:ok', (data) => {
  if (data?.stats) updateRecordLine(data.stats);
});

net.on('matchmaking:queued', (d) => {
  els.waitInfo.textContent = `Вы в очереди · позиция ${d.position}`;
});

net.on('matchmaking:timeout', () => {
  if (els.waitOverlay.classList.contains('hidden')) return;
  hideWait();
  toast('Соперник не нашёлся — попробуйте ещё раз', true);
});

net.on('match:found', () => {
  els.waitInfo.textContent = 'Соперник найден! Запуск…';
});

net.on('game:start', () => {
  hideWait();
  startMulti();
});

net.on('room:update', (snap) => {
  if (!els.waitCode.classList.contains('hidden')) {
    els.waitInfo.textContent = `Игроков в комнате: ${snap.players.length} из ${snap.capacity} — ждём второго`;
  }
});

net.on('room:closed', (d) => {
  hideWait();
  if (overShown) return; // штатное завершение матча уже показано
  if (current?.mode === 'multi') {
    const reasons = {
      'player-left': 'Соперник покинул матч',
      'server-shutdown': 'Сервер остановлен',
    };
    toast(reasons[d.reason] || 'Матч прерван (' + d.reason + ')', d.reason !== 'ended');
    showMenu();
  }
});

net.on('game:over', (results) => {
  showOver(results, current?.mode);
  // комната закроется сама (room:closed придёт следом и будет проглочен)
});

// ===================== КНОПКИ =====================
els.soloBtn.addEventListener('click', () => startSolo());
els.findBtn.addEventListener('click', () => findMatch());
els.createBtn.addEventListener('click', () => createRoom());
els.joinBtn.addEventListener('click', () => joinRoom());
els.joinCodeInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') joinRoom();
});
els.nickInput.addEventListener('change', saveNick);

els.waitCancelBtn.addEventListener('click', () => {
  hideWait();
  api.cancelFind();
  api.leaveRoom();
});

els.toMenuBtn.addEventListener('click', () => showMenu());

els.againBtn.addEventListener('click', () => {
  if (lastMode === 'multi') findMatch();
  else startSolo();
});

// апгрейды из HUD
for (const btn of document.querySelectorAll('.upg-btn')) {
  btn.addEventListener('click', () => tryBuy(btn.dataset.track));
}

// клавиши покупки обрабатываются в игровых циклах (local/multi через input.consumeBuyKey)

function updateRecordLine(stats) {
  if (!stats) return;
  const parts = [];
  if (stats.bestScore != null) parts.push(`рекорд ${stats.bestScore}`);
  if (stats.played != null) parts.push(`матчей ${stats.played}`);
  if (stats.wins != null) parts.push(`побед ${stats.wins}`);
  els.recordLine.textContent = parts.join(' · ');
}

// ===================== СТАРТ =====================
const identity = getIdentity();
els.nickInput.value = identity.nickname || '';
connect();
showMenu();
