(function () {
  const GAME_WIDTH = 1024;
  const GAME_HEIGHT = 768;
  const HUD_HEIGHT = 86;
  const WORLD_TOP = HUD_HEIGHT;
  const FLOOR_Y = 710;
  const GRAVITY = 1500;
  const SPRITES = {
    playerIdle: { sx: 2, sy: 1, sw: 14, sh: 30, rw: 25, rh: 55, ox: 0, oy: 0 },
    playerWalk1: { sx: 18, sy: 1, sw: 16, sh: 30, rw: 26, rh: 55, ox: -1, oy: 0 },
    playerWalk2: { sx: 36, sy: 1, sw: 15, sh: 30, rw: 25, rh: 55, ox: 0, oy: 0 },
    playerJump: { sx: 52, sy: 1, sw: 18, sh: 29, rw: 30, rh: 57, ox: -2, oy: -2 },
    box: { sx: 77, sy: 13, sw: 20, sh: 18 },
    paper: { sx: 101, sy: 8, sw: 17, sh: 23 },
    fragile: { sx: 120, sy: 13, sw: 20, sh: 18 },
    energy: { sx: 147, sy: 12, sw: 12, sh: 19 },
    cart1: { sx: 167, sy: 13, sw: 25, sh: 18 },
    cart2: { sx: 198, sy: 13, sw: 25, sh: 18 }
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

  function StorageRunner(canvas, options) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.options = options;
    this.audio = options.audio;
    this.sprites = new Image();
    this.sprites.src = 'assets/sprites.png';
    this.bgTile = new Image();
    this.bgTile.src = 'assets/bg-tile.png';

    this.lastTimestamp = 0;
    this.bgOffset = 0;
    this.running = false;
    this.finished = false;
    this.paused = false;
    this.playerName = 'Игрок';
    this.testMode = false;
    this.score = 0;
    this.timeLeft = 90;
    this.runTime = 0;
    this.orderSpawnTimer = 0;
    this.cartSpawnTimer = 0;
    this.bonusSpawnTimer = 0;
    this.cartCounter = 0;

    this.input = {
      left: false,
      right: false,
      down: false,
      jumpQueued: false
    };

    this.flashTimer = 0;
    this.statusText = '';
    this.statusTimer = 0;
    this.floaters = [];

    this.player = null;
    this.platforms = [];
    this.cartLanes = [];
    this.carts = [];
    this.collectibles = [];
    this.bonuses = [];

    this.boundLoop = this.loop.bind(this);
    this.handleKeyDown = this.onKeyDown.bind(this);
    this.handleKeyUp = this.onKeyUp.bind(this);
  }

  StorageRunner.prototype.start = function (playerName, testMode) {
    this.playerName = playerName;
    this.testMode = !!testMode;
    this.running = true;
    this.finished = false;
    this.paused = false;
    this.lastTimestamp = 0;
    this.bgOffset = 0;
    this.score = 0;
    this.timeLeft = 90;
    this.runTime = 0;
    this.orderSpawnTimer = 0.5;
    this.cartSpawnTimer = 1.2;
    this.bonusSpawnTimer = 8;
    this.cartCounter = 0;
    this.flashTimer = 0;
    this.statusText = this.testMode ? 'TEST MODE' : 'Смена началась';
    this.statusTimer = 1.4;
    this.floaters = [];

    this.setupLevel();

    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);

    this.audio.startAmbient();
    this.updateHud();
    window.requestAnimationFrame(this.boundLoop);
  };

  StorageRunner.prototype.stop = function () {
    this.running = false;
    this.audio.stopAmbient();
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
  };

  StorageRunner.prototype.setupLevel = function () {
    this.platforms = [
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
      invulnerability: 0,
      boostTimer: 0,
      supportPlatformIndex: -1,
      dropThroughPlatformIndex: -1,
      dropResumeY: 0,
      frameTime: 0,
      frameIndex: 'playerIdle',
      facing: 1
    };

    this.cartLanes = [];
    for (let i = 1; i < this.platforms.length; i += 1) {
      const platform = this.platforms[i];
      if (platform.w >= 180) {
        this.cartLanes.push({
          platformIndex: i,
          y: platform.y - 40
        });
      }
    }

    this.carts = [];
    this.collectibles = [];
    this.bonuses = [];

    for (let i = 0; i < 4; i += 1) {
      this.spawnOrderFromTop();
    }
  };

  StorageRunner.prototype.getDifficulty = function () {
    return clamp(this.runTime / 90, 0, 1);
  };

  StorageRunner.prototype.getTargetActiveOrders = function () {
    return 4 + Math.floor(this.getDifficulty() * 3);
  };

  StorageRunner.prototype.chooseOrderType = function () {
    const difficulty = this.getDifficulty();
    const fragileChance = 0.08 + difficulty * 0.18;
    const urgentChance = 0.18 + difficulty * 0.20;
    const roll = Math.random();

    if (roll < fragileChance) {
      return 'fragile';
    }
    if (roll < fragileChance + urgentChance) {
      return 'urgent';
    }
    return 'ordinary';
  };

  StorageRunner.prototype.getPlatformsUnderX = function (x, width) {
    const result = [];

    for (let i = 1; i < this.platforms.length; i += 1) {
      const platform = this.platforms[i];
      const horizontalOverlap = x + width > platform.x && x < platform.x + platform.w;
      if (horizontalOverlap) {
        result.push(i);
      }
    }

    result.sort(function (a, b) {
      return this.platforms[a].y - this.platforms[b].y;
    }.bind(this));

    return result.length ? result : [1];
  };

  StorageRunner.prototype.createOrder = function (type, targetPlatformIndex) {
    const platform = this.platforms[targetPlatformIndex];
    const sizeMap = {
      ordinary: { w: 30, h: 28, value: 10, gravityScale: 1, maxFallSpeed: 960 },
      urgent: { w: 24, h: 33, value: 20, gravityScale: 1, maxFallSpeed: 980 },
      fragile: { w: 31, h: 29, value: 30, gravityScale: 0.22, maxFallSpeed: 150 }
    };
    const data = sizeMap[type];
    const x = platform.x + 20 + Math.random() * Math.max(20, platform.w - data.w - 40);
    const supportedPlatforms = this.getPlatformsUnderX(x, data.w);
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
      ttl: type === 'urgent' ? 5 : 0,
      bobPhase: Math.random() * Math.PI * 2,
      pulse: Math.random() * Math.PI * 2,
      gravityScale: data.gravityScale,
      maxFallSpeed: data.maxFallSpeed,
      fragileBreakPlatformIndex: fragileBreakPlatformIndex
    };
  };

  StorageRunner.prototype.spawnOrderFromTop = function () {
    const availablePlatforms = this.platforms.slice(1);
    const targetPlatform = availablePlatforms[Math.floor(Math.random() * availablePlatforms.length)];
    const targetPlatformIndex = this.platforms.indexOf(targetPlatform);
    const type = this.chooseOrderType();
    this.collectibles.push(this.createOrder(type, targetPlatformIndex));
  };

  StorageRunner.prototype.spawnEnergyBonus = function () {
    const platformIndex = 1 + Math.floor(Math.random() * (this.platforms.length - 1));
    const platform = this.platforms[platformIndex];
    this.bonuses.push({
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

  StorageRunner.prototype.applyEnergyBoost = function () {
    this.player.boostTimer = 5;
    this.player.speed = this.player.baseSpeed + 85;
    this.player.maxAirJumps = 1;
    this.player.airJumpsLeft = Math.max(this.player.airJumpsLeft, 1);
    this.statusText = 'Энергетик: ускорение и двойной прыжок';
    this.statusTimer = 1.1;
    this.pushFloater(this.player.x, this.player.y - 10, 'BOOST');
    this.audio.play('pickupRare');
  };

  StorageRunner.prototype.spawnCart = function () {
    const difficulty = this.getDifficulty();
    const lane = this.cartLanes[Math.floor(Math.random() * this.cartLanes.length)];
    const fromLeft = Math.random() < 0.5;
    const baseSpeed = 170 + difficulty * 80;

    this.carts.push({
      id: this.cartCounter,
      x: fromLeft ? -72 : GAME_WIDTH + 72,
      y: lane.y,
      w: 54,
      h: 42,
      speed: baseSpeed + Math.random() * 35,
      dir: fromLeft ? 1 : -1,
      platformIndex: lane.platformIndex,
      anim: 0
    });

    this.cartCounter += 1;
  };

  StorageRunner.prototype.beginDropThrough = function () {
    const player = this.player;
    if (!player.onGround || player.supportPlatformIndex <= 0) {
      return;
    }

    const platform = this.platforms[player.supportPlatformIndex];
    player.dropThroughPlatformIndex = player.supportPlatformIndex;
    player.dropResumeY = platform.y + platform.h + 8;
    player.supportPlatformIndex = -1;
    player.onGround = false;
    player.y += 4;
    player.vy = Math.max(player.vy, 90);
  };

  StorageRunner.prototype.onKeyDown = function (event) {
    if (!this.running || this.finished) {
      return;
    }

    if (event.code === 'ArrowLeft' || event.code === 'KeyA') {
      this.input.left = true;
    } else if (event.code === 'ArrowRight' || event.code === 'KeyD') {
      this.input.right = true;
    } else if (event.code === 'ArrowDown' || event.code === 'KeyS') {
      this.input.down = true;
      this.beginDropThrough();
    } else if (event.code === 'ArrowUp' || event.code === 'KeyW') {
      if (!event.repeat) {
        this.input.jumpQueued = true;
      }
    } else if ((event.code === 'Space' || event.code === 'KeyP') && !event.repeat) {
      event.preventDefault();
      this.togglePause();
    }
  };

  StorageRunner.prototype.onKeyUp = function (event) {
    if (event.code === 'ArrowLeft' || event.code === 'KeyA') {
      this.input.left = false;
    } else if (event.code === 'ArrowRight' || event.code === 'KeyD') {
      this.input.right = false;
    } else if (event.code === 'ArrowDown' || event.code === 'KeyS') {
      this.input.down = false;
    }
  };

  StorageRunner.prototype.togglePause = function () {
    if (!this.running || this.finished) {
      return;
    }
    this.paused = !this.paused;
    if (typeof this.options.onPauseChange === 'function') {
      this.options.onPauseChange(this.paused);
    }
  };

  StorageRunner.prototype.finishRun = function (reason) {
    if (this.finished) {
      return;
    }

    this.finished = true;
    this.running = false;
    this.audio.stopAmbient();
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);

    if (typeof this.options.onFinish === 'function') {
      this.options.onFinish({
        playerName: this.playerName,
        score: this.score,
        testMode: this.testMode,
        reason: reason || 'complete'
      });
    }
  };

  StorageRunner.prototype.loop = function (timestamp) {
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
    this.updateHud();

    if (this.running) {
      window.requestAnimationFrame(this.boundLoop);
    }
  };

  StorageRunner.prototype.update = function (dt) {
    this.bgOffset += dt * (this.paused ? 18 : 48);

    if (this.statusTimer > 0) {
      this.statusTimer -= dt;
      if (this.statusTimer <= 0) {
        this.statusText = '';
      }
    }

    this.floaters = this.floaters.filter(function (floater) {
      floater.life -= dt;
      floater.y -= dt * 34;
      return floater.life > 0;
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
        this.statusText = 'Энергетик закончился';
        this.statusTimer = 0.8;
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

    this.orderSpawnTimer -= dt;
    if (this.orderSpawnTimer <= 0 && this.collectibles.length < this.getTargetActiveOrders()) {
      this.spawnOrderFromTop();
      this.orderSpawnTimer = 1.2 - this.getDifficulty() * 0.55 + Math.random() * 0.35;
    }

    this.cartSpawnTimer -= dt;
    if (this.cartSpawnTimer <= 0 && this.carts.length < 2 + Math.floor(this.getDifficulty() * 3)) {
      this.spawnCart();
      this.cartSpawnTimer = 3.3 - this.getDifficulty() * 1.6 + Math.random() * 0.5;
    }

    this.bonusSpawnTimer -= dt;
    if (this.bonusSpawnTimer <= 0 && this.bonuses.length < 1) {
      this.spawnEnergyBonus();
      this.bonusSpawnTimer = 14 + Math.random() * 6;
    }

    this.updatePlayer(dt);
    if (!this.running) {
      return;
    }
    this.updateOrders(dt);
    this.updateBonuses(dt);
    this.updateCarts(dt);
  };

  StorageRunner.prototype.updatePlayer = function (dt) {
    const player = this.player;

    player.vx = 0;
    if (this.input.left) {
      player.vx = -player.speed;
      player.facing = -1;
    }
    if (this.input.right) {
      player.vx = player.speed;
      player.facing = 1;
    }

    if (this.input.jumpQueued) {
      if (player.onGround) {
        player.vy = -player.jumpForce;
        player.onGround = false;
        player.supportPlatformIndex = -1;
        this.audio.play('jump');
      } else if (player.airJumpsLeft > 0) {
        player.vy = -player.jumpForce;
        player.airJumpsLeft -= 1;
        this.audio.play('jump');
        this.pushFloater(player.x, player.y - 6, 'x2');
      }
    }
    this.input.jumpQueued = false;

    player.vy += GRAVITY * dt;
    player.invulnerability = Math.max(0, player.invulnerability - dt);

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
    player.y += player.vy * dt;
    player.onGround = false;
    player.supportPlatformIndex = -1;

    for (let i = 1; i < this.platforms.length; i += 1) {
      if (i === player.dropThroughPlatformIndex) {
        continue;
      }

      const platform = this.platforms[i];
      const wasAbove = previousY + player.h <= platform.y;
      const nowIntersect = rectsIntersect(player, platform);
      if (wasAbove && nowIntersect && player.vy >= 0) {
        player.y = platform.y - player.h;
        player.vy = 0;
        player.onGround = true;
        player.supportPlatformIndex = i;
        player.airJumpsLeft = player.maxAirJumps;
        break;
      }
    }

    if (player.onGround && this.input.down && player.supportPlatformIndex > 0) {
      this.beginDropThrough();
    }

    if (player.y > GAME_HEIGHT + 24) {
      if (this.testMode) {
        player.y = 530;
        player.vy = 0;
        player.x = 90;
        player.dropThroughPlatformIndex = -1;
        player.supportPlatformIndex = -1;
        player.airJumpsLeft = player.maxAirJumps;
        this.score = Math.max(0, this.score - 10);
        this.audio.play('hit');
        this.pushFloater(player.x, player.y, '-10');
        this.flashTimer = 0.2;
        this.statusText = 'Тестовый сброс после падения';
        this.statusTimer = 0.9;
      } else {
        this.statusText = 'Падение вниз уровня';
        this.statusTimer = 1.2;
        this.finishRun('fall');
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

  StorageRunner.prototype.getLandingPlatformIndex = function (item, previousY) {
    let landedPlatformIndex = -1;
    let landedPlatformY = Infinity;

    for (let i = 1; i < this.platforms.length; i += 1) {
      const platform = this.platforms[i];
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

  StorageRunner.prototype.collectItem = function (index) {
    const item = this.collectibles[index];
    if (!item) {
      return;
    }

    this.score += item.value;
    this.audio.play(item.type === 'ordinary' ? 'pickup' : 'pickupRare');
    this.pushFloater(item.x, item.y, '+' + item.value);

    if (item.type === 'fragile') {
      this.statusText = 'Хрупкий заказ пойман до падения';
    } else if (item.type === 'urgent') {
      this.statusText = 'Срочный заказ обработан';
    } else {
      this.statusText = 'Заказ принят';
    }
    this.statusTimer = 0.75;

    this.collectibles.splice(index, 1);
  };

  StorageRunner.prototype.breakFragileOrder = function (index, item, platformIndex) {
    const platform = this.platforms[platformIndex];
    this.collectibles.splice(index, 1);
    this.pushFloater(item.x, platform.y - 12, 'x');
    this.statusText = 'Хрупкий заказ разбился';
    this.statusTimer = 0.8;
    this.flashTimer = 0.1;
  };

  StorageRunner.prototype.expireUrgentOrder = function (index, item) {
    this.collectibles.splice(index, 1);
    this.pushFloater(item.x, item.y, '!');
    this.statusText = 'Срочный заказ просрочен';
    this.statusTimer = 0.8;
  };

  StorageRunner.prototype.updateOrders = function (dt) {
    for (let i = this.collectibles.length - 1; i >= 0; i -= 1) {
      const item = this.collectibles[i];
      item.pulse += dt * 4.5;
      item.bobPhase += dt * 3;

      if (rectsIntersect(this.player, item)) {
        this.collectItem(i);
        continue;
      }

      if (item.state === 'falling') {
        const previousY = item.y;
        item.vy += (GRAVITY - 60) * item.gravityScale * dt;
        item.vy = Math.min(item.vy, item.maxFallSpeed);
        item.y += item.vy * dt;

        const platformIndex = this.getLandingPlatformIndex(item, previousY);
        if (platformIndex >= 0) {
          const platform = this.platforms[platformIndex];
          item.y = platform.y - item.h;
          item.vy = 0;
          item.platformIndex = platformIndex;

          if (item.type === 'fragile') {
            if (platformIndex === item.fragileBreakPlatformIndex) {
              this.breakFragileOrder(i, item, platformIndex);
              continue;
            }

            item.y = platform.y - item.h + 2;
            item.vy = 4;
            item.platformIndex = null;
          } else if (platformIndex === item.targetStopPlatformIndex) {
            item.state = 'grounded';
          } else {
            item.y = platform.y - item.h + 2;
            item.vy = 10;
            item.platformIndex = null;
          }
        }

        if (item.y > GAME_HEIGHT + 60) {
          this.collectibles.splice(i, 1);
        }
      } else if (item.type === 'urgent') {
        item.ttl -= dt;
        if (item.ttl <= 0) {
          this.expireUrgentOrder(i, item);
          continue;
        }
      }
    }
  };

  StorageRunner.prototype.updateBonuses = function (dt) {
    for (let i = this.bonuses.length - 1; i >= 0; i -= 1) {
      const bonus = this.bonuses[i];
      bonus.ttl -= dt;
      bonus.bobPhase += dt * 4;

      if (bonus.ttl <= 0) {
        this.bonuses.splice(i, 1);
        continue;
      }

      if (rectsIntersect(this.player, bonus)) {
        this.applyEnergyBoost();
        this.bonuses.splice(i, 1);
        continue;
      }

      for (let cartIndex = 0; cartIndex < this.carts.length; cartIndex += 1) {
        const cart = this.carts[cartIndex];
        if (cart.platformIndex === bonus.platformIndex && rectsIntersect(cart, bonus)) {
          this.bonuses.splice(i, 1);
          break;
        }
      }
    }
  };

  StorageRunner.prototype.updateCarts = function (dt) {
    for (let i = this.carts.length - 1; i >= 0; i -= 1) {
      const cart = this.carts[i];
      cart.x += cart.speed * cart.dir * dt;
      cart.anim += dt * 8;

      if (this.player.invulnerability <= 0 && rectsIntersect(this.player, cart)) {
        this.score = Math.max(0, this.score - 15);
        this.player.invulnerability = 1.1;
        this.player.vx = cart.dir * 220;
        this.player.vy = -200;
        this.flashTimer = 0.18;
        this.statusText = 'Тележка сбила заказ';
        this.statusTimer = 0.9;
        this.audio.play('hit');
        this.pushFloater(this.player.x, this.player.y - 8, '-15');
      }

      for (let itemIndex = this.collectibles.length - 1; itemIndex >= 0; itemIndex -= 1) {
        const item = this.collectibles[itemIndex];
        if (rectsIntersect(cart, item)) {
          const penalty = item.type === 'urgent' ? 8 : 5;
          this.collectibles.splice(itemIndex, 1);
          this.score = Math.max(0, this.score - penalty);
          this.statusText = item.type === 'urgent'
            ? 'Тележка увезла срочный заказ'
            : 'Тележка увезла заказ';
          this.statusTimer = 0.85;
          this.pushFloater(item.x, item.y, '-' + penalty);
        }
      }

      if (cart.x < -120 || cart.x > GAME_WIDTH + 120) {
        this.carts.splice(i, 1);
      }
    }
  };

  StorageRunner.prototype.pushFloater = function (x, y, text) {
    this.floaters.push({
      x: x,
      y: y,
      text: text,
      life: 0.9
    });
  };

  StorageRunner.prototype.updateHud = function () {
    if (typeof this.options.onHudUpdate === 'function') {
      this.options.onHudUpdate({
        playerName: this.playerName,
        testMode: this.testMode,
        score: this.score,
        timeLeft: this.timeLeft
      });
    }
  };

  StorageRunner.prototype.drawSprite = function (frameName, x, y, w, h, flip) {
    const frame = SPRITES[frameName];
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

  StorageRunner.prototype.render = function () {
    const ctx = this.ctx;

    ctx.clearRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

    this.renderBackground(ctx);
    this.renderPlatforms(ctx);
    this.renderItems(ctx);
    this.renderBonuses(ctx);
    this.renderCarts(ctx);
    this.renderPlayer(ctx);
    this.renderFloaters(ctx);
    this.renderStatus(ctx);

    if (this.flashTimer > 0) {
      ctx.fillStyle = 'rgba(255, 120, 120, 0.16)';
      ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    }
  };

  StorageRunner.prototype.renderBackground = function (ctx) {
    ctx.fillStyle = '#0a1526';
    ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

    if (this.bgTile.complete) {
      const pattern = ctx.createPattern(this.bgTile, 'repeat');
      if (pattern) {
        ctx.save();
        ctx.translate(-this.bgOffset, 0);
        ctx.fillStyle = pattern;
        ctx.fillRect(this.bgOffset - 64, WORLD_TOP, GAME_WIDTH + 128, GAME_HEIGHT - WORLD_TOP);
        ctx.restore();
      }
    }

    for (let i = 0; i < 8; i += 1) {
      const lampX = 90 + i * 115;
      const blink = 0.55 + 0.45 * Math.sin((this.bgOffset * 0.05) + i);
      ctx.fillStyle = 'rgba(123, 192, 255,' + (0.25 + blink * 0.2).toFixed(3) + ')';
      ctx.beginPath();
      ctx.arc(lampX, WORLD_TOP + 36, 6, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = 'rgba(255,255,255,0.03)';
    for (let i = 0; i < 12; i += 1) {
      const x = ((i * 120) + this.bgOffset * 0.4) % (GAME_WIDTH + 80) - 40;
      ctx.fillRect(x, WORLD_TOP + 74, 80, 8);
    }

    ctx.fillStyle = '#10213b';
    ctx.fillRect(0, FLOOR_Y - 10, GAME_WIDTH, 10);
    ctx.fillStyle = '#2b0e18';
    ctx.fillRect(0, FLOOR_Y, GAME_WIDTH, GAME_HEIGHT - FLOOR_Y);
    ctx.fillStyle = 'rgba(255, 86, 86, 0.55)';
    ctx.fillRect(0, FLOOR_Y + 4, GAME_WIDTH, 4);
  };

  StorageRunner.prototype.renderPlatforms = function (ctx) {
    for (let i = 1; i < this.platforms.length; i += 1) {
      const p = this.platforms[i];
      ctx.fillStyle = '#193052';
      ctx.fillRect(p.x, p.y, p.w, p.h);
      ctx.fillStyle = '#2e5189';
      ctx.fillRect(p.x, p.y, p.w, 4);
      for (let x = p.x + 12; x < p.x + p.w - 12; x += 34) {
        ctx.fillStyle = 'rgba(255,255,255,0.06)';
        ctx.fillRect(x, p.y + 6, 18, 7);
      }
    }
  };

  StorageRunner.prototype.renderSingleOrder = function (ctx, item) {
    const isUrgent = item.type === 'urgent';
    const isFragile = item.type === 'fragile';
    const pulse = 0.75 + 0.25 * Math.sin(item.pulse);

    if (isFragile) {
      this.drawSprite('fragile', item.x, item.y, item.w, item.h, false);
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 176, 220, 0.8)';
      ctx.lineWidth = 2;
      ctx.strokeRect(item.x - 1, item.y - 1, item.w + 2, item.h + 2);
      ctx.restore();
      return;
    }

    this.drawSprite(isUrgent ? 'paper' : 'box', item.x, item.y, item.w, item.h, false);

    if (isUrgent) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 191, 89,' + pulse.toFixed(3) + ')';
      ctx.lineWidth = 2;
      ctx.strokeRect(item.x - 2, item.y - 2, item.w + 4, item.h + 4);
      const ttlRatio = clamp(item.ttl / 5, 0, 1);
      ctx.fillStyle = 'rgba(255, 179, 71, 0.85)';
      ctx.fillRect(item.x, item.y - 6, item.w * ttlRatio, 3);
      ctx.restore();
    }
  };

  StorageRunner.prototype.renderItems = function (ctx) {
    for (let i = 0; i < this.collectibles.length; i += 1) {
      const item = this.collectibles[i];
      const bob = item.state === 'grounded' ? Math.sin(item.bobPhase) * 2 : 0;

      ctx.fillStyle = 'rgba(255, 232, 150, 0.15)';
      ctx.beginPath();
      ctx.ellipse(item.x + item.w / 2, item.y + item.h + 8 + bob, item.w / 1.1, 5, 0, 0, Math.PI * 2);
      ctx.fill();

      this.renderSingleOrder(ctx, {
        x: item.x,
        y: item.y + bob,
        w: item.w,
        h: item.h,
        type: item.type,
        ttl: item.ttl,
        pulse: item.pulse
      });
    }
  };

  StorageRunner.prototype.renderBonuses = function (ctx) {
    for (let i = 0; i < this.bonuses.length; i += 1) {
      const bonus = this.bonuses[i];
      const bob = Math.sin(bonus.bobPhase) * 2.5;

      ctx.fillStyle = 'rgba(108, 255, 187, 0.18)';
      ctx.beginPath();
      ctx.ellipse(bonus.x + bonus.w / 2, bonus.y + bonus.h + 8 + bob, bonus.w / 1.3, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      this.drawSprite('energy', bonus.x, bonus.y + bob, bonus.w, bonus.h, false);
    }
  };

  StorageRunner.prototype.renderCarts = function (ctx) {
    for (let i = 0; i < this.carts.length; i += 1) {
      const cart = this.carts[i];
      const frame = Math.floor(cart.anim) % 2 === 0 ? 'cart1' : 'cart2';
      this.drawSprite(frame, cart.x, cart.y, cart.w, cart.h, cart.dir < 0);
    }
  };

  StorageRunner.prototype.getPlayerDrawParams = function () {
    const player = this.player;
    const frame = SPRITES[player.frameIndex] || SPRITES.playerIdle;
    return {
      x: player.x + (frame.ox || 0),
      y: player.y + (frame.oy || 0),
      w: frame.rw || player.w,
      h: frame.rh || player.h
    };
  };

  StorageRunner.prototype.renderPlayer = function (ctx) {
    const player = this.player;
    const draw = this.getPlayerDrawParams();
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
      ctx.save();
      ctx.strokeStyle = 'rgba(132, 255, 184, 0.75)';
      ctx.lineWidth = 2;
      ctx.strokeRect(draw.x - 3, draw.y - 3, draw.w + 6, draw.h + 6);
      ctx.restore();
    }

    if (this.testMode) {
      ctx.fillStyle = 'rgba(120, 184, 255, 0.12)';
      ctx.fillRect(draw.x - 10, draw.y - 18, 58, 16);
      ctx.fillStyle = '#eaf5ff';
      ctx.font = '12px Segoe UI';
      ctx.fillText('TEST', draw.x, draw.y - 6);
    }
  };

  StorageRunner.prototype.renderFloaters = function (ctx) {
    ctx.save();
    ctx.font = 'bold 18px Segoe UI';
    ctx.textAlign = 'center';

    for (let i = 0; i < this.floaters.length; i += 1) {
      const floater = this.floaters[i];
      const alpha = clamp(floater.life, 0, 1);
      ctx.fillStyle = floater.text.indexOf('-') === 0
        ? 'rgba(255, 132, 132,' + alpha.toFixed(3) + ')'
        : 'rgba(173, 255, 202,' + alpha.toFixed(3) + ')';
      ctx.fillText(floater.text, floater.x + 12, floater.y);
    }

    ctx.restore();
  };

  StorageRunner.prototype.renderStatus = function (ctx) {
    if (!this.statusText) {
      return;
    }

    ctx.save();
    ctx.fillStyle = 'rgba(8, 18, 34, 0.72)';
    ctx.fillRect(320, 88, 384, 40);
    ctx.strokeStyle = 'rgba(147, 189, 255, 0.2)';
    ctx.strokeRect(320, 88, 384, 40);
    ctx.fillStyle = '#eef7ff';
    ctx.font = '600 20px Segoe UI';
    ctx.textAlign = 'center';
    ctx.fillText(this.statusText, 512, 114);
    ctx.restore();
  };

  window.AZOTGame = {
    StorageRunner: StorageRunner
  };
})();
