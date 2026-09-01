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
    radius: 5,
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
      speedMin: 540, speedMax: 840,
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

  bosses: {
    // Боссы выпускаются волнами через waves.list[].bosses (см. конфигурацию волн).
    types: {
      dreadnought: {
        key: 'dreadnought', name: 'Дредноут',
        hp: 140, radius: 52, scoreReward: 600,
        accel: 90, maxSpeed: 95, turnRate: 1.6,
        fireCooldownMs: 900, bulletSpeed: 380, bulletCount: 3, spread: 0.22,
      },
      phantom: {
        key: 'phantom', name: 'Фантом',
        hp: 250, radius: 46, scoreReward: 900,
        accel: 220, maxSpeed: 165, turnRate: 2.8,
        fireCooldownMs: 700, bulletSpeed: 460, bulletCount: 1,
        strafeSpeed: 140,
        mineIntervalMs: 5500,
      },
      leviathan: {
        key: 'leviathan', name: 'Левиафан',
        hp: 280, radius: 60, scoreReward: 1200,
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
    armor:  { name: 'Броня', charges: 1, regenMs: 15000 },
    laser:  { name: 'Лазер', durationMs: 5000, cooldownMs: 90000, dps: 18, width: 14, tickMs: 90 },
    mines:  { name: 'Мины', max: 5, cooldownMs: 180000, blastRadius: 115, blastDamage: 7, chainRadius: 210, maxChain: 6, armMs: 400 },
  },

  mine: {
    radius: 10,
    lifeMs: 25000,
  },

  matchDurationMs: 180000,

  nebula: {
    satelliteChance: 0.35,       // шанс что астероид получит спутник после 2 босса
    satelliteDistMin: 32,
    satelliteDistMax: 52,
    satelliteSizeFactor: 0.42,   // размер спутника от родителя
    orbitSpeedMin: 0.9,          // рад/с
    orbitSpeedMax: 1.9,
  },

  // Реестр типов спавнящихся противников в волнах. Каждый вид имеет параметры
  // по умолчанию; конкретная волна может их переопределить.
  //   intervalMs   — частота появления (интервал между спавнами, мс)
  //   count        — сколько объектов этого вида за волну
  //   max          — потолок одновременно на арене
  //   composition  — (только для астероидов) состав волны: веса типов
  // ПРИ ДОБАВЛЕНИИ НОВОГО ВИДА ПРОТИВНИКА:
  //   1) добавьте запись сюда (ключ = id вида),
  //   2) добавьте обработчик в shared/world.js в объект SPAWNERS по этому ключу.
  enemyKinds: {
    asteroid: { intervalMs: 1400, count: 14, max: 14,
      composition: { small: 0.6, medium: 0.32, large: 0.08 } },
    comet:    { intervalMs: 1900, count: 6,  max: 6 },
    enemy:    { intervalMs: 8000, count: 2,  max: 2 },
  },

  // Очередь волн. Каждая волна:
  //   durationMs   — время волны (сколько она длится)
  //   cooldownMs   — период охлаждения после волны (пауза без спавна)
  //   bosses       — боссы, выпускаемые в начале волны: ['dreadnought', 'phantom', 'leviathan']
  //   spawns       — какие виды противников появляются и с какими параметрами:
  //                  [{ kind: 'вид', intervalMs?, count?, max?, composition? }]
  //                  пропущенные поля берутся из enemyKinds; вид не указан — не спавнится.
  //                  Новый вид противника добавляется новой записью в этом списке.
  // Волны проигрываются по порядку; после последней повторяется она же.
  waves: {
    list: [
      // 1. Затишье: только астероиды
      { durationMs: 10000, cooldownMs: 2000,
        spawns: [
          { kind: 'asteroid', intervalMs: 1600, count: 8,
            composition: { small: 0.80, medium: 0.20, large: 0.00 } },
        ] },
      // 2. Разгон: крупнее астероиды + первые кометы
      { durationMs: 12000, cooldownMs: 2000,
        spawns: [
          { kind: 'asteroid', intervalMs: 1200, count: 12,
            composition: { small: 0.60, medium: 0.35, large: 0.05 } },
          { kind: 'comet', intervalMs: 2600, count: 3 },
        ] },
      // 3. Первый охотник: подключается вражеский корабль
      { durationMs: 13000, cooldownMs: 2200,
        spawns: [
          { kind: 'asteroid', intervalMs: 1100, count: 12,
            composition: { small: 0.50, medium: 0.40, large: 0.10 } },
          { kind: 'comet', intervalMs: 2400, count: 3 },
          { kind: 'enemy', intervalMs: 9000, count: 1 },
        ] },
      // 4. Дредноут с эскортом из комет и охотников
      { durationMs: 15000, cooldownMs: 3000, bosses: ['dreadnought'],
        spawns: [
          { kind: 'asteroid', intervalMs: 1400, count: 10,
            composition: { small: 0.45, medium: 0.40, large: 0.15 } },
          { kind: 'comet', intervalMs: 2200, count: 4 },
          { kind: 'enemy', intervalMs: 8000, count: 1 },
        ] },
      // 5. Кометный ливень
      { durationMs: 12000, cooldownMs: 2000,
        spawns: [
          { kind: 'asteroid', intervalMs: 1000, count: 14,
            composition: { small: 0.40, medium: 0.40, large: 0.20 } },
          { kind: 'comet', intervalMs: 1200, count: 8 },
        ] },
      // 6. Стая охотников
      { durationMs: 14000, cooldownMs: 2500,
        spawns: [
          { kind: 'asteroid', intervalMs: 900, count: 16,
            composition: { small: 0.30, medium: 0.45, large: 0.25 } },
          { kind: 'enemy', intervalMs: 6000, count: 3 },
        ] },
      // 7. Фантом под прикрытием комет и врагов
      { durationMs: 16000, cooldownMs: 3000, bosses: ['phantom'],
        spawns: [
          { kind: 'asteroid', intervalMs: 1200, count: 12,
            composition: { small: 0.35, medium: 0.45, large: 0.20 } },
          { kind: 'comet', intervalMs: 1800, count: 5 },
          { kind: 'enemy', intervalMs: 7000, count: 2 },
        ] },
      // 8. Полная тревога: всё и сразу
      { durationMs: 14000, cooldownMs: 2000,
        spawns: [
          { kind: 'asteroid', intervalMs: 700, count: 20,
            composition: { small: 0.30, medium: 0.40, large: 0.30 } },
          { kind: 'comet', intervalMs: 1400, count: 8 },
          { kind: 'enemy', intervalMs: 5500, count: 4 },
        ] },
      // 9. Левиафан — финал всех фаз
      { durationMs: 18000, cooldownMs: 4000, bosses: ['leviathan'],
        spawns: [
          { kind: 'asteroid', intervalMs: 1000, count: 14,
            composition: { small: 0.30, medium: 0.40, large: 0.30 } },
          { kind: 'comet', intervalMs: 1500, count: 6 },
          { kind: 'enemy', intervalMs: 6000, count: 3 },
        ] },
      // 10. Бесконечный затяжной бой (повторяется) — без босса
      { durationMs: 15000, cooldownMs: 2500,
        spawns: [
          { kind: 'asteroid', intervalMs: 850, count: 18,
            composition: { small: 0.35, medium: 0.40, large: 0.25 } },
          { kind: 'comet', intervalMs: 1600, count: 7 },
          { kind: 'enemy', intervalMs: 6000, count: 3 },
        ] },
    ],
  },
};
