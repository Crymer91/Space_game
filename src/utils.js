import { randomInt } from 'node:crypto';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateRoomCode(length = 4) {
  let code = '';
  for (let i = 0; i < length; i++) {
    code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return code;
}

export function randomId(prefix = 'id') {
  return `${prefix}-${Date.now().toString(36)}-${randomInt(0xffffffff).toString(36)}`;
}

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

export function createLogger(level = 'info') {
  const threshold = LEVELS[level] ?? LEVELS.info;
  const ts = () => new Date().toISOString();
  return {
    debug: (...args) => {
      if (threshold <= LEVELS.debug) console.log(ts(), '[debug]', ...args);
    },
    info: (...args) => {
      if (threshold <= LEVELS.info) console.log(ts(), '[info]', ...args);
    },
    warn: (...args) => {
      if (threshold <= LEVELS.warn) console.warn(ts(), '[warn]', ...args);
    },
    error: (...args) => {
      if (threshold <= LEVELS.error) console.error(ts(), '[error]', ...args);
    },
  };
}