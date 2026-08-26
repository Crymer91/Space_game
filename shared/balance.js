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

  // Уровни угрозы: разблокируются по максимальному счёту игрока в матче
  comets: {
    unlockScore: 3000,
    intervalMinMs: 1700,
    intervalMaxMs: 2900,
  },

  enemies: {
    unlockScore: 6000,
    firstSpawnDelayMs: 1500,
    intervalMinMs: 6500,
    intervalMaxMs: 11000,
    maxAlive: 2,
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

  matchDurationMs: 180000,

  waves: {
    startIntervalMs: 1400,
    minIntervalMs: 480,
    rampMs: 90000,             // за это время интервал падает до минимума
    // веса типов в начале и в конце матча (линейная интерполяция)
    weightsStart: { small: 0.6, medium: 0.32, large: 0.08 },
    weightsEnd:   { small: 0.34, medium: 0.42, large: 0.24 },
  },
};
