(function () {
  // Базовые размеры сцены и физики.
  const GAME_WIDTH = 1024;
  const GAME_HEIGHT = 768;
  const HUD_HEIGHT = 86;
  const WORLD_TOP = HUD_HEIGHT;
  const FLOOR_Y = 710;
  const GRAVITY = 1500;
  const COYOTE_TIME = 0.08;
  const BOOST_DURATION = 5;

  // Все кадры лежат в одном описании, чтобы не искать их по файлу.
  const AZOT_FRAMES = {
    playerIdle: { sx: 2, sy: 1, sw: 14, sh: 30, rw: 25, rh: 55, ox: 0, oy: 0 },
    playerWalk1: { sx: 18, sy: 1, sw: 16, sh: 30, rw: 26, rh: 55, ox: -1, oy: 0 },
    playerWalk2: { sx: 36, sy: 1, sw: 15, sh: 30, rw: 25, rh: 55, ox: 0, oy: 0 },
    playerJump: { sx: 52, sy: 1, sw: 18, sh: 29, rw: 30, rh: 57, ox: -2, oy: -2 },
    stockCrate: { sx: 77, sy: 13, sw: 20, sh: 18 },
    rushInvoice: { sx: 101, sy: 8, sw: 17, sh: 23 },
    glassCrate: { sx: 120, sy: 13, sw: 20, sh: 18 },
    energyCan: { sx: 147, sy: 12, sw: 12, sh: 19 },
    cart1: { sx: 167, sy: 13, sw: 25, sh: 18 },
    cart2: { sx: 198, sy: 13, sw: 25, sh: 18 }
  };

  // Участок меняет состав заказов и темп помех на смене.
  const SHIFT_SECTOR_RULES = {
    "bulk-lane": {
      urgentBonus: -0.05,
      fragileBonus: -0.04,
      activeOrdersBonus: 1,
      initialOrders: 5,
      urgentTtl: 5.6,
      forkliftSpeedBonus: -10,
      energyRespawnBase: 16
    },
    "rush-dock": {
      urgentBonus: 0.17,
      fragileBonus: -0.06,
      activeOrdersBonus: 1,
      initialOrders: 5,
      urgentTtl: 4.2,
      forkliftSpeedBonus: 22,
      energyRespawnBase: 12
    },
    "fragile-bay": {
      urgentBonus: -0.03,
      fragileBonus: 0.2,
      activeOrdersBonus: -1,
      initialOrders: 4,
      urgentTtl: 5.2,
      forkliftSpeedBonus: 8,
      energyRespawnBase: 15
    }
  };

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function rectsIntersect(a, b) {
    return (
      a.x < b.x + b.w &&
      a.x + a.w > b.x &&
      a.y < b.y + b.h &&
      a.y + a.h > b.y
    );
  }

  function createEmptyShiftStats() {
    return {
      ordinarySpawned: 0,
      urgentSpawned: 0,
      fragileSpawned: 0,
      ordinaryPicked: 0,
      urgentPicked: 0,
      fragilePicked: 0,
      falls: 0,
      cartHits: 0,
      cartCargoLosses: 0,
      cartOrdinaryLosses: 0,
      cartUrgentLosses: 0,
      cartFragileLosses: 0,
      urgentExpired: 0,
      fragileBroken: 0,
      boostsUsed: 0
    };
  }

  // Паспорт участка передаём из диспетчерской формы в саму смену.
  function normalizeShiftPassport(passport) {
    const source = passport && typeof passport === 'object' ? passport : {};
    const sectorCode = SHIFT_SECTOR_RULES[source.sectorCode] ? source.sectorCode : 'bulk-lane';

    return {
      sectorCode: sectorCode,
      sectorLabel: source.sectorLabel || (
        sectorCode === 'rush-dock' ? 'Экспресс-ворота' :
        sectorCode === 'fragile-bay' ? 'Хрупкий ряд' :
        'Паллетный ряд'
      ),
      sectorShortLabel: source.sectorShortLabel || (
        sectorCode === 'rush-dock' ? 'Экспресс' :
        sectorCode === 'fragile-bay' ? 'Хрупкий' :
        'Паллеты'
      ),
      brigadeCode: typeof source.brigadeCode === 'string' ? source.brigadeCode : 'north-3',
      brigadeLabel: source.brigadeLabel || 'Север-3'
    };
  }

  function AzotShiftRunner(canvas, options) {
    options = options || {};
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.options = options;
    this.shiftPassport = normalizeShiftPassport(options.shiftPassport);
    this.sectorRules = SHIFT_SECTOR_RULES[this.shiftPassport.sectorCode];
    this.audio = options.audio || {
      startAmbient: function () {},
      stopAmbient: function () {},
      play: function () {}
    };
    this.sprites = new Image();
    this.sprites.src = 'assets/sprites.png';
    this.bgTile = new Image();
    this.bgTile.src = 'assets/bg-tile.png';

    // Здесь живёт всё состояние одной смены.
    this.lastTimestamp = 0;
    this.warehouseDrift = 0;
    this.running = false;
    this.finished = false;
    this.paused = false;
    this.pickerAlias = 'Игрок';
    this.testMode = false;
    this.score = 0;
    this.timeLeft = 90;
    this.maxLives = 3;
    this.lives = 3;
    this.runTime = 0;
    this.orderDropTimer = 0;
    this.forkliftSpawnTimer = 0;
    this.energySpawnTimer = 0;
    this.forkliftSerial = 0;

    this.playerControls = {
      left: false,
      right: false,
      down: false,
      jumpQueued: false
    };

    this.flashTimer = 0;
    this.radioMessage = '';
    this.radioMessageTimer = 0;
    this.dockPopups = [];
    this.shiftStats = createEmptyShiftStats();

    this.player = null;
    this.rackPlatforms = [];
    this.forkliftLanes = [];
    this.forkliftPatrols = [];
    this.warehouseOrders = [];
    this.energyPickups = [];

    this.boundLoop = this.loop.bind(this);
    this.handleKeyDown = this.onKeyDown.bind(this);
    this.handleKeyUp = this.onKeyUp.bind(this);
  }

  AzotShiftRunner.prototype.start = function (pickerName, testMode) {
    // Если браузер не дал canvas, корректно выходим сразу.
    if (!this.ctx) {
      if (typeof this.options.onFinish === 'function') {
        this.options.onFinish({
          pickerName: pickerName || 'Игрок',
          score: 0,
          testMode: !!testMode,
          lives: 0,
          reason: 'canvas-error',
          shiftPassport: this.shiftPassport,
          stats: createEmptyShiftStats()
        });
      }
      return;
    }

    this.pickerAlias = pickerName;
    this.testMode = !!testMode;
    this.running = true;
    this.finished = false;
    this.paused = false;
    this.lastTimestamp = 0;
    this.warehouseDrift = 0;
    this.score = 0;
    this.timeLeft = 90;
    this.maxLives = 3;
    this.lives = this.maxLives;
    this.runTime = 0;
    this.orderDropTimer = 0.5;
    this.forkliftSpawnTimer = 1.2;
    this.energySpawnTimer = this.sectorRules.energyRespawnBase - 4;
    this.forkliftSerial = 0;
    this.flashTimer = 0;
    this.radioMessage = this.testMode ? 'TEST MODE' : 'Смена началась: ' + this.shiftPassport.sectorLabel;
    this.radioMessageTimer = 1.4;
    this.dockPopups = [];
    this.shiftStats = createEmptyShiftStats();

    this.buildWarehouseFloor();

    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);

    this.audio.startAmbient();
    this.broadcastShiftBoard();
    window.requestAnimationFrame(this.boundLoop);
  };

  AzotShiftRunner.prototype.stop = function () {
    this.running = false;
    this.audio.stopAmbient();
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
  };

  AzotShiftRunner.prototype.buildWarehouseFloor = function () {
    // Расклад полок и стартовая точка игрока.
    this.rackPlatforms = [
      { x: 0, y: FLOOR_Y, w: GAME_WIDTH, h: GAME_HEIGHT - FLOOR_Y, solid: false },
      { x: 40,  y: 600, w: 180, h: 18, solid: true },
      { x: 260, y: 600, w: 504, h: 18, solid: true },
      { x: 804, y: 600, w: 180, h: 18, solid: true },

      { x: 90, y: 515, w: 220, h: 18, solid: true },
      { x: 390, y: 505, w: 230, h: 18, solid: true },
      { x: 690, y: 495, w: 270, h: 18, solid: true },

      { x: 0, y: 430, w: 210, h: 18, solid: true },
      { x: 280, y: 420, w: 240, h: 18, solid: true },
      { x: 610, y: 410, w: 220, h: 18, solid: true },
      { x: 860, y: 430, w: 144, h: 18, solid: true },

      { x: 110, y: 345, w: 220, h: 18, solid: true },
      { x: 390, y: 335, w: 230, h: 18, solid: true },
      { x: 700, y: 325, w: 250, h: 18, solid: true },

      { x: 60, y: 260, w: 210, h: 18, solid: true },
      { x: 360, y: 250, w: 210, h: 18, solid: true },
      { x: 690, y: 240, w: 230, h: 18, solid: true }
    ];

    this.player = {
      x: 90,
      y: 450,
      w: 25,
      h: 55,
      vx: 0,
      vy: 0,
      baseSpeed: 270,
      speed: 270,
      baseJumpForce: 580,
      jumpForce: 580,
      baseMaxAirJumps: 0,
      maxAirJumps: 0,
      airJumpsLeft: 0,
      onGround: false,
      coyoteTimer: 0,
      invulnerability: 0,
      boostTimer: 0,
      supportPlatformIndex: -1,
      dropThroughPlatformIndex: -1,
      dropResumeY: 0,
      frameTime: 0,
      frameIndex: 'playerIdle',
      facing: 1
    };

    this.forkliftLanes = [];
    for (let i = 1; i < this.rackPlatforms.length; i += 1) {
      const platform = this.rackPlatforms[i];
      if (platform.w >= 180) {
        this.forkliftLanes.push({
          platformIndex: i,
          y: platform.y - 40
        });
      }
    }

    this.forkliftPatrols = [];
    this.warehouseOrders = [];
    this.energyPickups = [];

    for (let i = 0; i < this.sectorRules.initialOrders; i += 1) {
      this.spawnFallingOrder();
    }
  };

  AzotShiftRunner.prototype.getDifficulty = function () {
    return clamp(this.runTime / 55, 0, 1);
  };

  AzotShiftRunner.prototype.getTargetActiveOrders = function () {
    return 5 + this.sectorRules.activeOrdersBonus + Math.floor(this.getDifficulty() * 5);
  };

  AzotShiftRunner.prototype.chooseOrderType = function () {
    const difficulty = this.getDifficulty();
    const fragileChance = clamp(0.12 + difficulty * 0.28 + this.sectorRules.fragileBonus, 0.08, 0.48);
    const urgentChance = clamp(0.22 + difficulty * 0.28 + this.sectorRules.urgentBonus, 0.12, 0.52);
    const roll = Math.random();

    if (roll < fragileChance) {
      return 'fragile';
    }
    if (roll < fragileChance + urgentChance) {
      return 'urgent';
    }
    return 'ordinary';
  };

  AzotShiftRunner.prototype.getRacksUnderX = function (x, width) {
    const result = [];

    for (let i = 1; i < this.rackPlatforms.length; i += 1) {
      const platform = this.rackPlatforms[i];
      const horizontalOverlap = x + width > platform.x && x < platform.x + platform.w;
      if (horizontalOverlap) {
        result.push(i);
      }
    }

    result.sort(function (a, b) {
      return this.rackPlatforms[a].y - this.rackPlatforms[b].y;
    }.bind(this));

    return result.length ? result : [1];
  };

  AzotShiftRunner.prototype.createWarehouseOrder = function (type, targetPlatformIndex) {
    const platform = this.rackPlatforms[targetPlatformIndex];
    const sizeMap = {
      ordinary: { w: 30, h: 28, value: 10, gravityScale: 1, maxFallSpeed: 960 },
      urgent: { w: 24, h: 33, value: 20, gravityScale: 1, maxFallSpeed: 980 },
      fragile: { w: 31, h: 29, value: 30, gravityScale: 0.22, maxFallSpeed: 150 }
    };
    const data = sizeMap[type];
    const x = platform.x + 20 + Math.random() * Math.max(20, platform.w - data.w - 40);
    const supportedPlatforms = this.getRacksUnderX(x, data.w);
    const targetStopPlatformIndex = type === 'fragile'
      ? null
      : supportedPlatforms[Math.floor(Math.random() * supportedPlatforms.length)];
    const fragileBreakPlatformIndex = type === 'fragile'
      ? supportedPlatforms[supportedPlatforms.length - 1]
      : null;

    return {
      x: x,
      y: -data.h - Math.random() * 140,
      w: data.w,
      h: data.h,
      type: type,
      value: data.value,
      state: 'falling',
      vy: 0,
      platformIndex: null,
      targetStopPlatformIndex: targetStopPlatformIndex,
      ttl: type === 'urgent' ? this.sectorRules.urgentTtl : 0,
      bobPhase: Math.random() * Math.PI * 2,
      pulse: Math.random() * Math.PI * 2,
      gravityScale: data.gravityScale,
      maxFallSpeed: data.maxFallSpeed,
      fragileBreakPlatformIndex: fragileBreakPlatformIndex
    };
  };

  AzotShiftRunner.prototype.spawnFallingOrder = function () {
    const availablePlatforms = this.rackPlatforms.slice(1);
    const targetPlatform = availablePlatforms[Math.floor(Math.random() * availablePlatforms.length)];
    const targetPlatformIndex = this.rackPlatforms.indexOf(targetPlatform);
    const type = this.chooseOrderType();
    if (type === 'fragile') {
      this.shiftStats.fragileSpawned += 1;
    } else if (type === 'urgent') {
      this.shiftStats.urgentSpawned += 1;
    } else {
      this.shiftStats.ordinarySpawned += 1;
    }
    this.warehouseOrders.push(this.createWarehouseOrder(type, targetPlatformIndex));
  };

  AzotShiftRunner.prototype.spawnEnergyPickup = function () {
    const platformIndex = 1 + Math.floor(Math.random() * (this.rackPlatforms.length - 1));
    const platform = this.rackPlatforms[platformIndex];
    this.energyPickups.push({
      type: 'energy',
      x: platform.x + 24 + Math.random() * Math.max(24, platform.w - 56),
      y: platform.y - 32,
      w: 20,
      h: 31,
      ttl: 7,
      platformIndex: platformIndex,
      bobPhase: Math.random() * Math.PI * 2
    });
  };

  AzotShiftRunner.prototype.applyEnergyRush = function () {
    this.shiftStats.boostsUsed += 1;
    this.player.boostTimer = BOOST_DURATION;
    this.player.speed = this.player.baseSpeed + 85;
    this.player.maxAirJumps = 1;
    this.player.airJumpsLeft = Math.max(this.player.airJumpsLeft, 1);
    this.radioMessage = 'Энергетик: ускорение и двойной прыжок';
    this.radioMessageTimer = 1.1;
    this.pushDockPopup(this.player.x, this.player.y - 10, 'BOOST');
    this.audio.play('pickupRare');
  };

  AzotShiftRunner.prototype.spawnForklift = function () {
    const difficulty = this.getDifficulty();
    const lane = this.forkliftLanes[Math.floor(Math.random() * this.forkliftLanes.length)];
    const fromLeft = Math.random() < 0.5;
    const baseSpeed = 190 + difficulty * 120 + this.sectorRules.forkliftSpeedBonus;

    this.forkliftPatrols.push({
      id: this.forkliftSerial,
      x: fromLeft ? -72 : GAME_WIDTH + 72,
      y: lane.y,
      w: 54,
      h: 42,
      speed: baseSpeed + Math.random() * 35,
      dir: fromLeft ? 1 : -1,
      platformIndex: lane.platformIndex,
      anim: 0
    });

    this.forkliftSerial += 1;
  };

  AzotShiftRunner.prototype.dropThroughRack = function () {
    const player = this.player;
    if (!player.onGround || player.supportPlatformIndex <= 0) {
      return;
    }

    const platform = this.rackPlatforms[player.supportPlatformIndex];
    player.dropThroughPlatformIndex = player.supportPlatformIndex;
    player.dropResumeY = platform.y + platform.h + 8;
    player.supportPlatformIndex = -1;
    player.onGround = false;
    player.y += 4;
    player.vy = Math.max(player.vy, 90);
  };

  AzotShiftRunner.prototype.resetPlayerAfterFall = function () {
    const player = this.player;
    player.x = 90;
    player.y = 450;
    player.vx = 0;
    player.vy = 0;
    player.onGround = false;
    player.invulnerability = 1.2;
    player.supportPlatformIndex = -1;
    player.dropThroughPlatformIndex = -1;
    player.dropResumeY = 0;
    player.airJumpsLeft = player.maxAirJumps;
    player.coyoteTimer = 0;
  };

  AzotShiftRunner.prototype.handlePlayerFall = function () {
    this.shiftStats.falls += 1;

    if (this.testMode) {
      this.resetPlayerAfterFall();
      this.audio.play('hit');
      this.flashTimer = 0.2;
      this.pushDockPopup(this.player.x, this.player.y - 8, 'TEST');
      this.radioMessage = 'Тестовый сброс после падения';
      this.radioMessageTimer = 0.9;
      return;
    }

    this.score = Math.max(0, this.score - 10);
    this.lives = Math.max(0, this.lives - 1);
    this.audio.play('hit');
    this.flashTimer = 0.2;

    if (this.lives <= 0) {
      this.radioMessage = 'Вы снова упали - игра окончена';
      this.radioMessageTimer = 1.2;
      this.finishRun('fall');
      return;
    }

    this.resetPlayerAfterFall();
    this.pushDockPopup(this.player.x, this.player.y - 8, '-10');
    this.radioMessage = 'Падение: -10 очков, осталось жизней ' + this.lives;
    this.radioMessageTimer = 1.1;
  };

  AzotShiftRunner.prototype.onKeyDown = function (event) {
    if (!this.running || this.finished) {
      return;
    }

    if (event.code === 'ArrowLeft' || event.code === 'KeyA') {
      this.playerControls.left = true;
    } else if (event.code === 'ArrowRight' || event.code === 'KeyD') {
      this.playerControls.right = true;
    } else if (event.code === 'ArrowDown' || event.code === 'KeyS') {
      this.playerControls.down = true;
      this.dropThroughRack();
    } else if (event.code === 'ArrowUp' || event.code === 'KeyW') {
      if (!event.repeat) {
        this.playerControls.jumpQueued = true;
      }
    } else if ((event.code === 'Space' || event.code === 'KeyP') && !event.repeat) {
      event.preventDefault();
      this.togglePause();
    }
  };

  AzotShiftRunner.prototype.onKeyUp = function (event) {
    if (event.code === 'ArrowLeft' || event.code === 'KeyA') {
      this.playerControls.left = false;
    } else if (event.code === 'ArrowRight' || event.code === 'KeyD') {
      this.playerControls.right = false;
    } else if (event.code === 'ArrowDown' || event.code === 'KeyS') {
      this.playerControls.down = false;
    }
  };

  AzotShiftRunner.prototype.togglePause = function () {
    if (!this.running || this.finished) {
      return;
    }
    this.paused = !this.paused;
    if (typeof this.options.onPauseChange === 'function') {
      this.options.onPauseChange(this.paused);
    }
  };

  AzotShiftRunner.prototype.finishRun = function (reason) {
    if (this.finished) {
      return;
    }

    this.finished = true;
    this.running = false;
    this.audio.stopAmbient();
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);

    if (typeof this.options.onFinish === 'function') {
      this.options.onFinish(this.buildShiftSummary(reason));
    }
  };

  AzotShiftRunner.prototype.buildShiftSummary = function (reason) {
    const stats = this.shiftStats || createEmptyShiftStats();

    return {
      pickerName: this.pickerAlias,
      score: this.score,
      testMode: this.testMode,
      lives: this.lives,
      reason: reason || 'complete',
      shiftPassport: this.shiftPassport,
      stats: {
        ordinarySpawned: stats.ordinarySpawned,
        urgentSpawned: stats.urgentSpawned,
        fragileSpawned: stats.fragileSpawned,
        ordinaryPicked: stats.ordinaryPicked,
        urgentPicked: stats.urgentPicked,
        fragilePicked: stats.fragilePicked,
        falls: stats.falls,
        cartHits: stats.cartHits,
        cartCargoLosses: stats.cartCargoLosses,
        cartOrdinaryLosses: stats.cartOrdinaryLosses,
        cartUrgentLosses: stats.cartUrgentLosses,
        cartFragileLosses: stats.cartFragileLosses,
        urgentExpired: stats.urgentExpired,
        fragileBroken: stats.fragileBroken,
        boostsUsed: stats.boostsUsed
      }
    };
  };

  AzotShiftRunner.prototype.loop = function (timestamp) {
    if (!this.running) {
      this.render();
      return;
    }

    if (!this.lastTimestamp) {
      this.lastTimestamp = timestamp;
    }

    let dt = (timestamp - this.lastTimestamp) / 1000;
    this.lastTimestamp = timestamp;
    dt = Math.min(dt, 0.05);

    this.update(dt);
    this.render();
    this.broadcastShiftBoard();

    if (this.running) {
      window.requestAnimationFrame(this.boundLoop);
    }
  };

  AzotShiftRunner.prototype.update = function (dt) {
    // В паузе живут только служебные таймеры и визуальные мелочи.
    this.warehouseDrift += dt * (this.paused ? 18 : 48);

    if (this.radioMessageTimer > 0) {
      this.radioMessageTimer -= dt;
      if (this.radioMessageTimer <= 0) {
        this.radioMessage = '';
      }
    }

    this.dockPopups = this.dockPopups.filter(function (popup) {
      popup.life -= dt;
      popup.y -= dt * 34;
      return popup.life > 0;
    });

    if (this.flashTimer > 0) {
      this.flashTimer -= dt;
    }

    if (this.paused) {
      return;
    }

    this.runTime += dt;

    if (this.player.boostTimer > 0) {
      this.player.boostTimer -= dt;
      if (this.player.boostTimer <= 0) {
        this.player.boostTimer = 0;
        this.player.speed = this.player.baseSpeed;
        this.player.maxAirJumps = this.player.baseMaxAirJumps;
        this.player.airJumpsLeft = Math.min(this.player.airJumpsLeft, this.player.maxAirJumps);
        this.radioMessage = 'Энергетик закончился';
        this.radioMessageTimer = 0.8;
      }
    }

    if (!this.testMode) {
      this.timeLeft -= dt;
      if (this.timeLeft <= 0) {
        this.timeLeft = 0;
        this.finishRun('timeout');
        return;
      }
    }

    this.orderDropTimer -= dt;
    if (this.orderDropTimer <= 0 && this.warehouseOrders.length < this.getTargetActiveOrders()) {
      this.spawnFallingOrder();
      this.orderDropTimer = 0.95 - this.getDifficulty() * 0.45 + Math.random() * 0.25;
    }

    this.forkliftSpawnTimer -= dt;
    if (this.forkliftSpawnTimer <= 0 && this.forkliftPatrols.length < 3 + Math.floor(this.getDifficulty() * 5)) {
      this.spawnForklift();
      this.forkliftSpawnTimer = 2.4 - this.getDifficulty() * 1.45 + Math.random() * 0.35;
    }

    this.energySpawnTimer -= dt;
    if (this.energySpawnTimer <= 0 && this.energyPickups.length < 1) {
      this.spawnEnergyPickup();
      this.energySpawnTimer = this.sectorRules.energyRespawnBase + Math.random() * 4;
    }

    this.updatePlayer(dt);
    if (!this.running) {
      return;
    }
    this.updateWarehouseOrders(dt);
    this.updateEnergyPickups(dt);
    this.updateForkliftPatrols(dt);
  };

  AzotShiftRunner.prototype.updatePlayer = function (dt) {
    const player = this.player;

    player.vx = 0;
    if (this.playerControls.left) {
      player.vx = -player.speed;
      player.facing = -1;
    }
    if (this.playerControls.right) {
      player.vx = player.speed;
      player.facing = 1;
    }

    if (this.playerControls.jumpQueued) {
      if (player.onGround || player.coyoteTimer > 0) {
        player.vy = -player.jumpForce;
        player.onGround = false;
        player.coyoteTimer = 0;
        player.supportPlatformIndex = -1;
        this.audio.play('jump');
      } else if (player.airJumpsLeft > 0) {
        player.vy = -player.jumpForce;
        player.airJumpsLeft -= 1;
        this.audio.play('jump');
        this.pushDockPopup(player.x, player.y - 6, 'x2');
      }
    }
    this.playerControls.jumpQueued = false;

    player.vy += GRAVITY * dt;
    player.invulnerability = Math.max(0, player.invulnerability - dt);
    player.coyoteTimer = Math.max(0, player.coyoteTimer - dt);

    if (player.dropThroughPlatformIndex !== -1 && player.y > player.dropResumeY) {
      player.dropThroughPlatformIndex = -1;
    }

    player.x += player.vx * dt;
    if (player.x > GAME_WIDTH) {
      player.x = -player.w;
    } else if (player.x + player.w < 0) {
      player.x = GAME_WIDTH;
    }

    const previousY = player.y;
    const wasOnGround = player.onGround;
    player.y += player.vy * dt;
    player.onGround = false;
    player.supportPlatformIndex = -1;

    for (let i = 1; i < this.rackPlatforms.length; i += 1) {
      if (i === player.dropThroughPlatformIndex) {
        continue;
      }

      const platform = this.rackPlatforms[i];
      const wasAbove = previousY + player.h <= platform.y;
      const nowIntersect = rectsIntersect(player, platform);
      if (wasAbove && nowIntersect && player.vy >= 0) {
        player.y = platform.y - player.h;
        player.vy = 0;
        player.onGround = true;
        player.coyoteTimer = COYOTE_TIME;
        player.supportPlatformIndex = i;
        player.airJumpsLeft = player.maxAirJumps;
        break;
      }
    }

    if (!player.onGround && wasOnGround && player.dropThroughPlatformIndex === -1) {
      player.coyoteTimer = COYOTE_TIME;
    }

    if (player.onGround && this.playerControls.down && player.supportPlatformIndex > 0) {
      this.dropThroughRack();
    }

    if (player.y > GAME_HEIGHT + 24) {
      this.handlePlayerFall();
      if (!this.running) {
        return;
      }
    }

    player.frameTime += dt;
    if (Math.abs(player.vx) > 10 && player.onGround) {
      player.frameIndex = Math.floor(player.frameTime * 10) % 2 === 0 ? 'playerWalk1' : 'playerWalk2';
    } else if (!player.onGround) {
      player.frameIndex = 'playerJump';
    } else {
      player.frameIndex = 'playerIdle';
    }
  };

  AzotShiftRunner.prototype.getLandingRackIndex = function (item, previousY) {
    let landedPlatformIndex = -1;
    let landedPlatformY = Infinity;

    for (let i = 1; i < this.rackPlatforms.length; i += 1) {
      const platform = this.rackPlatforms[i];
      const horizontalOverlap = item.x + item.w > platform.x && item.x < platform.x + platform.w;
      const wasAbove = previousY + item.h <= platform.y;
      const nowBelowTop = item.y + item.h >= platform.y;

      if (horizontalOverlap && wasAbove && nowBelowTop && platform.y < landedPlatformY) {
        landedPlatformIndex = i;
        landedPlatformY = platform.y;
      }
    }

    return landedPlatformIndex;
  };

  AzotShiftRunner.prototype.collectOrderCargo = function (index) {
    const cargo = this.warehouseOrders[index];
    if (!cargo) {
      return;
    }

    this.score += cargo.value;
    if (cargo.type === 'fragile') {
      this.shiftStats.fragilePicked += 1;
    } else if (cargo.type === 'urgent') {
      this.shiftStats.urgentPicked += 1;
    } else {
      this.shiftStats.ordinaryPicked += 1;
    }
    this.audio.play(cargo.type === 'ordinary' ? 'pickup' : 'pickupRare');
    this.pushDockPopup(cargo.x, cargo.y, '+' + cargo.value);

    if (cargo.type === 'fragile') {
      this.radioMessage = 'Хрупкий заказ пойман до падения';
    } else if (cargo.type === 'urgent') {
      this.radioMessage = 'Срочный заказ обработан';
    } else {
      this.radioMessage = 'Заказ принят';
    }
    this.radioMessageTimer = 0.75;

    this.warehouseOrders.splice(index, 1);
  };

  AzotShiftRunner.prototype.breakFragileCargo = function (index, item, platformIndex) {
    const platform = this.rackPlatforms[platformIndex];
    this.warehouseOrders.splice(index, 1);
    this.shiftStats.fragileBroken += 1;
    this.pushDockPopup(item.x, platform.y - 12, 'x');
    this.radioMessage = 'Хрупкий заказ разбился';
    this.radioMessageTimer = 0.8;
    this.flashTimer = 0.1;
  };

  AzotShiftRunner.prototype.expireUrgentCargo = function (index, item) {
    this.warehouseOrders.splice(index, 1);
    this.shiftStats.urgentExpired += 1;
    this.pushDockPopup(item.x, item.y, '!');
    this.radioMessage = 'Срочный заказ просрочен';
    this.radioMessageTimer = 0.8;
  };

  AzotShiftRunner.prototype.updateWarehouseOrders = function (dt) {
    // Заказы проходят через падение, подбор и штрафные сценарии.
    for (let i = this.warehouseOrders.length - 1; i >= 0; i -= 1) {
      const cargo = this.warehouseOrders[i];
      cargo.pulse += dt * 4.5;
      cargo.bobPhase += dt * 3;

      if (rectsIntersect(this.player, cargo)) {
        this.collectOrderCargo(i);
        continue;
      }

      if (cargo.state === 'falling') {
        const previousY = cargo.y;
        cargo.vy += (GRAVITY - 60) * cargo.gravityScale * dt;
        cargo.vy = Math.min(cargo.vy, cargo.maxFallSpeed);
        cargo.y += cargo.vy * dt;

        const platformIndex = this.getLandingRackIndex(cargo, previousY);
        if (platformIndex >= 0) {
          const platform = this.rackPlatforms[platformIndex];
          cargo.y = platform.y - cargo.h;
          cargo.vy = 0;
          cargo.platformIndex = platformIndex;

          if (cargo.type === 'fragile') {
            if (platformIndex === cargo.fragileBreakPlatformIndex) {
              this.breakFragileCargo(i, cargo, platformIndex);
              continue;
            }

            cargo.y = platform.y - cargo.h + 2;
            cargo.vy = 4;
            cargo.platformIndex = null;
          } else if (platformIndex === cargo.targetStopPlatformIndex) {
            cargo.state = 'grounded';
          } else {
            cargo.y = platform.y - cargo.h + 2;
            cargo.vy = 10;
            cargo.platformIndex = null;
          }
        }

        if (cargo.y > GAME_HEIGHT + 60) {
          this.warehouseOrders.splice(i, 1);
        }
      } else if (cargo.type === 'urgent') {
        cargo.ttl -= dt;
        if (cargo.ttl <= 0) {
          this.expireUrgentCargo(i, cargo);
          continue;
        }
      }
    }
  };

  AzotShiftRunner.prototype.updateEnergyPickups = function (dt) {
    for (let i = this.energyPickups.length - 1; i >= 0; i -= 1) {
      const energyCan = this.energyPickups[i];
      energyCan.ttl -= dt;
      energyCan.bobPhase += dt * 4;

      if (energyCan.ttl <= 0) {
        this.energyPickups.splice(i, 1);
        continue;
      }

      if (rectsIntersect(this.player, energyCan)) {
        this.applyEnergyRush();
        this.energyPickups.splice(i, 1);
        continue;
      }

      for (let patrolIndex = 0; patrolIndex < this.forkliftPatrols.length; patrolIndex += 1) {
        const cart = this.forkliftPatrols[patrolIndex];
        if (cart.platformIndex === energyCan.platformIndex && rectsIntersect(cart, energyCan)) {
          this.energyPickups.splice(i, 1);
          break;
        }
      }
    }
  };

  AzotShiftRunner.prototype.updateForkliftPatrols = function (dt) {
    for (let i = this.forkliftPatrols.length - 1; i >= 0; i -= 1) {
      const cart = this.forkliftPatrols[i];
      cart.x += cart.speed * cart.dir * dt;
      cart.anim += dt * 8;

      if (this.player.invulnerability <= 0 && rectsIntersect(this.player, cart)) {
        this.score = Math.max(0, this.score - 15);
        this.shiftStats.cartHits += 1;
        this.player.invulnerability = 1.1;
        this.player.vx = cart.dir * 220;
        this.player.vy = -200;
        this.flashTimer = 0.18;
        this.radioMessage = 'Тележка сбила заказ';
        this.radioMessageTimer = 0.9;
        this.audio.play('hit');
        this.pushDockPopup(this.player.x, this.player.y - 8, '-15');
      }

      for (let cargoIndex = this.warehouseOrders.length - 1; cargoIndex >= 0; cargoIndex -= 1) {
        const cargo = this.warehouseOrders[cargoIndex];
        if (rectsIntersect(cart, cargo)) {
          const penalty = cargo.type === 'fragile' ? 15 : cargo.type === 'urgent' ? 8 : 5;
          this.warehouseOrders.splice(cargoIndex, 1);
          this.score = Math.max(0, this.score - penalty);
          this.shiftStats.cartCargoLosses += 1;
          if (cargo.type === 'fragile') {
            this.shiftStats.cartFragileLosses += 1;
          } else if (cargo.type === 'urgent') {
            this.shiftStats.cartUrgentLosses += 1;
          } else {
            this.shiftStats.cartOrdinaryLosses += 1;
          }
          if (cargo.type === 'fragile') {
            this.radioMessage = 'Тележка разбила хрупкий заказ';
          } else if (cargo.type === 'urgent') {
            this.radioMessage = 'Тележка увезла срочный заказ';
          } else {
            this.radioMessage = 'Тележка увезла заказ';
          }
          this.radioMessageTimer = 0.85;
          this.pushDockPopup(cargo.x, cargo.y, '-' + penalty);
        }
      }

      if (cart.x < -120 || cart.x > GAME_WIDTH + 120) {
        this.forkliftPatrols.splice(i, 1);
      }
    }
  };

  AzotShiftRunner.prototype.pushDockPopup = function (x, y, text) {
    this.dockPopups.push({
      x: x,
      y: y,
      text: text,
      life: 0.9
    });
  };

  AzotShiftRunner.prototype.readTerminalFontSize = function () {
    const rootStyle = window.getComputedStyle(document.documentElement);
    return parseFloat(rootStyle.getPropertyValue('--ui-font-size')) || 16;
  };

  AzotShiftRunner.prototype.broadcastShiftBoard = function () {
    if (typeof this.options.onShiftBoardUpdate === 'function') {
      this.options.onShiftBoardUpdate({
        pickerName: this.pickerAlias,
        testMode: this.testMode,
        score: this.score,
        timeLeft: this.timeLeft,
        lives: this.lives,
        shiftPassport: this.shiftPassport
      });
    }
  };

  AzotShiftRunner.prototype.drawSprite = function (frameName, x, y, w, h, flip) {
    const frame = AZOT_FRAMES[frameName];
    if (!this.sprites.complete || !frame) {
      return;
    }

    const ctx = this.ctx;
    ctx.save();
    if (flip) {
      ctx.translate(x + w, y);
      ctx.scale(-1, 1);
      ctx.drawImage(this.sprites, frame.sx, frame.sy, frame.sw, frame.sh, 0, 0, w, h);
    } else {
      ctx.drawImage(this.sprites, frame.sx, frame.sy, frame.sw, frame.sh, x, y, w, h);
    }
    ctx.restore();
  };

  AzotShiftRunner.prototype.drawRackPanel = function (ctx, x, y, w, h, palette) {
    const colors = palette || {};
    ctx.save();
    ctx.fillStyle = colors.base || '#273445';
    ctx.fillRect(x, y, w, h);

    ctx.fillStyle = colors.top || 'rgba(214, 230, 238, 0.16)';
    ctx.fillRect(x, y, w, Math.max(3, Math.floor(h * 0.18)));

    ctx.fillStyle = colors.bottom || 'rgba(7, 12, 18, 0.22)';
    ctx.fillRect(x, y + h - Math.max(3, Math.floor(h * 0.2)), w, Math.max(3, Math.floor(h * 0.2)));

    ctx.strokeStyle = colors.stroke || '#5d7484';
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);

    ctx.strokeStyle = colors.innerStroke || 'rgba(13, 24, 36, 0.7)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 4, y + 4, w - 8, h - 8);

    ctx.fillStyle = colors.detail || 'rgba(12, 22, 32, 0.32)';
    ctx.fillRect(x + 8, y + 8, w - 16, h - 16);
    ctx.restore();
  };

  AzotShiftRunner.prototype.drawDockHazard = function (ctx, x, y, w, h, offset) {
    const stripeWidth = 12;
    const shift = ((offset || 0) % (stripeWidth * 2) + (stripeWidth * 2)) % (stripeWidth * 2);
    ctx.save();
    ctx.fillStyle = '#e2ad33';
    ctx.fillRect(x, y, w, h);
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.strokeStyle = '#11151b';
    ctx.lineWidth = 6;

    for (let sx = x - h - stripeWidth * 2 + shift; sx < x + w + h + stripeWidth * 2; sx += stripeWidth * 2) {
      ctx.beginPath();
      ctx.moveTo(sx, y + h);
      ctx.lineTo(sx + h + stripeWidth, y);
      ctx.stroke();
    }
    ctx.restore();
  };

  AzotShiftRunner.prototype.render = function () {
    const ctx = this.ctx;

    ctx.clearRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

    this.renderBackground(ctx);
    this.renderRackPlatforms(ctx);
    this.renderWarehouseOrders(ctx);
    this.renderEnergyPickups(ctx);
    this.renderForkliftPatrols(ctx);
    this.renderPlayer(ctx);
    this.renderDockPopups(ctx);
    this.renderRadioMessage(ctx);

    if (this.flashTimer > 0) {
      ctx.fillStyle = 'rgba(255, 120, 120, 0.16)';
      ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    }
  };

  AzotShiftRunner.prototype.renderBackground = function (ctx) {
    // Фон рисуем слоями, чтобы склад не выглядел плоским.
    ctx.fillStyle = '#0d1116';
    ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

    const bgGradient = ctx.createLinearGradient(0, 0, 0, GAME_HEIGHT);
    bgGradient.addColorStop(0, '#272e34');
    bgGradient.addColorStop(0.22, '#22292f');
    bgGradient.addColorStop(0.62, '#171d23');
    bgGradient.addColorStop(1, '#0f1318');
    ctx.fillStyle = bgGradient;
    ctx.fillRect(0, WORLD_TOP, GAME_WIDTH, GAME_HEIGHT - WORLD_TOP);

    ctx.fillStyle = 'rgba(72, 222, 240, 0.06)';
    ctx.fillRect(0, WORLD_TOP + 24, 90, GAME_HEIGHT - WORLD_TOP - 150);
    ctx.fillRect(GAME_WIDTH - 84, WORLD_TOP + 46, 84, GAME_HEIGHT - WORLD_TOP - 180);

    ctx.fillStyle = 'rgba(24, 31, 39, 0.78)';
    for (let x = 0; x <= GAME_WIDTH; x += 128) {
      ctx.fillRect(x, WORLD_TOP, 10, GAME_HEIGHT - WORLD_TOP);
    }

    ctx.fillStyle = 'rgba(112, 123, 132, 0.1)';
    for (let y = WORLD_TOP + 52; y < FLOOR_Y - 40; y += 118) {
      ctx.fillRect(0, y, GAME_WIDTH, 5);
    }

    if (this.bgTile.complete) {
        const pattern = ctx.createPattern(this.bgTile, 'repeat');
        if (pattern) {
          ctx.save();
          ctx.translate(-this.warehouseDrift, 0);
          ctx.globalAlpha = 0.06;
          ctx.fillStyle = pattern;
          ctx.fillRect(this.warehouseDrift - 64, WORLD_TOP, GAME_WIDTH + 128, GAME_HEIGHT - WORLD_TOP);
          ctx.restore();
        }
      }

    for (let i = 0; i < 7; i += 1) {
      const lampX = 72 + i * 142;
      const blink = 0.55 + 0.45 * Math.sin((this.warehouseDrift * 0.05) + i);
      ctx.fillStyle = 'rgba(135, 249, 255,' + (0.06 + blink * 0.05).toFixed(3) + ')';
      ctx.fillRect(lampX - 26, WORLD_TOP + 20, 52, 18);
      this.drawRackPanel(ctx, lampX - 30, WORLD_TOP + 14, 60, 30, {
        base: '#47545b',
        top: 'rgba(236, 243, 247, 0.18)',
        bottom: 'rgba(13, 18, 24, 0.32)',
        stroke: '#605851',
        innerStroke: 'rgba(31, 44, 51, 0.72)',
        detail: 'rgba(16, 27, 37, 0.38)'
      });
    }

    const lightWidth = 74;
    const lightSpacing = 126;
    const lightOffset = (this.warehouseDrift * 0.4) % lightSpacing;
    for (let x = -lightWidth - lightOffset; x < GAME_WIDTH + lightWidth; x += lightSpacing) {
      ctx.fillStyle = 'rgba(150, 235, 244, 0.03)';
      ctx.fillRect(x, WORLD_TOP + 86, lightWidth, 6);
      ctx.fillStyle = 'rgba(71, 212, 232, 0.05)';
      ctx.fillRect(x + 12, WORLD_TOP + 84, lightWidth - 24, 2);
    }

    for (let y = WORLD_TOP + 128; y < FLOOR_Y - 36; y += 156) {
      for (let x = 22; x < GAME_WIDTH - 90; x += 192) {
        this.drawRackPanel(ctx, x, y, 112, 76, {
          base: '#2b343c',
          top: 'rgba(223, 232, 236, 0.12)',
          bottom: 'rgba(12, 18, 24, 0.28)',
          stroke: '#536673',
          innerStroke: 'rgba(24, 35, 44, 0.72)',
          detail: 'rgba(17, 25, 33, 0.32)'
        });
      }
    }

    for (let pipeY = WORLD_TOP + 142; pipeY < FLOOR_Y - 60; pipeY += 148) {
      ctx.fillStyle = '#7e8a90';
      ctx.fillRect(0, pipeY, GAME_WIDTH, 6);
      ctx.fillStyle = 'rgba(56, 64, 70, 0.45)';
      ctx.fillRect(0, pipeY + 4, GAME_WIDTH, 2);
    }

    for (let pipeX = 116; pipeX < GAME_WIDTH; pipeX += 256) {
      ctx.fillStyle = '#848f95';
      ctx.fillRect(pipeX, WORLD_TOP, 6, FLOOR_Y - WORLD_TOP - 16);
      ctx.fillStyle = 'rgba(58, 67, 74, 0.48)';
      ctx.fillRect(pipeX + 4, WORLD_TOP, 2, FLOOR_Y - WORLD_TOP - 16);
    }

    this.drawRackPanel(ctx, 0, FLOOR_Y - 22, GAME_WIDTH, 22, {
      base: '#39444d',
      top: 'rgba(214, 226, 231, 0.22)',
      bottom: 'rgba(10, 14, 18, 0.34)',
      stroke: '#6d7f89',
      innerStroke: 'rgba(27, 36, 46, 0.8)',
      detail: 'rgba(22, 32, 41, 0.36)'
    });
    this.drawDockHazard(ctx, 0, FLOOR_Y - 18, GAME_WIDTH, 10, this.warehouseDrift * 0.15);

    const floorGradient = ctx.createLinearGradient(0, FLOOR_Y, 0, GAME_HEIGHT);
    floorGradient.addColorStop(0, '#1a222b');
    floorGradient.addColorStop(1, '#0d1116');
    ctx.fillStyle = floorGradient;
    ctx.fillRect(0, FLOOR_Y, GAME_WIDTH, GAME_HEIGHT - FLOOR_Y);
  };

  AzotShiftRunner.prototype.renderRackPlatforms = function (ctx) {
    for (let i = 1; i < this.rackPlatforms.length; i += 1) {
      const p = this.rackPlatforms[i];
      this.drawRackPanel(ctx, p.x, p.y, p.w, p.h, {
        base: '#70808d',
        top: 'rgba(228, 237, 241, 0.18)',
        bottom: 'rgba(18, 23, 29, 0.34)',
        stroke: '#93a5b1',
        innerStroke: 'rgba(40, 53, 65, 0.82)',
        detail: 'rgba(40, 56, 71, 0.28)'
      });

      const accentGradient = ctx.createLinearGradient(p.x, p.y, p.x, p.y + p.h);
      accentGradient.addColorStop(0, 'rgba(186, 106, 62, 0.28)');
      accentGradient.addColorStop(1, 'rgba(126, 74, 47, 0.08)');
      ctx.fillStyle = accentGradient;
      ctx.fillRect(p.x + 10, p.y + 3, Math.max(20, p.w - 20), 3);

      for (let x = p.x + 16; x < p.x + p.w - 14; x += 44) {
        ctx.fillStyle = 'rgba(219, 232, 238, 0.16)';
        ctx.fillRect(x, p.y + 6, 22, 2);
      }

      for (let x = p.x + 20; x < p.x + p.w - 18; x += 72) {
        ctx.fillStyle = 'rgba(164, 94, 56, 0.55)';
        ctx.fillRect(x, p.y + p.h - 5, 18, 2);
        ctx.fillStyle = 'rgba(216, 171, 132, 0.18)';
        ctx.fillRect(x, p.y + p.h - 7, 18, 1);
      }

      if (i !== 1) {
        ctx.fillStyle = 'rgba(30, 39, 48, 0.65)';
        ctx.fillRect(p.x + 12, p.y + p.h, 10, 12);
        ctx.fillRect(p.x + p.w - 22, p.y + p.h, 10, 12);
      }
    }
  };

  AzotShiftRunner.prototype.renderSingleOrder = function (ctx, cargo) {
    const isUrgent = cargo.type === 'urgent';
    const isFragile = cargo.type === 'fragile';
    const pulse = 0.75 + 0.25 * Math.sin(cargo.pulse);

    if (isFragile) {
      this.drawSprite('glassCrate', cargo.x, cargo.y, cargo.w, cargo.h, false);
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 176, 220, 0.8)';
      ctx.lineWidth = 2;
      ctx.strokeRect(cargo.x - 1, cargo.y - 1, cargo.w + 2, cargo.h + 2);
      ctx.restore();
      return;
    }

    this.drawSprite(isUrgent ? 'rushInvoice' : 'stockCrate', cargo.x, cargo.y, cargo.w, cargo.h, false);

    if (isUrgent) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 191, 89,' + pulse.toFixed(3) + ')';
      ctx.lineWidth = 2;
      ctx.strokeRect(cargo.x - 2, cargo.y - 2, cargo.w + 4, cargo.h + 4);
      const ttlRatio = clamp(cargo.ttl / 5, 0, 1);
      ctx.fillStyle = 'rgba(255, 179, 71, 0.85)';
      ctx.fillRect(cargo.x, cargo.y - 6, cargo.w * ttlRatio, 3);
      ctx.restore();
    }
  };

  AzotShiftRunner.prototype.renderWarehouseOrders = function (ctx) {
    for (let i = 0; i < this.warehouseOrders.length; i += 1) {
      const cargo = this.warehouseOrders[i];
      const bob = cargo.state === 'grounded' ? Math.sin(cargo.bobPhase) * 2 : 0;

      ctx.fillStyle = 'rgba(255, 232, 150, 0.15)';
      ctx.beginPath();
      ctx.ellipse(cargo.x + cargo.w / 2, cargo.y + cargo.h + 8 + bob, cargo.w / 1.1, 5, 0, 0, Math.PI * 2);
      ctx.fill();

      this.renderSingleOrder(ctx, {
        x: cargo.x,
        y: cargo.y + bob,
        w: cargo.w,
        h: cargo.h,
        type: cargo.type,
        ttl: cargo.ttl,
        pulse: cargo.pulse
      });
    }
  };

  AzotShiftRunner.prototype.renderEnergyPickups = function (ctx) {
    for (let i = 0; i < this.energyPickups.length; i += 1) {
      const energyCan = this.energyPickups[i];
      const bob = Math.sin(energyCan.bobPhase) * 2.5;

      ctx.fillStyle = 'rgba(108, 255, 187, 0.18)';
      ctx.beginPath();
      ctx.ellipse(energyCan.x + energyCan.w / 2, energyCan.y + energyCan.h + 8 + bob, energyCan.w / 1.3, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      this.drawSprite('energyCan', energyCan.x, energyCan.y + bob, energyCan.w, energyCan.h, false);
    }
  };

  AzotShiftRunner.prototype.renderForkliftPatrols = function (ctx) {
    for (let i = 0; i < this.forkliftPatrols.length; i += 1) {
      const cart = this.forkliftPatrols[i];
      const frame = Math.floor(cart.anim) % 2 === 0 ? 'cart1' : 'cart2';
      this.drawSprite(frame, cart.x, cart.y, cart.w, cart.h, cart.dir < 0);
    }
  };

  AzotShiftRunner.prototype.getPlayerDrawRect = function () {
    const player = this.player;
    const frame = AZOT_FRAMES[player.frameIndex] || AZOT_FRAMES.playerIdle;
    return {
      x: player.x + (frame.ox || 0),
      y: player.y + (frame.oy || 0),
      w: frame.rw || player.w,
      h: frame.rh || player.h
    };
  };

  AzotShiftRunner.prototype.renderPlayer = function (ctx) {
    const player = this.player;
    const draw = this.getPlayerDrawRect();
    if (player.invulnerability > 0 && Math.floor(player.invulnerability * 14) % 2 === 0) {
      return;
    }
    this.drawSprite(
      player.frameIndex,
      draw.x,
      draw.y,
      draw.w,
      draw.h,
      player.facing < 0
    );

    if (player.boostTimer > 0) {
      const boostRatio = clamp(player.boostTimer / BOOST_DURATION, 0, 1);
      ctx.save();
      ctx.strokeStyle = 'rgba(82, 255, 123, 0.68)';
      ctx.lineWidth = 2;
      ctx.strokeRect(draw.x - 3, draw.y - 3, draw.w + 6, draw.h + 6);
      ctx.fillStyle = 'rgba(75, 255, 162, 0.85)';
      ctx.fillRect(draw.x, draw.y - 8, draw.w * boostRatio, 4);
      ctx.restore();
    }

    if (this.testMode) {
      ctx.fillStyle = 'rgba(120, 184, 255, 0.12)';
      ctx.fillRect(draw.x - 10, draw.y - 18, 58, 16);
      ctx.fillStyle = '#eaf5ff';
      ctx.font = Math.max(10, Math.round(this.readTerminalFontSize() * 0.75)) + 'px Segoe UI';
      ctx.fillText('TEST', draw.x, draw.y - 6);
    }
  };

  AzotShiftRunner.prototype.renderDockPopups = function (ctx) {
    ctx.save();
    ctx.font = 'bold ' + Math.round(this.readTerminalFontSize() * 1.125) + 'px Segoe UI';
    ctx.textAlign = 'center';

    for (let i = 0; i < this.dockPopups.length; i += 1) {
      const popup = this.dockPopups[i];
      const alpha = clamp(popup.life, 0, 1);
      ctx.fillStyle = popup.text.indexOf('-') === 0
        ? 'rgba(255, 132, 132,' + alpha.toFixed(3) + ')'
        : 'rgba(173, 255, 202,' + alpha.toFixed(3) + ')';
      ctx.fillText(popup.text, popup.x + 12, popup.y);
    }

    ctx.restore();
  };

  AzotShiftRunner.prototype.renderRadioMessage = function (ctx) {
    if (!this.radioMessage) {
      return;
    }

    ctx.save();
    this.drawRackPanel(ctx, 314, 84, 396, 48, {
      base: 'rgba(39, 49, 60, 0.95)',
      top: 'rgba(219, 231, 236, 0.18)',
      bottom: 'rgba(11, 16, 21, 0.35)',
      stroke: 'rgba(109, 134, 145, 0.88)',
      innerStroke: 'rgba(23, 32, 40, 0.9)',
      detail: 'rgba(16, 24, 31, 0.4)'
    });
    const statusGlow = ctx.createLinearGradient(314, 84, 710, 84);
    statusGlow.addColorStop(0, 'rgba(101, 215, 232, 0.2)');
    statusGlow.addColorStop(0.5, 'rgba(255, 255, 255, 0.02)');
    statusGlow.addColorStop(1, 'rgba(101, 215, 232, 0.12)');
    ctx.fillStyle = statusGlow;
    ctx.fillRect(320, 90, 384, 4);
    ctx.fillStyle = '#eff9fb';
    ctx.font = '600 ' + Math.round(this.readTerminalFontSize() * 1.25) + 'px Segoe UI';
    ctx.textAlign = 'center';
    ctx.fillText(this.radioMessage, 512, 114);
    ctx.restore();
  };

  window.AZOTGame = {
    AzotShiftRunner: AzotShiftRunner
  };
})();
