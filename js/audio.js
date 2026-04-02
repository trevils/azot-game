(function () {
  function AudioManager(enabled) {
    this.enabled = enabled !== false;
    this.context = null;
    this.ambientTimer = null;
  }

  AudioManager.prototype.ensureContext = function () {
    if (!this.context) {
      const Context = window.AudioContext || window.webkitAudioContext;
      if (!Context) {
        return null;
      }
      this.context = new Context();
    }
    if (this.context.state === 'suspended') {
      this.context.resume();
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
      this.play('click');
    }
    return this.enabled;
  };

  AudioManager.prototype.play = function (type) {
    if (!this.enabled) {
      return;
    }

    const context = this.ensureContext();
    if (!context) {
      return;
    }

    const now = context.currentTime;
    let frequency = 220;
    let duration = 0.08;
    let wave = 'square';
    let volume = 0.03;
    let glide = 0;

    switch (type) {
      case 'jump':
        frequency = 310;
        duration = 0.12;
        wave = 'square';
        glide = 120;
        break;
      case 'pickup':
        frequency = 620;
        duration = 0.08;
        wave = 'triangle';
        volume = 0.04;
        glide = 80;
        break;
      case 'pickupRare':
        frequency = 740;
        duration = 0.1;
        wave = 'triangle';
        volume = 0.05;
        glide = 160;
        break;
      case 'hit':
        frequency = 180;
        duration = 0.14;
        wave = 'sawtooth';
        volume = 0.05;
        glide = -60;
        break;
      default:
        frequency = 420;
        duration = 0.06;
        wave = 'square';
        volume = 0.025;
        glide = 0;
        break;
    }

    this.playTone(frequency, duration, wave, volume, glide, now);
  };

  AudioManager.prototype.playTone = function (frequency, duration, wave, volume, glide, when) {
    const context = this.context;
    if (!context) {
      return;
    }

    const oscillator = context.createOscillator();
    const gainNode = context.createGain();

    oscillator.type = wave;
    oscillator.frequency.setValueAtTime(frequency, when);
    if (glide) {
      oscillator.frequency.linearRampToValueAtTime(Math.max(40, frequency + glide), when + duration);
    }

    gainNode.gain.setValueAtTime(0.0001, when);
    gainNode.gain.exponentialRampToValueAtTime(volume, when + 0.01);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, when + duration);

    oscillator.connect(gainNode);
    gainNode.connect(context.destination);
    oscillator.start(when);
    oscillator.stop(when + duration + 0.02);
  };

  AudioManager.prototype.startAmbient = function () {
    if (!this.enabled || this.ambientTimer) {
      return;
    }

    const self = this;
    this.ensureContext();

    this.ambientTimer = window.setInterval(function () {
      if (!self.enabled || !self.context) {
        return;
      }
      const start = self.context.currentTime;
      self.playTone(110, 0.18, 'sine', 0.01, 0, start);
      self.playTone(164, 0.22, 'sine', 0.008, 18, start + 0.12);
    }, 2800);
  };

  AudioManager.prototype.stopAmbient = function () {
    if (this.ambientTimer) {
      window.clearInterval(this.ambientTimer);
      this.ambientTimer = null;
    }
  };

  window.AZOTAudio = {
    AudioManager: AudioManager
  };
})();