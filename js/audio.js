(function () {
  // Простые звуки для UI действий - нужны чтобы игрок получал фидбэк при клике/прыжке
  const sounds = {
    click: { freq: 420, time: 0.06, type: "square", vol: 0.025, slide: 0 },
    jump: { freq: 310, time: 0.12, type: "square", vol: 0.03, slide: 120 },
    pickup: { freq: 620, time: 0.08, type: "triangle", vol: 0.04, slide: 80 },
    pickupRare: { freq: 740, time: 0.1, type: "triangle", vol: 0.05, slide: 160 },
    hit: { freq: 180, time: 0.14, type: "sawtooth", vol: 0.05, slide: -60 }
  };

  function SoundEngine(enabled) {
    this.on = enabled !== false;
    this.ctx = null;
    this.bgLoop = null;
  }

  // Инициализируем Web Audio API лениво - когда браузер это позволит
  SoundEngine.prototype.init = function () {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;

    if (!AudioCtx) {
      return null;
    }

    if (!this.ctx) {
      try {
        this.ctx = new AudioCtx();
      } catch (e) {
        return null;
      }
    }

    // Браузер может заблокировать звук пока юзер не взаимодействует с страницей
    if (this.ctx.state === "suspended") {
      this.ctx.resume().catch(() => null);
    }

    return this.ctx;
  };

  SoundEngine.prototype.toggle = function () {
    this.on = !this.on;
    if (!this.on) {
      this.stopBg();
    } else {
      this.play("click");
    }
    return this.on;
  };

  SoundEngine.prototype.play = function (name) {
    if (!this.on) return;

    const sound = sounds[name] || sounds.click;
    const ctx = this.init();
    if (!ctx) return;

    this.tone(sound, ctx.currentTime);
  };

  SoundEngine.prototype.tone = function (sound, when) {
    const ctx = this.ctx;
    if (!ctx) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = sound.type;
    osc.frequency.setValueAtTime(sound.freq, when);

    // Скользим частоту (нужно для получения интересного звука) иначе будет скучный и однообразный знакомый звук
    if (sound.slide) {
      osc.frequency.linearRampToValueAtTime(
        Math.max(40, sound.freq + sound.slide),
        when + sound.time
      );
    }

    // Огибающая - мягко входим, потом быстро выходим
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(sound.vol, when + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + sound.time);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(when);
    osc.stop(when + sound.time + 0.02);
  };

  // Фоновый гул - крутим его в цикле чтобы он был всегда
  SoundEngine.prototype.startBg = function () {
    if (!this.on || this.bgLoop) {
      return;
    }

    if (!this.init()) {
      return;
    }

    this.bgLoop = setInterval(() => {
      if (!this.on) return;
      const ctx = this.init();
      if (!ctx) return;

      this.tone({ freq: 110, time: 0.18, type: "sine", vol: 0.01, slide: 0 }, ctx.currentTime);
      this.tone({ freq: 164, time: 0.22, type: "sine", vol: 0.008, slide: 18 }, ctx.currentTime + 0.12);
    }, 2800);
  };

  SoundEngine.prototype.stopBg = function () {
    if (this.bgLoop) {
      clearInterval(this.bgLoop);
      this.bgLoop = null;
    }
  };

  // совместимость с прочими файлами,что ожидают эти методы для управления звуком
  SoundEngine.prototype.startAmbient = function () {
    this.startBg();
  };

  SoundEngine.prototype.stopAmbient = function () {
    this.stopBg();
  };

  window.AZOTAudio = {
    Engine: SoundEngine,
    create: (enabled) => new SoundEngine(enabled)
  };
})();
