(function () {
  const GAME_WIDTH = 1024;
  const GAME_HEIGHT = 768;
  const HUD_HEIGHT = 86;
  const WORLD_TOP = HUD_HEIGHT;
  const FLOOR_Y = 704;

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
    this.input = {
      left: false,
      right: false,
      jumpQueued: false
    };
    this.flashTimer = 0;
    this.statusText = '';
    this.statusTimer = 0;
    this.floaters = [];
    this.respawnQueue = [];

    this.player = null;
    this.platforms = [];
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
    this.flashTimer = 0;
    this.statusText = this.testMode ? 'TEST MODE' : 'Смена началась';
    this.statusTimer = 1.4;
    this.floaters = [];
    this.respawnQueue = [];

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
      { x: 88, y: 616, w: 240, h: 18 },
      { x: 360, y: 560, w: 280, h: 18 },
      { x: 700, y: 616, w: 240, h: 18 },
      { x: 180, y: 470, w: 250, h: 18 },
      { x: 520, y: 420, w: 280, h: 18 }
    ];

    this.player = {
      x: 110,
      y: 564,
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

    this.carts = [
      { x: 150, y: FLOOR_Y - 40, w: 52, h: 32, speed: 165, dir: 1, minX: 24, maxX: 948, anim: 0 },
      { x: 690, y: 528, w: 52, h: 32, speed: 130, dir: -1, minX: 392, maxX: 588, anim: 0 },
      { x: 560, y: 388, w: 52, h: 32, speed: 115, dir: 1, minX: 532, maxX: 748, anim: 0 }
    ];

    this.collectibles = [];
    for (let i = 0; i < 6; i += 1) {
      this.spawnCollectible();
    }
  };

  StorageRunner.prototype.spawnCollectible = function () {
    const choices = this.platforms.slice(1);
    const base = choices[Math.floor(Math.random() * choices.length)];
    const type = Math.random() < 0.32 ? 'order' : 'box';
    const width = type === 'order' ? 24 : 26;
    const height = type === 'order' ? 30 : 28;
    const x = base.x + 22 + Math.random() * Math.max(40, base.w - 70);
    const collectible = {
      x: x,
      y: base.y - height,
      w: width,
      h: height,
      type: type,
      value: type === 'order' ? 20 : 10,
      bobPhase: Math.random() * Math.PI * 2
    };
    this.collectibles.push(collectible);
  };

  StorageRunner.prototype.queueRespawn = function (delay) {
    this.respawnQueue.push({
      remaining: delay
    });
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

    if (!this.testMode) {
      this.timeLeft -= dt;
      if (this.timeLeft <= 0) {
        this.timeLeft = 0;
        this.finishRun();
        return;
      }
    }

    for (let i = this.respawnQueue.length - 1; i >= 0; i -= 1) {
      this.respawnQueue[i].remaining -= dt;
      if (this.respawnQueue[i].remaining <= 0) {
        this.respawnQueue.splice(i, 1);
        this.spawnCollectible();
      }
    }

    this.updatePlayer(dt);
    this.updateCarts(dt);
    this.updateCollectibles(dt);
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

    player.vy += 1500 * dt;
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

  StorageRunner.prototype.updateCarts = function (dt) {
    for (let i = 0; i < this.carts.length; i += 1) {
      const cart = this.carts[i];
      cart.x += cart.speed * cart.dir * dt;
      cart.anim += dt * 8;

      if (cart.x <= cart.minX) {
        cart.x = cart.minX;
        cart.dir = 1;
      } else if (cart.x >= cart.maxX) {
        cart.x = cart.maxX;
        cart.dir = -1;
      }

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
    }
  };

  StorageRunner.prototype.updateCollectibles = function (dt) {
    for (let i = this.collectibles.length - 1; i >= 0; i -= 1) {
      const item = this.collectibles[i];
      item.bobPhase += dt * 2.2;

      if (rectsIntersect(this.player, item)) {
        this.score += item.value;
        this.audio.play(item.type === 'order' ? 'pickupRare' : 'pickup');
        this.pushFloater(item.x, item.y, '+' + item.value);
        this.collectibles.splice(i, 1);
        this.queueRespawn(1.1 + Math.random() * 1.4);
        continue;
      }

      for (let cartIndex = 0; cartIndex < this.carts.length; cartIndex += 1) {
        const cart = this.carts[cartIndex];
        if (rectsIntersect(item, cart)) {
          this.collectibles.splice(i, 1);
          this.queueRespawn(1.7 + Math.random() * 1.6);
          this.score = Math.max(0, this.score - 5);
          this.statusText = 'Тележка увезла заказ';
          this.statusTimer = 0.85;
          this.pushFloater(item.x, item.y, '-5');
          break;
        }
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

  StorageRunner.prototype.renderItems = function (ctx) {
    for (let i = 0; i < this.collectibles.length; i += 1) {
      const item = this.collectibles[i];
      const bob = Math.sin(item.bobPhase) * 3;
      const frame = item.type === 'order' ? 5 : 4;
      this.drawSprite(frame, item.x, item.y + bob, item.w, item.h, false);

      ctx.fillStyle = 'rgba(255, 232, 150, 0.15)';
      ctx.beginPath();
      ctx.ellipse(item.x + item.w / 2, item.y + item.h + 8, item.w / 1.1, 5, 0, 0, Math.PI * 2);
      ctx.fill();
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
    ctx.fillRect(360, 88, 304, 40);
    ctx.strokeStyle = 'rgba(147, 189, 255, 0.2)';
    ctx.strokeRect(360, 88, 304, 40);
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