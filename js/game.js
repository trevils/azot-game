(function () {
  const GAME_WIDTH = 1024;
  const GAME_HEIGHT = 768;
  const HUD_HEIGHT = 86;
  const WORLD_TOP = HUD_HEIGHT;
  const FLOOR_Y = 704;
  const GRAVITY = 1500;

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
    this.cartCounter = 0;

    this.input = {
      left: false,
      right: false,
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
      { x: 0, y: FLOOR_Y, w: GAME_WIDTH, h: GAME_HEIGHT - FLOOR_Y },
      { x: 0, y: 620, w: 220, h: 18 },
      { x: 270, y: 620, w: 220, h: 18 },
      { x: 540, y: 620, w: 220, h: 18 },
      { x: 804, y: 620, w: 220, h: 18 },
      { x: 120, y: 530, w: 230, h: 18 },
      { x: 420, y: 520, w: 230, h: 18 },
      { x: 734, y: 510, w: 290, h: 18 },
      { x: 0, y: 440, w: 220, h: 18 },
      { x: 300, y: 430, w: 250, h: 18 },
      { x: 700, y: 420, w: 324, h: 18 },
      { x: 150, y: 350, w: 250, h: 18 },
      { x: 500, y: 340, w: 260, h: 18 }
    ];

    this.player = {
      x: 110,
      y: 568,
      w: 36,
      h: 52,
      vx: 0,
      vy: 0,
      speed: 270,
      jumpForce: 580,
      onGround: false,
      invulnerability: 0,
      frameTime: 0,
      frameIndex: 0,
      facing: 1
    };

    this.cartLanes = [];
    for (let i = 0; i < this.platforms.length; i += 1) {
      const platform = this.platforms[i];
      if (platform.w >= 180) {
        this.cartLanes.push({
          platformIndex: i,
          y: platform.y - 32
        });
      }
    }

    this.carts = [];
    this.collectibles = [];

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

  StorageRunner.prototype.createOrder = function (type, targetPlatformIndex) {
    const platform = this.platforms[targetPlatformIndex];
    const sizeMap = {
      ordinary: { w: 26, h: 28, value: 10 },
      urgent: { w: 24, h: 30, value: 20 },
      fragile: { w: 28, h: 26, value: 30 }
    };
    const data = sizeMap[type];
    const x = platform.x + 20 + Math.random() * Math.max(20, platform.w - data.w - 40);

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
      ttl: type === 'urgent' ? 5 : 0,
      bobPhase: Math.random() * Math.PI * 2,
      pulse: Math.random() * Math.PI * 2
    };
  };

  StorageRunner.prototype.spawnOrderFromTop = function () {
    const availablePlatforms = this.platforms.slice(1);
    const targetPlatform = availablePlatforms[Math.floor(Math.random() * availablePlatforms.length)];
    const targetPlatformIndex = this.platforms.indexOf(targetPlatform);
    const type = this.chooseOrderType();
    this.collectibles.push(this.createOrder(type, targetPlatformIndex));
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
      w: 52,
      h: 32,
      speed: baseSpeed + Math.random() * 35,
      dir: fromLeft ? 1 : -1,
      platformIndex: lane.platformIndex,
      anim: 0
    });

    this.cartCounter += 1;
  };

  StorageRunner.prototype.onKeyDown = function (event) {
    if (!this.running || this.finished) {
      return;
    }

    if (event.code === 'ArrowLeft' || event.code === 'KeyA') {
      this.input.left = true;
    } else if (event.code === 'ArrowRight' || event.code === 'KeyD') {
      this.input.right = true;
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

  StorageRunner.prototype.finishRun = function () {
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
        testMode: this.testMode
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

    if (!this.testMode) {
      this.timeLeft -= dt;
      if (this.timeLeft <= 0) {
        this.timeLeft = 0;
        this.finishRun();
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

    this.updatePlayer(dt);
    this.updateOrders(dt);
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

    if (this.input.jumpQueued && player.onGround) {
      player.vy = -player.jumpForce;
      player.onGround = false;
      this.audio.play('jump');
    }
    this.input.jumpQueued = false;

    player.vy += GRAVITY * dt;
    player.invulnerability = Math.max(0, player.invulnerability - dt);

    player.x += player.vx * dt;
    player.x = clamp(player.x, 0, GAME_WIDTH - player.w);

    const previousY = player.y;
    player.y += player.vy * dt;
    player.onGround = false;

    for (let i = 0; i < this.platforms.length; i += 1) {
      const platform = this.platforms[i];
      const wasAbove = previousY + player.h <= platform.y;
      const nowIntersect = rectsIntersect(player, platform);
      if (wasAbove && nowIntersect && player.vy >= 0) {
        player.y = platform.y - player.h;
        player.vy = 0;
        player.onGround = true;
      }
    }

    if (player.y > GAME_HEIGHT) {
      player.y = WORLD_TOP + 40;
      player.vy = 0;
      player.x = 110;
      this.score = Math.max(0, this.score - 10);
      this.audio.play('hit');
      this.pushFloater(player.x, player.y, '-10');
      this.flashTimer = 0.2;
      this.statusText = 'Падение между стеллажами';
      this.statusTimer = 0.9;
    }

    player.frameTime += dt;
    if (Math.abs(player.vx) > 10 && player.onGround) {
      player.frameIndex = Math.floor(player.frameTime * 10) % 2 === 0 ? 1 : 2;
    } else if (!player.onGround) {
      player.frameIndex = 3;
    } else {
      player.frameIndex = 0;
    }
  };

  StorageRunner.prototype.getLandingPlatformIndex = function (item, previousY) {
    let landedPlatformIndex = -1;
    let landedPlatformY = Infinity;

    for (let i = 0; i < this.platforms.length; i += 1) {
      const platform = this.platforms[i];
      const horizontalOverlap =
        item.x + item.w > platform.x &&
        item.x < platform.x + platform.w;
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
        item.vy += (GRAVITY - 60) * dt;
        item.y += item.vy * dt;

        const platformIndex = this.getLandingPlatformIndex(item, previousY);
        if (platformIndex >= 0) {
          const platform = this.platforms[platformIndex];
          item.y = platform.y - item.h;
          item.vy = 0;
          item.platformIndex = platformIndex;

          if (item.type === 'fragile') {
            this.breakFragileOrder(i, item, platformIndex);
            continue;
          }

          item.state = 'grounded';
        }

        if (item.y > GAME_HEIGHT + 60) {
          this.collectibles.splice(i, 1);
        }
      } else {
        if (item.type === 'urgent') {
          item.ttl -= dt;
          if (item.ttl <= 0) {
            this.expireUrgentOrder(i, item);
            continue;
          }
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
        if (item.state === 'grounded' &&
            item.platformIndex === cart.platformIndex &&
            rectsIntersect(cart, item)) {
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

  StorageRunner.prototype.drawSprite = function (frame, x, y, w, h, flip) {
    if (!this.sprites.complete) {
      return;
    }

    const sx = frame * 32;
    const ctx = this.ctx;
    ctx.save();
    if (flip) {
      ctx.translate(x + w, y);
      ctx.scale(-1, 1);
      ctx.drawImage(this.sprites, sx, 0, 32, 32, 0, 0, w, h);
    } else {
      ctx.drawImage(this.sprites, sx, 0, 32, 32, x, y, w, h);
    }
    ctx.restore();
  };

  StorageRunner.prototype.render = function () {
    const ctx = this.ctx;

    ctx.clearRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

    this.renderBackground(ctx);
    this.renderPlatforms(ctx);
    this.renderItems(ctx);
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
    ctx.fillStyle = '#16294a';
    ctx.fillRect(0, FLOOR_Y, GAME_WIDTH, GAME_HEIGHT - FLOOR_Y);
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
      ctx.save();
      ctx.fillStyle = 'rgba(255, 214, 239, 0.95)';
      ctx.fillRect(item.x, item.y, item.w, item.h);
      ctx.strokeStyle = 'rgba(255, 123, 170, 0.95)';
      ctx.lineWidth = 2;
      ctx.strokeRect(item.x, item.y, item.w, item.h);
      ctx.beginPath();
      ctx.moveTo(item.x + 5, item.y + item.h - 5);
      ctx.lineTo(item.x + item.w - 5, item.y + 5);
      ctx.moveTo(item.x + 5, item.y + 5);
      ctx.lineTo(item.x + item.w - 5, item.y + item.h - 5);
      ctx.stroke();
      ctx.restore();
      return;
    }

    const frame = isUrgent ? 5 : 4;
    this.drawSprite(frame, item.x, item.y, item.w, item.h, false);

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

  StorageRunner.prototype.renderCarts = function (ctx) {
    for (let i = 0; i < this.carts.length; i += 1) {
      const cart = this.carts[i];
      const frame = Math.floor(cart.anim) % 2 === 0 ? 6 : 7;
      this.drawSprite(frame, cart.x, cart.y, cart.w, cart.h, cart.dir < 0);
    }
  };

  StorageRunner.prototype.renderPlayer = function (ctx) {
    const player = this.player;
    if (player.invulnerability > 0 && Math.floor(player.invulnerability * 14) % 2 === 0) {
      return;
    }
    this.drawSprite(player.frameIndex, player.x, player.y, player.w, player.h, player.facing < 0);

    if (this.testMode) {
      ctx.fillStyle = 'rgba(120, 184, 255, 0.12)';
      ctx.fillRect(player.x - 10, player.y - 18, 58, 16);
      ctx.fillStyle = '#eaf5ff';
      ctx.font = '12px Segoe UI';
      ctx.fillText('TEST', player.x, player.y - 6);
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
