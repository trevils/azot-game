(function () {
  // Настройки звуков для игры "АЗОТ СКЛАД: СБОРЩИК ЗАКАЗОВ".
  // TODO: вынести блок констант в отдельный JSON-файл
  const WAREHOUSE_SFX_CONFIG = {
    ui_click: { f: 420, t: 0.06, type: "square", v: 0.025, sl: 0 }, // обычный тап по UI
    worker_jump: { f: 310, t: 0.12, type: "square", v: 0.03, sl: 120 }, // прыжок сборщика
    order_pickup: { f: 620, t: 0.08, type: "triangle", v: 0.04, sl: 80 }, // подобран обычный заказ
    urgent_order_pickup: { f: 740, t: 0.1, type: "triangle", v: 0.05, sl: 160 }, // подобран срочный заказ
    damage_taken: { f: 180, t: 0.14, type: "sawtooth", v: 0.05, sl: -60 } // урон/ошибка/столкновение
  };

  // Костыль: вырубаем звук, если открыта страница с описанием проекта
  const isProjectInfoPage = window.location.href.includes("project_info.html");

  // Запоминаю выбор пользователя, чтобы не бесило при перезагрузке страницы
  const isForcedMute = localStorage.getItem("azotWarehouse_muted") === "1";

  function AzotWarehouseAudioManager(defaultState) {
    this.active = isForcedMute ? false : defaultState !== false;
    this._audioCtx = null;
    this.warehouseAmbientInterval = null;
    this.touched = false;
    this.masterVolume = 1.0;

    // Для прогрессии: на высокой сложности звук срочного заказа будет чуть заметнее
    this.difficultyLevel = window.currentGameState?.level || 1;
  }

  AzotWarehouseAudioManager.prototype.initAudioContext = function () {
    if (this._audioCtx) return this._audioCtx;

    const CtxClass = window.AudioContext || window.webkitAudioContext;
    if (!CtxClass) {
      console.warn("Аудио не поддерживается. Скорее всего старый браузер.");
      return null;
    }

    try {
      this._audioCtx = new CtxClass();

      // Safari/iOS костыль — контекст спит, пока игрок не ткнет в экран
      if (this._audioCtx.state === "suspended" && !this.touched) {
        const unlock = () => {
          this._audioCtx?.resume();
          document.removeEventListener("touchstart", unlock);
        };

        document.addEventListener("touchstart", unlock, { once: true });
      }

      return this._audioCtx;
    } catch (err) {
      console.error("Ошибка инициализации звука:", err);
      return null;
    }
  };

  AzotWarehouseAudioManager.prototype.toggleSound = function () {
    this.active = !this.active;
    localStorage.setItem("azotWarehouse_muted", this.active ? "0" : "1");

    if (!this.active) {
      this.stopWarehouseAtmosphere();
    } else {
      this.touched = true;
      this.playWarehouseSfx("ui_click"); // звуковой фидбек на кнопку
    }

    return this.active;
  };

  AzotWarehouseAudioManager.prototype.playWarehouseSfx = function (soundId) {
    if (!this.active || isProjectInfoPage) return;

    this.touched = true;

    const cfg = WAREHOUSE_SFX_CONFIG[soundId];
    if (!cfg) {
      // console.log("Звук не найден:", soundId);
      return;
    }

    const ctx = this.initAudioContext();
    if (!ctx) return;

    this.synthesizeTone(cfg, ctx.currentTime);
  };

  AzotWarehouseAudioManager.prototype.synthesizeTone = function (cfg, time) {
    const ctx = this._audioCtx;
    if (!ctx) return;

    try {
      const osc = ctx.createOscillator();
      const gainNode = ctx.createGain();

      osc.type = cfg.type;
      osc.frequency.setValueAtTime(cfg.f, time);

      if (cfg.sl) {
        osc.frequency.linearRampToValueAtTime(
          Math.max(40, cfg.f + cfg.sl),
          time + cfg.t
        );
      }

      // Начинаем не с нуля, чтобы не было щелчка в начале
      gainNode.gain.setValueAtTime(0.0001, time);

      let finalVolume = cfg.v * this.masterVolume;

      // Если сложность выше 10, звук срочного заказа делаем чуть заметнее
      if (
        this.difficultyLevel > 10 &&
        cfg === WAREHOUSE_SFX_CONFIG.urgent_order_pickup
      ) {
        finalVolume *= 1.15;
      }

      gainNode.gain.exponentialRampToValueAtTime(finalVolume, time + 0.01);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, time + cfg.t);

      osc.connect(gainNode);
      gainNode.connect(ctx.destination);

      osc.start(time);
      osc.stop(time + cfg.t + 0.02);
    } catch (ex) {
      // Игнорим ошибку, если синтез не прошел, чтобы игра не упала
      if (ex.name !== "NotSupportedError") {
        console.error("Синтез звука не удался:", ex);
      }
    }
  };

  AzotWarehouseAudioManager.prototype.runWarehouseAtmosphere = function () {
    if (!this.active || this.warehouseAmbientInterval || isProjectInfoPage) return;
    if (!this.initAudioContext()) return;

    const tick = () => {
      if (!this.active) return;

      const ctx = this._audioCtx;
      if (!ctx) return;

      try {
        // Фоновый складской гул: тихая работа помещения, вентиляции и оборудования
        this.synthesizeTone(
          { f: 110, t: 0.18, type: "sine", v: 0.01, sl: 0 },
          ctx.currentTime
        );

        this.synthesizeTone(
          { f: 164, t: 0.22, type: "sine", v: 0.008, sl: 18 },
          ctx.currentTime + 0.12
        );
      } catch (e) {
        // не критично
      }
    };

    // 2800ms — подбираем на слух, чтобы не частило и не бесило
    this.warehouseAmbientInterval = setInterval(tick, 2800);
  };

  AzotWarehouseAudioManager.prototype.stopWarehouseAtmosphere = function () {
    if (this.warehouseAmbientInterval) {
      clearInterval(this.warehouseAmbientInterval);
      this.warehouseAmbientInterval = null;
    }
  };

  AzotWarehouseAudioManager.prototype.setMasterVolume = function (value) {
    this.masterVolume = value < 0 ? 0 : value > 1 ? 1 : value;
  };
})();