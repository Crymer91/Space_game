// Ввод: клавиатура (WASD/стрелки/пробел/1/2) + мышь (прицел, ЛКМ).
export function createInput(canvas, getView) {
  const keys = new Set();
  const buyQueue = [];
  let active = false;
  let mouse = { x: 0, y: 0, down: false };

  const MOVE_KEYS = {
    KeyW: [0, -1], ArrowUp: [0, -1],
    KeyS: [0, 1], ArrowDown: [0, 1],
    KeyA: [-1, 0], ArrowLeft: [-1, 0],
    KeyD: [1, 0], ArrowRight: [1, 0],
  };

  function onKeyDown(e) {
    if (!active) return;
    if (MOVE_KEYS[e.code] || e.code === 'Space' || e.code==='KeyQ' || e.code==='KeyE') e.preventDefault();
    if (!keys.has(e.code)) {
      if (e.code === 'Digit1') buyQueue.push('damage');
      if (e.code === 'Digit2') buyQueue.push('firerate');
      if (e.code === 'Digit3') buyQueue.push('life');
      if (e.code === 'Digit4') buyQueue.push('missiles');
    }
    keys.add(e.code);
  }

  function onKeyUp(e) {
    keys.delete(e.code);
  }

  function onMouseMove(e) {
    const r = canvas.getBoundingClientRect();
    mouse.x = e.clientX - r.left;
    mouse.y = e.clientY - r.top;
  }

  function onMouseDown(e) {
    if (!active) return;
    if (e.button === 0) { mouse.down = true; e.preventDefault(); }
    if (e.button === 2) mouse.rmb = true;
  }

  function onMouseUp(e) {
    if (e.button === 0) mouse.down = false;
    if (e.button === 2) mouse.rmb = false;
  }

  function onBlur() {
    keys.clear();
    mouse.down = false;
    mouse.rmb = false;
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  canvas.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mouseup', onMouseUp);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  return {
    setActive(v) {
      active = v;
      if (!v) onBlur();
    },
    getMove() {
      let mx = 0;
      let my = 0;
      for (const code of keys) {
        const d = MOVE_KEYS[code];
        if (d) { mx += d[0]; my += d[1]; }
      }
      return { mx, my };
    },
    mouseWorld() {
      const view = getView();
      return {
        x: (mouse.x - view.ox) / view.scale,
        y: (mouse.y - view.oy) / view.scale,
      };
    },
    getAim(selfX, selfY) {
      const w = this.mouseWorld();
      const dx = w.x - selfX;
      const dy = w.y - selfY;
      if (dx === 0 && dy === 0) return 0;
      return Math.atan2(dy, dx);
    },
    isShooting() {
      return mouse.down || keys.has('Space');
    },
    wantsMissile() {
      return mouse.rmb || keys.has('KeyF');
    },
    wantsLaser() {
      return keys.has('KeyQ');
    },
    wantsMine() {
      return keys.has('KeyE');
    },
    consumeLaser() {
      if (keys.has('KeyQ')) { keys.delete('KeyQ'); return true; }
      return false;
    },
    consumeMine() {
      if (keys.has('KeyE')) { keys.delete('KeyE'); return true; }
      return false;
    },
    consumeBuyKey() {
      return buyQueue.shift() ?? null;
    },
    destroy() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('mouseup', onMouseUp);
      canvas.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('mousedown', onMouseDown);
    },
  };
}
