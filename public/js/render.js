// Отрисовка: canvas-мир 1600x900 с letterbox-масштабированием + HUD на DOM.
import { BALANCE } from '/shared/balance.js';

const W = BALANCE.world.width;
const H = BALANCE.world.height;

const SLOT_COLORS = ['#5ad0ff', '#ffb458', '#7dff9e', '#ff8ad8'];
const FX_COLORS = {
  boom: ['#ffd75e', '#ff9d4d', '#ff6b4a'],
  hit: ['#ffffff', '#ffe9a8'],
  coin: ['#ffd75e', '#fff3c0'],
  shoot: ['#fff2b0'],
  spawn: ['#5ad0ff', '#bff1ff'],
  upgrade: ['#7dff9e', '#d2ffde'],
  powerup: ['#ff6ba8', '#5ad0ff', '#ffffff'],
};

function hashRand(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  let view = { scale: 1, ox: 0, oy: 0 };
  let dpr = 1;
  let cssW = 0;
  let cssH = 0;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    cssW = window.innerWidth;
    cssH = window.innerHeight;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    const scale = Math.min(cssW / W, cssH / H);
    view = {
      scale,
      ox: (cssW - W * scale) / 2,
      oy: (cssH - H * scale) / 2,
    };
  }
  window.addEventListener('resize', resize);
  resize();

  // звёздный фон
  const rng = hashRand(777);
  const stars = [];
  for (let i = 0; i < 170; i++) {
    stars.push({
      x: rng() * W,
      y: rng() * H,
      r: 0.4 + rng() * 1.4,
      ph: rng() * Math.PI * 2,
      sp: 0.4 + rng() * 1.6,
    });
  }

  // форма астероидов по seed (кэш)
  const shapes = new Map();
  function asteroidShape(a) {
    let pts = shapes.get(a.i);
    if (!pts) {
      const r = hashRand(a.sd);
      const n = 9 + Math.floor(r() * 4);
      pts = [];
      for (let k = 0; k < n; k++) {
        const ang = (k / n) * Math.PI * 2;
        const rad = 0.72 + r() * 0.42;
        pts.push([Math.cos(ang) * rad, Math.sin(ang) * rad]);
      }
      if (shapes.size > 600) shapes.clear();
      shapes.set(a.i, pts);
    }
    return pts;
  }

  // частицы и тряска
  const particles = [];
  const seenFx = new Set();
  let shake = 0;

  function spawnFxParticles(f) {
    if (seenFx.has(f.i)) return;
    seenFx.add(f.i);
    if (seenFx.size > 400) {
      // сбрасываем старые метки, оставляем последние ~200
      const arr = [...seenFx].slice(-200);
      seenFx.clear();
      arr.forEach((v) => seenFx.add(v));
    }
    const colors = FX_COLORS[f.tp] || ['#ffffff'];
    const count = f.tp === 'boom' ? 12 + f.z * 7 : f.tp === 'hit' ? 5 : f.tp === 'coin' ? 7 : 3;
    for (let i = 0; i < count; i++) {
      const ang = Math.random() * Math.PI * 2;
      const sp = f.tp === 'boom' ? 50 + Math.random() * 220 * f.z : 30 + Math.random() * 120;
      particles.push({
        x: f.x, y: f.y,
        vx: Math.cos(ang) * sp,
        vy: Math.sin(ang) * sp,
        life: f.tp === 'boom' ? 0.55 + Math.random() * 0.35 : 0.25 + Math.random() * 0.25,
        age: 0,
        r: f.tp === 'boom' ? 1.6 + Math.random() * 2.4 * Math.min(f.z, 2) : 1 + Math.random() * 1.6,
        color: colors[Math.floor(Math.random() * colors.length)],
      });
    }
    if (f.tp === 'boom') shake = Math.min(shake + 2.2 * f.z, 16);
    if (onFxSound) onFxSound(f, current);
  }

  let onFxSound = null;
  let lastTs = null;
  let current = null;

  function frame(ts) {
    const dt = lastTs == null ? 0.016 : Math.min((ts - lastTs) / 1000, 0.05);
    lastTs = ts;
    requestAnimationFrame(frame);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#05070c';
    ctx.fillRect(0, 0, cssW, cssH);
    if (!current) return;

    // фон вне арены
    ctx.fillStyle = '#080a12';
    ctx.fillRect(view.ox, view.oy, W * view.scale, H * view.scale);

    shake *= Math.exp(-7 * dt);
    const shx = (Math.random() - 0.5) * shake;
    const shy = (Math.random() - 0.5) * shake;
    ctx.setTransform(dpr * view.scale, 0, 0, dpr * view.scale, (view.ox + shx) * dpr, (view.oy + shy) * dpr);

    drawWorld(ctx, current, ts / 1000, dt);
  }

  function drawWorld(ctx, s, now, dt) {
    // границы арены
    ctx.strokeStyle = 'rgba(79,140,255,.22)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, W - 2, H - 2);

    // звёзды (мерцание)
    for (const st of stars) {
      const tw = 0.35 + 0.65 * Math.abs(Math.sin(now * st.sp + st.ph));
      ctx.globalAlpha = tw;
      ctx.fillStyle = '#cfe0ff';
      ctx.beginPath();
      ctx.arc(st.x, st.y, st.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // монеты
    for (const c of s.cs) {
      const pulse = 1 + 0.12 * Math.sin(now * 5 + c.i);
      ctx.fillStyle = '#ffd75e';
      ctx.strokeStyle = '#8a6a1d';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(c.x, c.y, 9 * pulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#fff3c0';
      ctx.beginPath();
      ctx.arc(c.x - 2.6, c.y - 2.6, 3.1 * pulse, 0, Math.PI * 2);
      ctx.fill();
    }

    // powerups
    const PU_COLORS = { rapidFire: '#ff6ba8', shield: '#5ad0ff' };
    const PU_GLOW = { rapidFire: 'rgba(255,107,168,.4)', shield: 'rgba(90,208,255,.4)' };
    for (const u of (s.pu || [])) {
      const color = PU_COLORS[u.tp] || '#ffffff';
      const glow = PU_GLOW[u.tp] || 'rgba(255,255,255,.3)';
      const pulse = 1 + 0.18 * Math.sin(now * 6 + u.i);
      const r = 12 * pulse;
      ctx.save();
      ctx.translate(u.x, u.y);
      ctx.rotate(now * 2 + u.i);
      ctx.shadowColor = glow;
      ctx.shadowBlur = 16;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(0, -r);
      ctx.lineTo(r * 0.6, 0);
      ctx.lineTo(0, r);
      ctx.lineTo(-r * 0.6, 0);
      ctx.closePath();
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.4;
      ctx.stroke();
      ctx.restore();
    }

    // астероиды и кометы
    const TYPE_FILL = { small: '#8f97ab', medium: '#767f96', large: '#5f687e', comet: '#cfe8ff' };
    for (const a of s.as) {
      const pts = asteroidShape(a);
      // хвост кометы — против направления скорости
      if (a.tp === 'comet') {
        let vx = a.vx;
        let vy = a.vy;
        if (!Number.isFinite(vx) || !Number.isFinite(vy)) {
          vx = Math.cos(a.ro || 0) * 300;
          vy = Math.sin(a.ro || 0) * 300;
        }
        const vl = Math.hypot(vx, vy) || 1;
        const ux = -vx / vl;
        const uy = -vy / vl;
        const len = 44 + a.r * 3;
        const grad = ctx.createLinearGradient(a.x, a.y, a.x + ux * len, a.y + uy * len);
        grad.addColorStop(0, 'rgba(160,215,255,.85)');
        grad.addColorStop(1, 'rgba(160,215,255,0)');
        ctx.strokeStyle = grad;
        ctx.lineWidth = a.r * 1.1;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(a.x + ux * len, a.y + uy * len);
        ctx.stroke();
      }
      ctx.save();
      ctx.translate(a.x, a.y);
      ctx.rotate(a.ro || 0);
      ctx.fillStyle = TYPE_FILL[a.tp] || '#8f97ab';
      ctx.strokeStyle = a.hp < a.mh ? '#ffb458' : (a.tp === 'comet' ? '#6db3ff' : '#39415a');
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let k = 0; k < pts.length; k++) {
        const px = pts[k][0] * a.r;
        const py = pts[k][1] * a.r;
        if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    // пули (вражеские — красные)
    ctx.lineCap = 'round';
    for (const b of s.bs) {
      ctx.strokeStyle = b.e ? '#ff6b73' : '#fff2b0';
      ctx.shadowColor = b.e ? '#ff5a66' : '#ffd75e';
      ctx.shadowBlur = 6;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x - Math.cos(b.a) * 11, b.y - Math.sin(b.a) * 11);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    // самонаводящиеся ракеты
    for (const k of (s.rk || [])) {
      // шлейф
      if (Math.random() < 0.75) {
        particles.push({
          x: k.x - Math.cos(k.a) * 10,
          y: k.y - Math.sin(k.a) * 10,
          vx: (Math.random() - 0.5) * 30 - Math.cos(k.a) * 40,
          vy: (Math.random() - 0.5) * 30 - Math.sin(k.a) * 40,
          life: 0.3,
          age: 0,
          r: 1.2 + Math.random() * 1.6,
          color: Math.random() < 0.5 ? '#ffb458' : '#ff8a5c',
        });
      }
      ctx.save();
      ctx.translate(k.x, k.y);
      ctx.rotate(k.a);
      // пламя
      const fl = 8 + Math.random() * 7;
      ctx.fillStyle = Math.random() < 0.5 ? '#ff9d4d' : '#ffd75e';
      ctx.beginPath();
      ctx.moveTo(-7, -2.6);
      ctx.lineTo(-7 - fl, 0);
      ctx.lineTo(-7, 2.6);
      ctx.closePath();
      ctx.fill();
      // корпус-дротик
      ctx.fillStyle = '#dfe6f2';
      ctx.strokeStyle = '#8fa2c0';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(10, 0);
      ctx.lineTo(-7, -4.4);
      ctx.lineTo(-4, 0);
      ctx.lineTo(-7, 4.4);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    // вражеские корабли
    for (const en of (s.es || [])) {
      ctx.save();
      ctx.translate(en.x, en.y);
      ctx.rotate(en.a);
      // пламя двигателя
      const fl = 8 + Math.random() * 8;
      ctx.fillStyle = Math.random() < 0.5 ? '#ff5a66' : '#ff9d4d';
      ctx.beginPath();
      ctx.moveTo(-11, -4);
      ctx.lineTo(-11 - fl, 0);
      ctx.lineTo(-11, 4);
      ctx.closePath();
      ctx.fill();
      // корпус
      ctx.fillStyle = '#1c1016';
      ctx.strokeStyle = '#ff5a66';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(20, 0);
      ctx.lineTo(-13, -12);
      ctx.lineTo(-5, 0);
      ctx.lineTo(-13, 12);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#ff8ad8';
      ctx.beginPath();
      ctx.arc(3, 0, 3.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      // полоска HP
      if (en.h < en.hm) {
        const bw = 30;
        ctx.fillStyle = 'rgba(0,0,0,.55)';
        ctx.fillRect(en.x - bw / 2, en.y - 26, bw, 4);
        ctx.fillStyle = '#ff5a66';
        ctx.fillRect(en.x - bw / 2, en.y - 26, bw * Math.max(0, en.h / en.hm), 4);
      }
    }

    // корабли
    for (const p of s.ps) {
      if (!p.al) continue;
      const color = SLOT_COLORS[(p.sl ?? 0) % SLOT_COLORS.length];
      const blink = p.iv > 0 && Math.sin(now * 22) < 0;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.globalAlpha = blink ? 0.28 : 1;
      ctx.rotate(p.a);

      if (p.th) { // пламя двигателя
        const fl = 10 + Math.random() * 9;
        ctx.fillStyle = Math.random() < 0.5 ? '#ff9d4d' : '#ffd75e';
        ctx.beginPath();
        ctx.moveTo(-13, -5);
        ctx.lineTo(-13 - fl, 0);
        ctx.lineTo(-13, 5);
        ctx.closePath();
        ctx.fill();
      }

      ctx.fillStyle = '#12161f';
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(19, 0);
      ctx.lineTo(-12, -11);
      ctx.lineTo(-6, 0);
      ctx.lineTo(-12, 11);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(2, 0, 3.4, 0, Math.PI * 2);
      ctx.fill();

      if (p.iv > 0 || p.sh > 0) { // щит неуязвимости
        const shieldActive = p.iv > 0 || p.sh > 0;
        ctx.globalAlpha = shieldActive ? (0.5 + 0.3 * Math.sin(now * 10)) : 0.35;
        ctx.strokeStyle = p.sh > 0 && p.iv <= 0 ? '#5ad0ff' : '#bff1ff';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(0, 0, 24, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }

    // частицы поверх
    for (let i = particles.length - 1; i >= 0; i--) {
      const pt = particles[i];
      pt.age += dt;
      if (pt.age >= pt.life) { particles.splice(i, 1); continue; }
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      pt.vx *= Math.exp(-2.2 * dt);
      pt.vy *= Math.exp(-2.2 * dt);
      ctx.globalAlpha = 1 - pt.age / pt.life;
      ctx.fillStyle = pt.color;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, pt.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  requestAnimationFrame(frame);

  // ===== HUD =====
  const hudEls = {
    left: document.getElementById('hudLeft'),
    right: document.getElementById('hudRight'),
    timer: document.getElementById('timerText'),
    timerSub: document.getElementById('timerSub'),
    boost: document.getElementById('boostIndicator'),
    upgBtns: [...document.querySelectorAll('.upg-btn')],
  };
  const hudCache = {};

  function fmtTime(ms) {
    const total = Math.max(0, Math.round(ms / 1000));
    return Math.floor(total / 60) + ':' + String(total % 60).padStart(2, '0');
  }

  function buildCard(el, p, color) {
    el.style.borderColor = color;
    const key = p.i + '|' + p.n + '|' + p.s + '|' + p.l + '|' + p.c + '|' + p.o + '|' + Math.ceil((p.rs || 0) / 1000);
    if (hudCache[el.id] !== key) {
      hudCache[el.id] = key;
      const lives = p.o ? '✕' : '♥'.repeat(p.l) + '<span style="opacity:.25">' + '♥'.repeat(Math.max(0, BALANCE.ship.lives - p.l)) + '</span>';
      el.innerHTML =
        `<div class="ph-nick" style="color:${color}">${escapeHtml(p.n)}</div>` +
        `<div class="ph-score">${p.s}</div>` +
        `<div class="ph-line"><span class="lives">${lives}</span>` +
        `<span class="coins-ico">● ${p.c}</span>` +
        (p.rs > 0 ? `<span style="color:#ffc24b">возрождение ${Math.ceil(p.rs / 1000)}…</span>` : '') +
        '</div>';
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[ch]));
  }

  function updateUpgrades(p) {
    for (const btn of hudEls.upgBtns) {
      const track = btn.dataset.track;
      const pipsEl = btn.querySelector('.pips');
      const costEl = btn.querySelector('.cost');
      let pips;
      let txt;
      let disabled;
      if (track === 'life') {
        const def = BALANCE.upgrades.life;
        const maxed = p.l >= def.maxLives;
        pips = `${p.l}/${def.maxLives}`;
        txt = maxed ? 'МАКС' : def.cost + ' мон.';
        disabled = maxed || p.c < def.cost;
      } else if (track === 'missiles') {
        const def = BALANCE.upgrades.missiles;
        const ammo = p.mk ?? 0;
        const maxed = ammo >= def.maxAmmo;
        pips = `×${ammo}`;
        txt = maxed ? 'МАКС' : def.cost + ' мон.';
        disabled = maxed || p.c < def.cost;
      } else {
        const def = BALANCE.upgrades[track];
        const lvl = track === 'damage' ? p.dl : p.rl;
        const max = def.costs.length;
        const cost = def.costs[lvl];
        pips = '●'.repeat(lvl) + '○'.repeat(max - lvl);
        txt = cost == null ? 'МАКС' : cost + ' мон.';
        disabled = cost == null || p.c < cost;
      }
      if (pipsEl.textContent !== pips) pipsEl.textContent = pips;
      if (costEl.textContent !== txt) costEl.textContent = txt;
      btn.disabled = disabled;
    }
  }

  return {
    getView: () => view,

    // вызывается каждый кадр из игрового цикла
    setState(s) {
      // новые эффекты → частицы/звук
      if (s.fx) for (const f of s.fx) spawnFxParticles(f);
      current = s;
    },

    resetFx() {
      particles.length = 0;
      seenFx.clear();
      shake = 0;
      for (const k of Object.keys(hudCache)) delete hudCache[k];
    },

    updateHud(s, selfId, opts = {}) {
      const ps = s.ps || [];
      const left = ps.find((p) => p.sl === 0) ?? ps[0] ?? null;
      const right = ps.find((p) => p.sl === 1) ?? (ps.length > 1 ? ps[ps.length - 1] : null);
      if (left) buildCard(hudEls.left, left, SLOT_COLORS[0]);
      else hudEls.left.innerHTML = '';
      if (right) buildCard(hudEls.right, right, SLOT_COLORS[1]);
      else hudEls.right.innerHTML = '';
      hudEls.left.classList.toggle('self', !!left && left.i === selfId);
      hudEls.right.classList.toggle('self', !!right && right.i === selfId);

      const me = left?.i === selfId ? left : right?.i === selfId ? right : null;
      if (me) updateUpgrades(me);

      const timerText = opts.solo ? fmtTime(s.t) : (s.tl != null ? fmtTime(s.tl) : '∞');
      if (hudEls.timer.textContent !== timerText) hudEls.timer.textContent = timerText;
      const sub = opts.subText || (opts.solo ? 'время полёта' : 'до конца матча');
      if (hudEls.timerSub.textContent !== sub) hudEls.timerSub.textContent = sub;

      if (hudEls.boost) {
        const me2 = ps.find((p) => p.i === selfId);
        if (me2 && me2.rf > 0) {
          hudEls.boost.textContent = `СТРЕЛЬБА ×2 ${Math.ceil(me2.rf / 1000)}с`;
          hudEls.boost.style.color = '#ff6ba8';
          hudEls.boost.classList.remove('hidden');
        } else if (me2 && me2.sh > 0) {
          hudEls.boost.textContent = `ЩИТ ${Math.ceil(me2.sh / 1000)}с`;
          hudEls.boost.style.color = '#5ad0ff';
          hudEls.boost.classList.remove('hidden');
        } else {
          hudEls.boost.classList.add('hidden');
        }
      }
    },

    onFx(fn) { onFxSound = fn; },
  };
}
