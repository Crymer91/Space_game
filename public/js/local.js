// Одиночный режим: мир живёт прямо в браузере, без сервера.
import { createWorld, stepWorld, snapshotOf, buyUpgrade } from '/shared/world.js';

export function startLocalGame({ renderer, input, nickname, onOver, onBuyResult }) {
  const world = createWorld({
    playerIds: ['you'],
    nicknames: { you: nickname || 'Пилот' },
    durationMs: null, // бесконечно, пока живы
    seed: (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0,
  });

  let raf = null;
  let last = null;
  let acc = 0;
  const STEP = 1 / 60;
  let finished = false;

  function frame(ts) {
    raf = requestAnimationFrame(frame);
    if (last == null) last = ts;
    acc += Math.min((ts - last) / 1000, 0.25);
    last = ts;

    const buyTrack = input.consumeBuyKey();
    if (buyTrack) {
      const res = buyUpgrade(world, 'you', buyTrack);
      if (onBuyResult) onBuyResult(res);
    }

    // лазер/мины — по одному срабатыванию на нажатие
    let pendingLaser=false, pendingMine=false;
    if (input.wantsLaser()) { pendingLaser = input.consumeLaser(); }
    if (input.wantsMine()) { pendingMine = input.consumeMine(); }
    while (acc >= STEP && !finished) {
      acc -= STEP;
      const me = world.players[0];
      const move = input.getMove();
      stepWorld(world, STEP, {
        you: {
          mx: move.mx,
          my: move.my,
          aim: me.alive ? input.getAim(me.x, me.y) : undefined,
          shoot: me.alive ? input.isShooting() : false,
          mis: me.alive ? input.wantsMissile() : false,
          laser: me.alive ? pendingLaser : false,
          mine: me.alive ? pendingMine : false,
        },
      });
      pendingLaser=false; pendingMine=false;
      if (world.status === 'over') {
        finished = true;
        break;
      }
    }

    const snap = snapshotOf(world);
    renderer.setState(snap);
    renderer.updateHud(snap, 'you', { solo: true });
    if (finished) {
      stop();
      const p = world.players[0];
      onOver({
        reason: 'all-dead',
        players: [{
          playerId: 'you',
          nickname: p.nick,
          score: p.score,
          kills: p.kills,
          deaths: p.deaths,
          coinsEarned: p.coins,
          timeMs: Math.round(world.t),
        }],
      });
      return;
    }
  }

  raf = requestAnimationFrame(frame);

  function stop() {
    if (raf) cancelAnimationFrame(raf);
    raf = null;
  }

  return {
    buy: (track) => {
      if (!finished) return buyUpgrade(world, 'you', track);
      return { error: 'match-over' };
    },
    stop,
  };
}
