// Единый баланс игры: импортируется и сервером (Node ESM), и браузером (статика /shared/).
// Меняйте значения здесь — поведение сервера и клиента обновится вместе.

export const BALANCE = {
  world: { width: 1600, height: 900 },

  ship: {
    radius: 14,
    accel: 640,          // px/s^2
    friction: 2.4,       // экспоненциальное затухание скорости
    maxSpeed: 260,
    lives: 3,
    respawnMs: 2500,
    invulnMs: 2000,      // неуязвимость после респавна
    fireCooldownMs: 280, // базовая скорострельность
    dropCoinsOnDeath: true,
  },

  bullet: {
    speed: 560,
    lifeMs: 1100,
    radius: 3.5,
  },

  asteroid: {
    small: {
      radiusMin: 13, radiusMax: 18,
      hp: 1, score: 10,
      coinsMin: 0, coinsMax: 1,
      speedMin: 70, speedMax: 115,
    },
    medium: {
      radiusMin: 26, radiusMax: 34,
      hp: 5, score: 50,
      coinsMin: 2, coinsMax: 3,
      speedMin: 45, speedMax: 80,
    },
    large: {
      radiusMin: 42, radiusMax: 52,
      hp: 10, score: 100,
      coinsMin: 4, coinsMax: 6,
      speedMin: 25, speedMax: 55,
    },
    // раскалывание больших астероидов на меньшие; 0 = отключить
    splitLargeIntoMediums: 2,
    splitMediumIntoSmalls: 2,
    maxCount: 14,
    comet: {
      radiusMin: 11, radiusMax: 15,
      hp: 2, score: 75,
      coinsMin: 1, coinsMax: 2,
      speedMin: 270, speedMax: 420,
    },
  },

  enemies: {
    hp: 4,
    radius: 16,
    score: 150,
    coinsMin: 5, coinsMax: 8,
    accel: 280,
    maxSpeed: 195,
    turnRate: 3.2,
    fireCooldownMs: 1500,
    bulletSpeed: 430,
    bulletLifeMs: 2000,
    preferredDistMin: 230,
    preferredDistMax: 370,
    engageDistMax: 750,
  },

  coin: {
    radius: 9,
    magnetRadius: 64,   // монета летит к ближайшему живому кораблю
    magnetPull: 420,    // ускорение притяжения
    pickupRadius: 24,
    lifeMs: 12000,
    driftDamping: 1.6,  // затухание разлёта после выпадения
    scorePerCoin: 2,
  },

  upgrades: {
    damage: {
      name: 'Урон',
      costs: [8, 16, 28, 45],
      dmgPerLevel: 1,          // базовый урон выстрела = 1
    },
    firerate: {
      name: 'Скорострельность',
      costs: [8, 16, 28, 45],
      cooldownFactor: 0.88,    // кулдаун * factor за каждый уровень
    },
    life: {
      name: 'Жизнь',
      cost: 20,
      maxLives: 5,             // потолок: базовые 3 жизни + максимум 2 докупленные
    },
    missiles: {
      name: 'Ракеты',
      cost: 100,
      pack: 3,                 // сколько ракет даёт одна покупка
      maxAmmo: 6,              // запас в запасе (боекомплект)
      fireCooldownMs: 500,
    },
  },

  missile: {
    radius: 5,
    accel: 560,
    maxSpeed: 440,
    turnRate: 4.4,             // рад/с — скорость доворота на цель
    lifeMs: 4000,
    blastRadius: 95,
    blastDamage: 5,
  },

  powerups: {
    cometChance: 0.25,
    enemyChance: 0.10,
    radius: 12,
    magnetRadius: 56,
    magnetPull: 380,
    pickupRadius: 26,
    lifeMs: 10000,
    driftDamping: 1.8,
    types: {
      rapidFire: { durationMs: 5000, cooldownFactor: 0.5 },
      shield:    { durationMs: 10000 },
    },
  },

  bosses: {
    types: {
      dreadnought: {
        key: 'dreadnought', name: 'Дредноут',
        score: 10000, hp: 70, radius: 52, scoreReward: 600,
        accel: 90, maxSpeed: 95, turnRate: 1.6,
        fireCooldownMs: 900, bulletSpeed: 380, bulletCount: 3, spread: 0.22,
      },
      phantom: {
        key: 'phantom', name: 'Фантом',
        score: 20000, hp: 125, radius: 46, scoreReward: 900,
        accel: 220, maxSpeed: 165, turnRate: 2.8,
        fireCooldownMs: 700, bulletSpeed: 460, bulletCount: 1,
        strafeSpeed: 140,
        mineIntervalMs: 5500,
      },
      leviathan: {
        key: 'leviathan', name: 'Левиафан',
        score: 30000, hp: 140, radius: 60, scoreReward: 1200,
        accel: 70, maxSpeed: 105, turnRate: 1.2,
        fireCooldownMs: 1200, bulletSpeed: 340, bulletCount: 8, // круговой залп
      },
    },
  },

  crystals: {
    coinValue: 1000,            // 1 кристал = 1000 монет
    lifeMs: 18000,
    radius: 14,
    magnetRadius: 90,
    pickupRadius: 30,
    driftDamping: 1.2,
  },

  abilities: {
    armor:  { name: 'Броня', charges: 2, regenMs: 15000 },
    laser:  { name: 'Лазер', durationMs: 5000, cooldownMs: 90000, dps: 18, width: 14, tickMs: 90 },
    mines:  { name: 'Мины', max: 5, cooldownMs: 180000, blastRadius: 115, blastDamage: 7, chainRadius: 210, maxChain: 6, armMs: 400 },
  },

  mine: {
    radius: 10,
    lifeMs: 25000,
  },

  matchDurationMs: 180000,

  // --- Единая конфигурация спавна противников волнами ---
  // Враги спавнятся волнами, по порядку из `list`. После каждой волны — пауза
  // (cooldownMs), затем следующая волна. Когда волны кончились, снова с первой
  // (если loop === true) либо игра переходит в «затишье».
  //
  // Каждая волна:
  //   name        — текстовое название (показывается игрокам)
  //   enemies     — сколько каких простых врагов заспавнить внутри волны.
  //                 Ключи: small / medium / large / comet / hunter.
  //   bosses      — список боссов (по ключам из B.bosses.types).
  //   intervalMs  — интервал между спавном врагов внутри волны (мс).
  //   cooldownMs  — пауза после волны перед следующей (мс).
  //                 Пустая волна (без enemies и bosses) = «затишье».
  waves: {
    loop: true,
    intervalMs: 900,      // интервал по умолчанию внутри волны
    cooldownMs: 4000,     // пауза по умолчанию после волны
    list: [
      {name: 'Пролог',                enemies:{small:3,medium:2,large:1},                                                                     cooldownMs:20000},
      { name: 'Астероидный дождь',    enemies: { small: 3, medium: 3, large: 1 },                 intervalMs: 700 },
      { name: 'Затишье',              enemies: {},                                                                    cooldownMs: 9000 },
      { name: 'Охотники',             enemies: { hunter: 2 },                                     intervalMs: 1200 },
      { name: 'Комета-шторм',         enemies: { comet: 8, small: 2 },                            intervalMs: 600 },
      { name: 'Авангард босса',       enemies: { small: 5, medium: 4 }, bosses: ['dreadnought'],  intervalMs: 650,     cooldownMs: 6000 },
      { name: 'Фланговая атака',      enemies: { hunter: 3, medium: 5 },                          intervalMs: 800 },
      { name: 'Крепость',             enemies: { small: 4, medium: 6, large: 2 }, bosses: ['phantom'], intervalMs: 700, cooldownMs: 7000 },
      { name: 'Огненный лёд',         enemies: { comet: 12, hunter: 2 },                          intervalMs: 500 },
      { name: 'Левиафан',             enemies: { medium: 6, small: 6 }, bosses: ['leviathan'], intervalMs: 650, cooldownMs: 8000 },
      { name: 'Итоговый штурм',       enemies: { comet: 6, hunter: 4, medium: 8, large: 3 }, bosses: ['dreadnought', 'phantom', 'leviathan'], intervalMs: 480 },
    ],
  },
};
 