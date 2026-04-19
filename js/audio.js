(function () {
  // Короткие сигналы для интерфейса и смены.
  const cueBank = {
    click: { frequency: 420, duration: 0.06, wave: "square", volume: 0.025, glide: 0 },
    jump: { frequency: 310, duration: 0.12, wave: "square", volume: 0.03, glide: 120 },
    pickup: { frequency: 620, duration: 0.08, wave: "triangle", volume: 0.04, glide: 80 },
    pickupRare: { frequency: 740, duration: 0.1, wave: "triangle", volume: 0.05, glide: 160 },
    hit: { frequency: 180, duration: 0.14, wave: "sawtooth", volume: 0.05, glide: -60 }
  };

  function AudioManager(enabled) {
    this.enabled = enabled !== false;
    this.context = null;
    this.ambientTimer = null;
  }

  // Контекст создаём лениво, когда браузер уже готов дать звук.
  AudioManager.prototype.ensureContext = function () {
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;

    if (!AudioContextCtor) {
      return null;
    }

    if (!this.context) {
      try {
        this.context = new AudioContextCtor();
      } catch (error) {
        this.context = null;
        return null;
      }
    }

    if (this.context.state === "suspended") {
      this.context.resume().catch(function () {});
    }

    return this.context;
  };

  AudioManager.prototype.setEnabled = function (enabled) {
    this.enabled = !!enabled;

    if (!this.enabled) {
      this.stopAmbient();
    }
  };

  AudioManager.prototype.toggle = function () {
    this.setEnabled(!this.enabled);

    if (this.enabled) {
      this.play("click");
    }

    return this.enabled;
  };

  // Если звук недоступен, просто выходим без ошибок наверх.
  AudioManager.prototype.play = function (cueName) {
    const cue = cueBank[cueName] || cueBank.click;
    const context = this.enabled ? this.ensureContext() : null;

    if (!context) {
      return;
    }

    this.scheduleTone(cue, context.currentTime);
  };

  AudioManager.prototype.scheduleTone = function (cue, startAt) {
    const context = this.context;
    let oscillator;
    let gainNode;

    if (!context) {
      return;
    }

    oscillator = context.createOscillator();
    gainNode = context.createGain();

    oscillator.type = cue.wave;
    oscillator.frequency.setValueAtTime(cue.frequency, startAt);

    if (cue.glide) {
      oscillator.frequency.linearRampToValueAtTime(
        Math.max(40, cue.frequency + cue.glide),
        startAt + cue.duration
      );
    }

    gainNode.gain.setValueAtTime(0.0001, startAt);
    gainNode.gain.exponentialRampToValueAtTime(cue.volume, startAt + 0.01);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, startAt + cue.duration);

    oscillator.connect(gainNode);
    gainNode.connect(context.destination);
    oscillator.start(startAt);
    oscillator.stop(startAt + cue.duration + 0.02);
  };

  // Фоновый гул склада гоняем отдельным таймером.
  AudioManager.prototype.startAmbient = function () {
    const depot = this;

    if (!this.enabled || this.ambientTimer) {
      return;
    }

    if (!this.ensureContext()) {
      return;
    }

    this.ambientTimer = window.setInterval(function () {
      const context = depot.enabled ? depot.ensureContext() : null;

      if (!context) {
        return;
      }

      depot.scheduleTone({ frequency: 110, duration: 0.18, wave: "sine", volume: 0.01, glide: 0 }, context.currentTime);
      depot.scheduleTone({ frequency: 164, duration: 0.22, wave: "sine", volume: 0.008, glide: 18 }, context.currentTime + 0.12);
    }, 2800);
  };

  AudioManager.prototype.stopAmbient = function () {
    if (!this.ambientTimer) {
      return;
    }

    window.clearInterval(this.ambientTimer);
    this.ambientTimer = null;
  };

  window.AZOTAudio = {
    AzotDepot: AudioManager,
    AudioManager: AudioManager
  };
})();
