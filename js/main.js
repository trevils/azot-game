/*
  AZOT Depo Shift Manager
 
  Управляет рабочим процессом смен на складе: от регистрации комплектовщика
  и выбора участка до запуска игрового движка и фиксации результатов.
  Синхронизирует состояние хранилища, аудио и UI.
 */
(function () {
  // === ИНИЦИАЛИЗАЦИЯ ЭКРАНОВ ===
  // Три главных состояния приложения: диспетчеризация смен, игровой процесс, итоги
  const screens = {
    dispatch: document.getElementById("azot-dispatch-scene"),     // Экран запуска смены
    game: document.getElementById("rack-floor-scene"),            // Игровое поле (canvas)
    summary: document.getElementById("shift-ledger-scene")        // Таблица результатов и рейтинг
  };

  // === UI ЭЛЕМЕНТЫ ===
  // Распределены по функциональным зонам интерфейса
  const ui = {
    // Зона диспетчера: ввод рабочего и выбор участка/бригады
    workerInput: document.getElementById("picker-badge-input"),
    lineSelect: document.getElementById("azot-sector-code"),
    brigadeSelect: document.getElementById("brigade-call-code"),
    startBtn: document.getElementById("dispatch-shift-btn"),
    audioBtnDispatch: document.getElementById("dispatch-sound-toggle"),
    fontDecBtn: document.getElementById("dispatch-font-down"),
    fontIncBtn: document.getElementById("dispatch-font-up"),
    
    // Игровое поле
    canvas: document.getElementById("game-canvas"),
    
    // HUD во время смены: данные в реальном времени
    workerBadge: document.getElementById("hud-picker"),
    lineBadge: document.getElementById("hud-sector-readout"),
    timer: document.getElementById("hud-shift-clock"),
    scoreBoard: document.getElementById("hud-cargo-score"),
    livesBoard: document.getElementById("hud-fall-limit"),
    
    // Управление во время смены: пауза, звук, завершение
    pauseBtn: document.getElementById("shift-pause-btn"),
    audioBtnFloor: document.getElementById("shift-sound-btn"),
    endBtn: document.getElementById("handover-shift-btn"),
    pauseOverlay: document.getElementById("forklift-pause-gate"),
    resumeBtn: document.getElementById("resume-shift-btn"),
    
    // Итоговый экран: результаты смены, таблица смен, повтор/возврат
    summaryTitle: document.getElementById("handover-summary"),
    summaryBody: document.getElementById("handover-note"),
    ledgerTable: document.getElementById("brigade-ledger-body"),
    rankLine: document.getElementById("picker-ledger-rank"),
    repeatBtn: document.getElementById("restart-shift-btn"),
    backBtn: document.getElementById("return-dispatch-btn")
  };

  // === ВАЛИДАЦИЯ КРИТИЧЕСКИХ ЭЛЕМЕНТОВ ===
  // Если элементы отсутствуют, приложение не может работать
  const requiredElements = [
    { elem: screens.dispatch, id: "azot-dispatch-scene" },
    { elem: screens.game, id: "rack-floor-scene" },
    { elem: screens.summary, id: "shift-ledger-scene" },
    { elem: ui.workerInput, id: "picker-badge-input" },
    { elem: ui.lineSelect, id: "azot-sector-code" },
    { elem: ui.brigadeSelect, id: "brigade-call-code" },
    { elem: ui.startBtn, id: "dispatch-shift-btn" },
    { elem: ui.canvas, id: "game-canvas" },
    { elem: ui.ledgerTable, id: "brigade-ledger-body" }
  ];

  const missingIds = requiredElements
    .filter(function (item) { return !item.elem; })
    .map(function (item) { return item.id; });

  if (missingIds.length > 0) {
    // Фатальная ошибка: страница не содержит критических элементов
    // Возможные причины: неправильный HTML, загруженный через неправильный шаблон
    window.AZOTBootFault = {
      at: Date.now(),
      location: "dispatch-desk",
      missing: missingIds,
      reason: "Critical UI elements not found in DOM"
    };
    const errorMsg = "Критическая ошибка инициализации! Отсутствуют элементы: " + missingIds.join(", ");
    console.error(errorMsg);
    alert(errorMsg);
    return;
  }

  // === КОНФИГУРАЦИЯ СКЛАДА ===
  // Участки (lanes) и бригады задают контекст смены: нормативы, ответственных, точки сдачи
  const warehouse = {
    // Рабочие участки с нормативами по заказам, правилами и ответственными
    lines: {
      "bulk-lane": {
        label: "Паллетный ряд",
        shortLabel: "Паллеты",
        tag: "PLT-17",
        scoreGoal: 400,  // Норматив: 400 заказов за смену
        planNote: "не просадить поток паллет",
        rules: "допускается до трёх потерь по участку",
        handoverPoint: "окно перебора",
        briefing: "держать паллетный поток без пересорта",
        errorMsg: "Паллетная линия не подняла смену"
      },
      "rush-dock": {
        label: "Экспресс-ворота",
        shortLabel: "Экспресс",
        tag: "EXP-04",
        scoreGoal: 180,  // Срочные заказы: ниже норматив, выше риск просрочки
        planNote: "не сорвать срочные окна",
        rules: "просрочка срочных заказов недопустима",
        handoverPoint: "стол Климова",
        briefing: "держать срочные окна без просадки",
        errorMsg: "Экспресс-ворота потеряли пульт смены"
      },
      "fragile-bay": {
        label: "Хрупкий ряд",
        shortLabel: "Хрупкий",
        tag: "FRG-09",
        scoreGoal: 150,  // Хрупкий товар: самый низкий норматив из-за брака
        planNote: "сдать хрупкий товар без боя",
        rules: "бой хрупкого считается браком смены",
        handoverPoint: "контрольный стол Ланиной",
        briefing: "закрыть хрупкий ряд без боя и возвратов",
        errorMsg: "Хрупкий ряд остался без игрового поля"
      }
    },
    
    // Бригады: состав, лидер, место сдачи смены и позывной для рации
    teams: {
      "north-3": {
        label: "Север-3",
        lead: "Романов",        // Старший бригады — ответственен за сдачу
        deskLocation: "окно А2", // Где происходит оперативная сдача
        callSign: "N3"           // Позывной для внутренней рации
      },
      "azot-pack": {
        label: "Азот-комплект",
        lead: "Ведерникова",
        deskLocation: "окно Б1",
        callSign: "AZP"
      },
      "night-belt": {
        label: "Ночная лента",
        lead: "Чернов",
        deskLocation: "ночной пост",
        callSign: "NBT"
      }
    }
  };

  // === ИНИЦИАЛИЗАЦИЯ МОДУЛЕЙ ===
  // Ищет глобальные объекты хранилища и звука с несколькими вариантами имён
  // (может быть загруженоа в разных скриптах с разной именованием)
  const storage = window.AZOTStorage || {};
  
  // Аудиоэнжин может быть с разными именами в зависимости от того,
  // какой скрипт был загружен первым
  const audioModule = window.AZOTAudio ||
    window.AZOTAudioManager ||
    window.AZOTWarehouseAudio ||
    window.AZOTWarehouseAudioManager ||
    window.AzotWarehouseAudioManager ||
    {};
  
  const gameEngine = window.AZOTGame || {};

  /**
   * Нормализует пользовательские настройки для внутреннего использования.
   * Валидирует размер шрифта, наличие аудио, выбранный участок и бригаду.
   * 
   * Используется для:
   * - Загрузки настроек из хранилища (может быть в старом формате)
   * - Преобразования результатов игры обратно в приложение
   * 
   * @param {Object} rawSettings - сырые настройки из внешних источников
   * @returns {Object} нормализованные настройки с гарантированно валидными значениями
   */
  function normalizeSettings(rawSettings) {
    // Убедиться, что это объект; если нет — пустой объект
    const source = rawSettings && typeof rawSettings === "object" ? rawSettings : {};
    
    // Участок: новый формат "line" или старый "sectorCode"
    const lineCode = warehouse.lines[source.line] ? source.line : source.sectorCode;
    
    // Бригада: новый формат "team" или старый "brigadeCode"
    const teamCode = warehouse.teams[source.team] ? source.team : source.brigadeCode;

    return {
      // Размер шрифта: 12-22 пиксела (экран может быть во вспомогательном помещении с плохой видимостью)
      fontSize: Math.max(12, Math.min(22, Number(source.fontSize) || 16)),
      
      // Аудио: проверить все возможные ключи (для совместимости с разными версиями)
      audioEnabled: source.audioEnabled !== false && source.sound !== false && source.soundEnabled !== false,
      
      // Гарантировать, что выбран существующий участок
      line: warehouse.lines[lineCode] ? lineCode : "bulk-lane",
      
      // Гарантировать, что выбрана существующая бригада
      team: warehouse.teams[teamCode] ? teamCode : "north-3"
    };
  }

  /**
   * Преобразует внутренние настройки в формат для хранилища.
   * Обратное преобразование нормализации для сохранения.
   */
  function toStoragePrefs(nextSettings) {
    const source = nextSettings && typeof nextSettings === "object" ? nextSettings : {};

    return {
      fontSize: Math.max(12, Math.min(22, Number(source.fontSize) || 16)),
      soundEnabled: source.audioEnabled !== false && source.sound !== false,
      sectorCode: warehouse.lines[source.line] ? source.line : "bulk-lane",
      brigadeCode: warehouse.teams[source.team] ? source.team : "north-3"
    };
  }

  /**
   * Пытается загрузить настройки из хранилища, проверяя несколько методов.
   * Если хранилище недоступно — возвращает дефолтные настройки.
   */
  const loadSettings = typeof storage.pullDutyConsolePrefs === "function"
    ? function () {
        // Новое API хранилища (последнее обновление)
        return normalizeSettings(storage.pullDutyConsolePrefs());
      }
    : typeof storage.load === "function"
      ? function () {
          // Старое API хранилища
          return normalizeSettings(storage.load());
        }
      : function () {
          // Хранилище отсутствует — дефолты
          return normalizeSettings(null);
        };

  /**
   * Пытается сохранить настройки в хранилище.
   * Если хранилище недоступно — просто возвращает нормализованные настройки.
   */
  const saveSettings = typeof storage.stashDutyConsolePrefs === "function"
    ? function (nextSettings) {
        return normalizeSettings(storage.stashDutyConsolePrefs(toStoragePrefs(nextSettings)));
      }
    : typeof storage.save === "function"
      ? function (nextSettings) {
          return normalizeSettings(storage.save(nextSettings));
        }
      : function (nextSettings) {
          // Хранилище недоступно — сохранили только в памяти
          return normalizeSettings(nextSettings);
        };

  /**
   * Пытается получить таблицу лучших результатов смен.
   * Используется для отображения рейтинга участников на итоговом экране.
   */
  const readLeaderboard = typeof storage.readCrewWatchboard === "function"
    ? storage.readCrewWatchboard.bind(storage)
    : typeof storage.getBoard === "function"
      ? storage.getBoard.bind(storage)
      : function () {
          // Лидерборда недоступна — пустой массив
          return [];
        };

  /**
   * Фиксирует результат смены в журнале (для истории и рейтинга).
   * Преобразует результаты игры в формат журнала, если тот доступен.
   * 
   * @param {Object|string} summaryOrName - объект результата смены или имя игрока
   * @param {number} maybeScore - (опционально) очки, если первый параметр — имя
   * @returns {Object} запись в журнал с дополнительными полями (ранг, статус архива и т.д.)
   */
  const writeShiftResult = typeof storage.logShiftToDutyJournal === "function"
    ? storage.logShiftToDutyJournal.bind(storage)
    : typeof storage.record === "function"
      ? storage.record.bind(storage)
      : function (summaryOrName, maybeScore) {
          // Хранилище журнала недоступно — создаём минимальную структуру
          const source = summaryOrName && typeof summaryOrName === "object" ? summaryOrName : null;
          const name = source
            ? (source.pickerName || source.workerName || source.name || "Игрок")
            : (summaryOrName || "Игрок");
          const score = Math.max(0, Number(source ? source.score : maybeScore) || 0);

          return {
            top10: [{ name: name, score: score }],
            rank: 1,
            archiveSaved: false,
            archiveMode: "screen-only",
            archiveWasRepaired: false,
            removedRows: 0,
            pickerRow: {
              name: name,
              score: score,
              shiftPassport: source && source.shiftPassport ? source.shiftPassport : null
            },
            shiftBadge: "Дежурный комплектовщик",
            serviceNote: "",
            reviewFlag: false,
            reviewReason: "",
            shiftBoss: "",
            auditDesk: "",
            auditRowPinned: false,
            archiveIssue: "browser-blocked-ledger"
          };
        };

  /**
   * Гарантирует наличие рабочего canvas элемента для рендеринга игры.
   * Если текущий canvas сломан, пытается его заменить.
   * 
   * Canvas — критичный ресурс для работы игры; его отсутствие или сбой
   * приводит к невозможности запуска смены.
   * 
   * @returns {HTMLCanvasElement|null} рабочий canvas или null если недоступен
   */
  function ensureCanvas() {
    // Базовая проверка: элемент вообще существует и имеет нужный тип
    if (!ui.canvas || !(ui.canvas instanceof HTMLCanvasElement)) {
      console.warn("Canvas элемент отсутствует или имеет неверный тип");
      return null;
    }

    // Попытка получить 2D контекст: если она прошла — canvas рабочий
    try {
      if (ui.canvas.getContext("2d")) {
        return ui.canvas;  // Успех — canvas готов
      }
    } catch (contextError) {
      console.warn("Canvas не отдал 2D контекст (ошибка браузера)");
    }

    // Если canvas не имеет родителя в DOM — его невозможно заменить
    if (!ui.canvas.parentNode) {
      console.error("Canvas элемент отключен от DOM, не могу его заменить");
      return null;
    }

    // Последняя попытка: создаём новый canvas и подменяем старый
    // Это может помочь если canvas был скрыт или поломана его система рендеринга
    console.info("Canvas повреждён, пытаюсь заменить на новый элемент...");
    const newCanvas = document.createElement("canvas");
    newCanvas.id = ui.canvas.id || "game-canvas";
    newCanvas.width = 1024;  // Стандартное разрешение игры
    newCanvas.height = 768;
    newCanvas.style.cssText = ui.canvas.style.cssText || "";

    try {
      ui.canvas.parentNode.replaceChild(newCanvas, ui.canvas);
      ui.canvas = newCanvas;
      
      // Проверить, получается ли контекст у нового canvas
      return newCanvas.getContext("2d") ? newCanvas : null;
    } catch (replaceError) {
      console.error("Не удалось заменить canvas в DOM", replaceError);
      return null;
    }
  }

  function noop() {}

  /**
   * Преобразует ID звукового сигнала из формата игры в формат звукового движка.
   * Разные версии могут использовать разные именования (например, "click" vs "ui_click").
   */
  function normalizeAudioCueName(soundId) {
    // Маппинг между именами звуков в игровом коде и в аудиомодуле
    switch (soundId) {
      case "click":
        return "ui_click";           // Клик по UI
      case "jump":
        return "worker_jump";        // Прыжок рабочего
      case "pickup":
        return "order_pickup";       // Захват заказа
      case "pickupRare":
        return "urgent_order_pickup"; // Захват срочного
      case "hit":
        return "damage_taken";       // Получение урона
      default:
        return soundId;  // Неизвестный звук — передаём как есть
    }
  }

  /**
   * Пытается создать аудиоэнжин из загруженного модуля.
   * Аудиомодуль может быть создан разными способами (factory function, конструктор и т.д.).
   * Проверяем все возможные интерфейсы.
   * 
   * @param {Object} moduleRef - ссылка на глобальный аудиомодуль
   * @param {boolean} enabled - должен ли аудио быть включен по умолчанию
   * @returns {Object|null} инстанс аудиоэнжина или null
   */
  function createAudioEngineFromModule(moduleRef, enabled) {
    if (!moduleRef) {
      return null;  // Модуля вообще нет — вернёмся в этой функции
    }
    
    // Попробовать factory метод (новое API)
    if (typeof moduleRef.create === "function") {
      return moduleRef.create(enabled);
    }
    
    // Попробовать конструктор Engine (частое имя)
    if (typeof moduleRef.Engine === "function") {
      return new moduleRef.Engine(enabled);
    }
    
    // Попробовать конструктор AudioManager
    if (typeof moduleRef.AudioManager === "function") {
      return new moduleRef.AudioManager(enabled);
    }
    
    // Попробовать конструктор Manager (общее имя)
    if (typeof moduleRef.Manager === "function") {
      return new moduleRef.Manager(enabled);
    }
    
    // Может быть сам модуль — конструктор?
    if (typeof moduleRef === "function") {
      return new moduleRef(enabled);
    }
    
    // Если ничего не сработало, может это уже инстанс?
    return moduleRef && typeof moduleRef === "object" ? moduleRef : null;
  }

  /**
   * Создаёт бесшумный "аудиоэнжин" — mock объект с полным API.
   * Используется когда реальное аудио недоступно (браузер без звука, отключено, и т.д.).
   * Приложение продолжает работать, но без звуковых эффектов.
   */
  function createSilentAudioEngine(enabled) {
    return {
      on: enabled !== false,
      active: enabled !== false,
      toggle: function () {
        this.on = !this.on;
        this.active = this.on;
        return this.on;
      },
      play: noop,                    // Не делаем ничего, но API остаётся совместимым
      init: noop,
      startBg: noop,
      stopBg: noop,
      startAmbient: function () {    // Делегируем в startBg для логики
        this.startBg();
      },
      stopAmbient: function () {     // Делегируем в stopBg для логики
        this.stopBg();
      },
      setVolume: noop
    };
  }

  /**
   * Нормализует аудиоэнжин — приводит его методы к ожидаемому API.
   * Разные версии могут иметь разные имена методов, здесь мы их унифицируем.
   * 
   * Это позволяет коду использовать одинаковый API независимо от того,
   * какой именно аудиомодуль был загружен.
   * 
   * @param {Object} rawAudioEngine - сырой аудиоэнжин из модуля
   * @param {boolean} enabled - начальное состояние (звук включен/выключен)
   * @returns {Object} нормализованный аудиоэнжин с единообразным API
   */
  function normalizeAudioEngine(rawAudioEngine, enabled) {
    // Если аудиоэнжина нет — создаём бесшумный
    const audioEngine = rawAudioEngine && typeof rawAudioEngine === "object"
      ? rawAudioEngine
      : createSilentAudioEngine(enabled);
    
    // === Ищем методы toggle ===
    const rawToggle = typeof audioEngine.toggle === "function"
      ? audioEngine.toggle.bind(audioEngine)
      : typeof audioEngine.toggleSound === "function"
        ? audioEngine.toggleSound.bind(audioEngine)
        : null;
    
    // === Ищем методы play (запуск звука) ===
    const rawPlay = typeof audioEngine.play === "function"
      ? audioEngine.play.bind(audioEngine)
      : typeof audioEngine.playWarehouseSfx === "function"
        ? audioEngine.playWarehouseSfx.bind(audioEngine)
        : null;
    
    // === Ищем методы init (инициализация) ===
    const rawInit = typeof audioEngine.init === "function"
      ? audioEngine.init.bind(audioEngine)
      : typeof audioEngine.initAudioContext === "function"
        ? audioEngine.initAudioContext.bind(audioEngine)
        : null;
    
    // === Ищем методы для фонового звука ===
    const startBg = typeof audioEngine.startBg === "function"
      ? audioEngine.startBg.bind(audioEngine)
      : typeof audioEngine.startAmbient === "function"
        ? audioEngine.startAmbient.bind(audioEngine)
        : typeof audioEngine.runWarehouseAtmosphere === "function"
          ? audioEngine.runWarehouseAtmosphere.bind(audioEngine)
          : noop;
    
    const stopBg = typeof audioEngine.stopBg === "function"
      ? audioEngine.stopBg.bind(audioEngine)
      : typeof audioEngine.stopAmbient === "function"
        ? audioEngine.stopAmbient.bind(audioEngine)
        : typeof audioEngine.stopWarehouseAtmosphere === "function"
          ? audioEngine.stopWarehouseAtmosphere.bind(audioEngine)
          : noop;
    
    // === Ищем методы регулировки громкости ===
    const rawSetVolume = typeof audioEngine.setVolume === "function"
      ? audioEngine.setVolume.bind(audioEngine)
      : typeof audioEngine.setMasterVolume === "function"
        ? audioEngine.setMasterVolume.bind(audioEngine)
        : noop;

    // === Устанавливаем начальное состояние ===
    audioEngine.on = enabled !== false && audioEngine.on !== false && audioEngine.active !== false;
    audioEngine.active = audioEngine.on;
    
    // === Нормализуем метод toggle ===
    if (rawToggle) {
      audioEngine.toggle = function () {
        const next = rawToggle();
        const resolved = typeof next === "boolean"
          ? next
          : audioEngine.on !== false && audioEngine.active !== false;
        this.on = resolved;
        this.active = resolved;
        return resolved;
      };
    } else {
      audioEngine.toggle = function () {
        this.on = !this.on;
        this.active = this.on;
        return this.on;
      };
    }
    
    // === Нормализуем метод play (с преобразованием имён звуков) ===
    audioEngine.play = rawPlay
      ? function (soundId) {
          return rawPlay(normalizeAudioCueName(soundId));
        }
      : noop;
    
    audioEngine.init = rawInit || noop;
    audioEngine.setVolume = rawSetVolume;

    // === Нормализуем методы фонового звука ===
    audioEngine.startBg = startBg;
    audioEngine.stopBg = stopBg;
    audioEngine.startAmbient = typeof audioEngine.startAmbient === "function"
      ? audioEngine.startAmbient.bind(audioEngine)
      : typeof audioEngine.runWarehouseAtmosphere === "function"
        ? audioEngine.runWarehouseAtmosphere.bind(audioEngine)
        : startBg;
    audioEngine.stopAmbient = typeof audioEngine.stopAmbient === "function"
      ? audioEngine.stopAmbient.bind(audioEngine)
      : typeof audioEngine.stopWarehouseAtmosphere === "function"
        ? audioEngine.stopWarehouseAtmosphere.bind(audioEngine)
        : stopBg;

    return audioEngine;
  }

  // === ИНИЦИАЛИЗАЦИЯ СОСТОЯНИЯ ПРИЛОЖЕНИЯ ===
  let settings = loadSettings();
  let audioEngine = normalizeAudioEngine(
    createAudioEngineFromModule(audioModule, settings.audioEnabled),
    settings.audioEnabled
  );
  // Синхронизируем наше состояние с фактическим состоянием аудиоэнжина
  settings.audioEnabled = audioEngine.on !== false;

  // === СОСТОЯНИЕ ТЕКУЩЕЙ СМЕНЫ ===
  let currentGame = null;              // Ссылка на текущий инстанс игры (если запущена смена)
  let lastWorkerName = "";             // Имя последнего рабочего (для быстрого повтора)
  let lastShiftInfo = null;            // Конфиг последней смены (для возврата на меню)

  // === ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ДЛЯ КОНФИГОВ ===
  
  /**
   * Получить полную конфигурацию участка по коду.
   * Дефолт — паллетный ряд (самый типичный)
   */
  function getLineConfig(code) {
    return warehouse.lines[code] || warehouse.lines["bulk-lane"];
  }

  /**
   * Получить полную конфигурацию бригады по коду.
   * Дефолт — Север-3
   */
  function getBrigadeConfig(code) {
    return warehouse.teams[code] || warehouse.teams["north-3"];
  }

  /**
   * Собрать информацию текущей смены из UI и конфигов.
   * Читает текущие выборы из dropdowns и расширяет их полной информацией.
   * 
   * @returns {Object} объект с полной информацией о смене
   */
  function makeShiftInfo() {
    // Получить выбранный участок из UI (или дефолт)
    const lineCode = ui.lineSelect && warehouse.lines[ui.lineSelect.value] 
      ? ui.lineSelect.value 
      : "bulk-lane";
    
    // Получить выбранную бригаду из UI (или дефолт)
    const teamCode = ui.brigadeSelect && warehouse.teams[ui.brigadeSelect.value] 
      ? ui.brigadeSelect.value 
      : "north-3";
    
    const line = getLineConfig(lineCode);
    const team = getBrigadeConfig(teamCode);

    // Расширенная информация о смене, используется в UI и истории
    return {
      line: lineCode,
      lineName: line.label,           // "Паллетный ряд"
      lineShort: line.shortLabel,     // "Паллеты"
      tag: line.tag,                  // "PLT-17" (для рации)
      score: line.scoreGoal,          // 400 заказов
      plan: line.planNote,            // "не просадить поток паллет"
      rules: line.rules,              // "допускается до трёх потерь"
      handover: line.handoverPoint,   // "окно перебора" (где сдавать результаты)
      briefing: line.briefing,        // "держать паллетный поток без пересорта"
      faultMsg: line.errorMsg,        // Сообщение об ошибке
      team: teamCode,
      teamName: team.label,           // "Север-3"
      lead: team.lead,                // "Романов" (старший бригады)
      callSign: team.callSign,        // "N3" (позывной для рации)
      handoverDesk: team.deskLocation // "окно А2" (место физической сдачи)
    };
  }

  /**
   * Создать "паспорт смены" — специальный формат данных для игры.
   * Преобразует информацию смены в формат, который ожидает игровой движок.
   * 
   * Паспорт сохраняется в истории и используется для аудита и аналитики.
   */
  function makeShiftPassport(info) {
    const source = info || makeShiftInfo();

    return {
      sectorCode: source.line,
      sectorLabel: source.lineName,
      sectorShortLabel: source.lineShort,
      boardTag: source.tag,
      brigadeCode: source.team,
      brigadeLabel: source.teamName,
      brigadeLead: source.lead,
      brigadeCallSign: source.callSign,
      handoverDesk: source.handoverDesk,
      targetPoints: source.score,
      planNote: source.plan,
      issueLimitNote: source.rules,
      launchBrief: source.briefing,
      faultStamp: source.faultMsg
    };
  }

  /**
   * Запомнить выбранную смену: сохранить участок и бригаду в настройки.
   * При перезагрузке страницы ставим те же участок и бригаду.
   */
  function rememberShift() {
    const info = makeShiftInfo();
    settings.line = info.line;
    settings.team = info.team;
    settings = saveSettings(settings);
    lastShiftInfo = info;
    return info;
  }

  // === ИНИЦИАЛИЗАЦИЯ НАЧАЛЬНЫХ ЗНАЧЕНИЙ ===
  // Восстановить UI из последней сохранённой конфигурации
  if (ui.lineSelect) {
    ui.lineSelect.value = warehouse.lines[settings.line] ? settings.line : "bulk-lane";
  }
  if (ui.brigadeSelect) {
    ui.brigadeSelect.value = warehouse.teams[settings.team] ? settings.team : "north-3";
  }
  lastShiftInfo = makeShiftInfo();

  // === ФУНКЦИИ УПРАВЛЕНИЯ ИНТЕРФЕЙСОМ ===

  /**
   * Изменить размер шрифта UI и сохранить выбор.
   * Размер от 12px до 22px — экран может находиться в разных условиях видимости.
   */
  function changeFontSize(size) {
    const clamped = Math.max(12, Math.min(22, Number(size) || 16));
    settings.fontSize = clamped;
    document.documentElement.style.setProperty("--ui-font-size", clamped + "px");
    settings = saveSettings(settings);
  }

  /**
   * Получить текущий статус аудио для отображения на кнопке
   */
  function getAudioLabel() {
    return settings.audioEnabled ? "Звук: вкл" : "Звук: выкл";
  }

  /**
   * Обновить текст кнопок аудио на обоих экранах
   */
  function updateAudioButtons() {
    const label = getAudioLabel();
    if (ui.audioBtnFloor) {
      ui.audioBtnFloor.textContent = label;
    }
    if (ui.audioBtnDispatch) {
      ui.audioBtnDispatch.textContent = label;
    }
  }

  /**
   * Запустить UI-звук (клик), если аудио включено
   */
  function playUiClick() {
    if (!settings.audioEnabled || !audioEngine || typeof audioEngine.play !== "function") {
      return;
    }
    audioEngine.play("click");
  }

  /**
   * Переключиться между экранами (dispatch, game, summary).
   * Скрывает/показывает по одному экрану, обновляет доступность для скринридеров.
   */
  function switchScreen(nextScreen) {
    Object.keys(screens).forEach(function (key) {
      const elem = screens[key];
      const isActive = key === nextScreen;
      elem.classList.toggle("active", isActive);
      elem.setAttribute("aria-hidden", isActive ? "false" : "true");
    });
  }

  /**
   * Форматировать время в МM:SS для отображения на таймере.
   */
  function formatTime(seconds) {
    const whole = Math.max(0, Math.ceil(seconds));
    const mins = String(Math.floor(whole / 60)).padStart(2, "0");
    const secs = String(whole % 60).padStart(2, "0");
    return mins + ":" + secs;
  }

  /**
   * Обновить кнопку "Открыть смену" в зависимости от наличия имени рабочего.
   * Показать в кнопке выбранный участок и позывной бригады.
   */
  function updateStartButton() {
    const info = makeShiftInfo();
    const hasName = ui.workerInput.value.trim().length > 0;

    ui.startBtn.disabled = !hasName;
    ui.startBtn.textContent = hasName
      ? "Открыть смену · " + info.tag + " / " + info.callSign
      : "Открыть смену";
  }

  /**
   * Обновить HUD (heads-up display) во время игры.
   * Показывает имя, участок, время, очки, жизни в реальном времени.
   */
  function updateHUD(state) {
    // Попытаться достать информацию о смене из разных возможных ключей
    const shift = state && (state.shiftPassport || state.shiftInfo) 
      ? (state.shiftPassport || state.shiftInfo) 
      : {};

    if (ui.workerBadge) {
      ui.workerBadge.textContent = state.workerName || state.pickerName || "-";
    }
    if (ui.lineBadge) {
      const label = shift.sectorLabel || shift.boardTag || shift.tag || "Паллетный ряд";
      // В тестовом режиме показываем "TEST" префикс
      ui.lineBadge.textContent = state.testMode ? "TEST · " + label : label;
    }
    if (ui.timer) {
      // Бесконечность для тестового режима, иначе обычный таймер
      ui.timer.textContent = state.testMode ? "∞" : formatTime(state.timeLeft);
    }
    if (ui.scoreBoard) {
      ui.scoreBoard.textContent = String(state.score);
    }
    if (ui.livesBoard) {
      ui.livesBoard.textContent = String(state.lives);
    }
  }

  /**
   * Очистить таблицу результатов перед новыми данными
   */
  function clearLedger() {
    while (ui.ledgerTable.firstChild) {
      ui.ledgerTable.removeChild(ui.ledgerTable.firstChild);
    }
  }

  /**
   * Добавить строку в таблицу результатов (место, имя, очки)
   */
  function addLedgerRow(place, name, score, className) {
    const row = document.createElement("tr");
    const placeCell = document.createElement("td");
    const nameCell = document.createElement("td");
    const scoreCell = document.createElement("td");

    if (className) {
      row.className = className;
    }

    placeCell.textContent = String(place);
    nameCell.textContent = String(name);
    scoreCell.textContent = String(score);

    row.appendChild(placeCell);
    row.appendChild(nameCell);
    row.appendChild(scoreCell);
    ui.ledgerTable.appendChild(row);
  }

  /**
   * Нормализовать статистику смены (попытаться восстановить из разных форматов).
   * Разные версии игры могут отправлять разные имена полей для одних и тех же метрик.
   * 
   * @param {Object} rawStats - сырая статистика из игры
   * @returns {Object} нормализованная статистика с гарантированно валидными числами
   */
  function normalizeShiftStats(rawStats) {
    const source = rawStats && typeof rawStats === "object" ? rawStats : {};

    return {
      ordinaryPicked: Math.max(0, Number(source.ordinaryPicked) || Number(source.regular) || 0),
      urgentPicked: Math.max(0, Number(source.urgentPicked) || Number(source.urgent) || 0),
      fragilePicked: Math.max(0, Number(source.fragilePicked) || Number(source.fragile) || 0),
      falls: Math.max(0, Number(source.falls) || 0),
      cartHits: Math.max(0, Number(source.cartHits) || 0),
      cartCargoLosses: Math.max(0, Number(source.cartCargoLosses) || Number(source.cartLosses) || 0),
      cartFragileLosses: Math.max(0, Number(source.cartFragileLosses) || 0),
      urgentExpired: Math.max(0, Number(source.urgentExpired) || 0),
      fragileBroken: Math.max(0, Number(source.fragileBroken) || Number(source.fragileBreaks) || 0),
      boostsUsed: Math.max(0, Number(source.boostsUsed) || Number(source.boosts) || 0)
    };
  }

  /**
   * Объединить информацию о смене из разных источников.
   * Если у нас есть свежий результат — используем его, иначе fallback'им на сохранённые данные.
   * 
   * Это нужно потому, что дополняем данные от игры недостающей информацией о смене
   * (если она как-то потеряется при взаимодействии между модулями).
   */
  function mergeShiftInfo(summary, journalSlip) {
    // Fallback — информация последней смены, которую помним
    const fallback = makeShiftPassport(lastShiftInfo || makeShiftInfo());
    
    // Пытаемся взять информацию из разных источников по приоритету
    const source = (journalSlip && journalSlip.pickerRow && journalSlip.pickerRow.shiftPassport) ||
      (summary && (summary.shiftPassport || summary.shiftInfo)) ||
      {};

    // Собрать финальный паспорт, всегда имея что-нибудь для каждого поля
    return {
      sectorLabel: source.sectorLabel || fallback.sectorLabel,
      boardTag: source.boardTag || source.tag || fallback.boardTag,
      brigadeLabel: source.brigadeLabel || fallback.brigadeLabel,
      brigadeLead: source.brigadeLead || fallback.brigadeLead,
      brigadeCallSign: source.brigadeCallSign || fallback.brigadeCallSign,
      handoverDesk: source.handoverDesk || fallback.handoverDesk,
      targetPoints: Number(source.targetPoints) || fallback.targetPoints,
      planNote: source.planNote || source.shiftRule || fallback.planNote,
      launchBrief: source.launchBrief || fallback.launchBrief,
      issueLimitNote: source.issueLimitNote || fallback.issueLimitNote
    };
  }

  /**
   * Оценить результат тестовой смены (режим для отладки).
   * Определить, прошёл ли тест успешно или это был просто прогон.
   */
  function evaluateTest(summary, passport, rawStats) {
    const stats = normalizeShiftStats(rawStats);
    const pickedTotal = stats.ordinaryPicked + stats.urgentPicked + stats.fragilePicked;
    const incidents = stats.falls + stats.cartHits + stats.urgentExpired + stats.fragileBroken;
    const laneLabel = passport && passport.sectorLabel ? passport.sectorLabel : "участке";
    
    // Критерий успеха: минимум 6 заказов и макс 1 инцидент
    const passed = pickedTotal >= 6 && incidents <= 1;

    return {
      title: passed ? "Тест пройден" : "Тест завершён",
      badge: passed ? "Испытание пройдено" : "Тестовый прогон",
      report: "Тест на " + laneLabel + ": собрано " + pickedTotal + " заказов, инцидентов " + incidents + "."
    };
  }

  /**
   * Отобразить лидерборд на итоговом экране.
   * Показать top-10, и если рабочий не в top-10 — показать его место и результат.
   */
  function showLedger(record) {
    clearLedger();

    // Получить данные лидерборда из переданного результата или из хранилища
    const rows = Array.isArray(record && record.top10) ? record.top10 : readLeaderboard();

    if (!Array.isArray(rows) || !rows.length) {
      addLedgerRow("-", "Пока нет результатов", 0);
      return;
    }

    // Показать top-10
    rows.slice(0, 10).forEach(function (row, index) {
      const name = row && (row.name || row.pickerName) ? (row.name || row.pickerName) : "Игрок";
      const score = Math.max(0, Number(row && row.score) || 0);
      addLedgerRow(index + 1, name, score);
    });

    // Если текущий рабочий вне top-10 — показать его результат отдельной строкой
    if (record && record.rank > 10 && record.pickerRow) {
      addLedgerRow("...", record.pickerRow.name || "Игрок", Math.max(0, Number(record.pickerRow.score) || 0));
    }
  }

  /**
   * Установить строку рейтинга (место в таблице или сообщение об этом).
   * Может быть скрыта через класс hidden.
   */
  function setRankLine(message) {
    if (!message) {
      ui.rankLine.textContent = "";
      ui.rankLine.classList.add("hidden");
      return;
    }

    ui.rankLine.textContent = message;
    ui.rankLine.classList.remove("hidden");
  }

  /**
   * Показать/скрыть оверлей паузы.
   * Обновить текст кнопки паузы в зависимости от состояния.
   */
  function showPauseOverlay(paused) {
    ui.pauseOverlay.classList.toggle("hidden", !paused);
    ui.pauseOverlay.setAttribute("aria-hidden", paused ? "false" : "true");
    if (ui.pauseBtn) {
      ui.pauseBtn.textContent = paused ? "Продолжить" : "Пауза";
    }
  }

  /**
   * Остановить текущую игру, если она запущена.
   */
  function stopGame() {
    if (!currentGame) {
      return;
    }
    currentGame.stop();
    currentGame = null;
  }

  /**
   * Получить и валидировать имя рабочего из input'а.
   * Ограничить до 16 символов (в соответствии с требованиями базы).
   */
  function getWorkerName() {
    return ui.workerInput.value.trim().slice(0, 16);
  }

  /**
   * Показать ошибку и перейти на итоговый экран.
   * Сохранить информацию об ошибке для отладки.
   * 
   * Используется когда смена не может быть запущена по техническим причинам
   * (нет canvas, нет движка, и т.д.).
   */
  function reportError(errorText) {
    const info = makeShiftInfo();
    const fullMessage = info.faultMsg + ". " + errorText + " Сообщите на " + info.handover + ".";

    // Сохранить ошибку для браузера разработчика
    window.AZOTLastError = {
      at: Date.now(),
      line: info.tag,
      team: info.callSign,
      message: fullMessage,
      workerName: lastWorkerName || getWorkerName() || "unknown"
    };

    console.error("Shift startup error:", fullMessage);
    
    switchScreen("summary");
    screens.summary.scrollTop = 0;
    ui.summaryTitle.textContent = "Смена не запущена";
    ui.summaryBody.textContent = fullMessage;
    setRankLine("");
    showLedger(null);
  }

  /**
   * Составить отчёт о результатах смены для сдачи (handover).
   * Включить все детали: плана, инциденты, статус бригады.
   * 
   * Этот отчёт читает старший бригады при сдаче смены.
   */
  function composeDutyHandover(summary, journalSlip) {
    const stats = normalizeShiftStats(summary && summary.stats);
    const passport = mergeShiftInfo(summary, journalSlip);
    const notes = [];

    // === ОСНОВНАЯ ИНФОРМАЦИЯ ===
    notes.push(
      "Смена по линии " + passport.boardTag + " (" + passport.sectorLabel + "), бригада " +
      passport.brigadeLabel + " [" + passport.brigadeCallSign + "], старший " +
      passport.brigadeLead + ", сдача через " + passport.handoverDesk + "."
    );

    // === ЗАКРЫТИЕ ПЛАНА ===
    if (!summary.testMode) {
      if (summary.score >= passport.targetPoints) {
        notes.push("План участка закрыт: " + summary.score + " из " + passport.targetPoints + " очков.");
      } else {
        notes.push("План участка не закрыт: " + summary.score + " из " + passport.targetPoints + " очков.");
      }
    }

    // === СРОЧНЫЕ ЗАКАЗЫ ===
    if (stats.urgentPicked || stats.urgentExpired) {
      notes.push("Срочные заказы: собрано " + stats.urgentPicked + ", просрочено " + stats.urgentExpired + ".");
    }
    
    // === ХРУПКИЙ ТОВАР ===
    if (stats.fragilePicked || stats.fragileBroken || stats.cartFragileLosses) {
      notes.push("Хрупкие заказы: доставлено " + stats.fragilePicked + ", разбито " + stats.fragileBroken + 
                 ", увезено тележками " + stats.cartFragileLosses + ".");
    }
    
    // === ПОТЕРИ И ИНЦИДЕНТЫ ===
    if (stats.falls || stats.cartHits || stats.cartCargoLosses) {
      notes.push("Потери смены: падений " + stats.falls + ", ударов тележкой " + stats.cartHits + 
                 ", утрачено заказов " + stats.cartCargoLosses + ".");
    }
    
    // === СТАТУС ===
    if (journalSlip && journalSlip.shiftBadge) {
      notes.push("Статус смены: " + journalSlip.shiftBadge + ".");
    }
    
    // === СЛУЖЕБНЫЕ ОТМЕТКИ ===
    if (journalSlip && journalSlip.serviceNote) {
      notes.push("Служебная отметка: " + journalSlip.serviceNote + ".");
    }
    
    // === ТРЕБУЕМЫЕ ПРОВЕРКИ ===
    if (journalSlip && journalSlip.reviewFlag && journalSlip.reviewReason) {
      notes.push("Нужно внимание мастера: " + journalSlip.reviewReason + ".");
    }

    return notes.join(" ");
  }

  /**
   * Запустить смену: инициализировать игру и переключиться на игровой экран.
   * 
   * Проверяет предусловия:
   * - Имя рабочего введено
   * - Движок игры загружен
   * - Canvas доступен
   */
  function startShift() {
    const name = getWorkerName();
    const info = rememberShift();
    const shiftPassport = makeShiftPassport(info);
    
    // Ищем конструктор игры в разных глобальных местах
    const engine = gameEngine.AzotShiftRunner || window.AZOTShiftRunner;
    const canvas = ensureCanvas();

    // === ВАЛИДАЦИЯ ПРЕДУСЛОВИЙ ===
    
    if (!name) {
      // Нет имени — просто обновить состояние кнопки
      updateStartButton();
      return;
    }
    
    if (typeof engine !== "function") {
      // Критическая ошибка: движок не загружен
      reportError("Игровой движок не загрузился. Проверьте, загружен ли shift-runner.js");
      return;
    }
    
    if (!canvas) {
      // Критическая ошибка: canvas недоступен
      reportError("Canvas недоступен для рендеринга. Браузер не позволил создать рисующий контекст.");
      return;
    }

    // === ЗАПУСК СМЕНЫ ===
    stopGame();  // На случай если что-то уже запущено
    lastWorkerName = name;
    showPauseOverlay(false);
    switchScreen("game");

    // === ИНИЦИАЛИЗАЦИЯ МОДУЛЕЙ ===
    if (audioEngine && typeof audioEngine.init === "function") {
      audioEngine.init();
    }
    playUiClick();

    // === СОЗДАНИЕ ИНСТАНСА ИГРЫ ===
    currentGame = new engine(ui.canvas, {
      audioEngine: audioEngine,
      shiftPassport: shiftPassport,
      shiftInfo: shiftPassport,  // Дублируем для совместимости
      onShiftBoardUpdate: updateHUD,
      onStateUpdate: updateHUD,
      onPauseChange: showPauseOverlay,
      onPauseToggle: showPauseOverlay,
      onFinish: endShift,
      onEnd: endShift
    });

    // === СТАРТ ИГРЫ ===
    // Второй параметр true означает тестовый режим, если имя "tester"
    currentGame.start(name, name.toLowerCase() === "tester");
  }

  /**
   * Завершить смену, обработать результат и показать итоговый экран.
   * 
   * Возможные причины завершения:
   * - Нормальное завершение (complete)
   * - Истечение времени (timeout)
   * - Слишком много падений (fall)
   * - Ошибка canvas (canvas-error)
   * - Тестовый режим (testMode: true)
   */
  function endShift(result) {
    // Нормализовать результат: может быть объект или пустой
    const summary = result && typeof result === "object"
      ? result
      : {
          pickerName: lastWorkerName || getWorkerName() || "Игрок",
          score: 0,
          testMode: false,
          lives: 0,
          reason: "complete",
          shiftPassport: makeShiftPassport(lastShiftInfo || makeShiftInfo()),
          stats: {}
        };
    
    let journalSlip = null;

    currentGame = null;
    switchScreen("summary");
    screens.summary.scrollTop = 0;

    // === ТЕСТОВЫЙ РЕЖИМ ===
    if (summary.testMode) {
      const test = evaluateTest(summary, summary.shiftPassport || summary.shiftInfo, summary.stats);
      ui.summaryTitle.textContent = test.title + ": " + summary.score + " очков";
      ui.summaryBody.textContent = test.report + " Тестовый прогон не записывается в таблицу.";
      setRankLine("");
      showLedger(null);
      return;
    }

    // === ОШИБКА CANVAS ===
    if (summary.reason === "canvas-error") {
      ui.summaryTitle.textContent = "Смена не стартовала: терминал не открыл игровое поле";
      ui.summaryBody.textContent = "Браузер не дал создать canvas при уже запущенной смене. " +
                                  "Это может означать потерю контекста GPU. Перезагрузите страницу и попробуйте снова.";
      setRankLine("");
      showLedger(null);
      return;
    }

    // === ОПРЕДЕЛИТЬ ПРИЧИНУ ЗАВЕРШЕНИЯ ===
    if (summary.reason === "fall") {
      ui.summaryTitle.textContent = "Смена прервана: слишком много падений (" + summary.score + " очков)";
    } else if (summary.reason === "timeout") {
      ui.summaryTitle.textContent = "Смена закрыта по таймеру (" + summary.score + " очков)";
    } else {
      ui.summaryTitle.textContent = "Смена сдана (" + summary.score + " очков)";
    }

    // === ЗАПИСАТЬ РЕЗУЛЬТАТ В ЖУРНАЛ ===
    journalSlip = writeShiftResult({
      pickerName: summary.pickerName || summary.workerName || lastWorkerName || "Игрок",
      score: Math.max(0, Number(summary.score) || 0),
      testMode: !!summary.testMode,
      lives: Math.max(0, Number(summary.lives) || 0),
      reason: summary.reason || "complete",
      shiftPassport: summary.shiftPassport || summary.shiftInfo || makeShiftPassport(lastShiftInfo || makeShiftInfo()),
      stats: summary.stats || {}
    });

    // === СФОРМИРОВАТЬ ОТЧЁТ ДЛЯ СДАЧИ ===
    ui.summaryBody.textContent = composeDutyHandover(summary, journalSlip);
    showLedger(journalSlip);

    // === СОХРАНИТЬ ИСТОРИЮ ДЛЯ ОТЛАДКИ ===
    window.AZOTLastHandover = {
      at: Date.now(),
      lane: journalSlip && journalSlip.pickerRow && journalSlip.pickerRow.shiftPassport
        ? journalSlip.pickerRow.shiftPassport.boardTag || journalSlip.pickerRow.shiftPassport.sectorCode
        : "",
      brigade: journalSlip && journalSlip.pickerRow && journalSlip.pickerRow.shiftPassport
        ? journalSlip.pickerRow.shiftPassport.brigadeCallSign || journalSlip.pickerRow.shiftPassport.brigadeCode
        : "",
      score: summary.score,
      reviewFlag: !!(journalSlip && journalSlip.reviewFlag),
      reviewReason: journalSlip ? journalSlip.reviewReason : ""
    };

    // === ПОКАЗАТЬ РАНГ (ИЛИ ПРИЧИНУ, ПОЧЕМУ НЕ ПОКАЗАТЬ) ===
    
    if (journalSlip && journalSlip.archiveSaved === false) {
      // Архив браузера недоступен — только на экране
      setRankLine("Результат показан только на экране: браузер не позволил сохранить таблицу.");
      return;
    }
    
    if (journalSlip && journalSlip.rank > 10) {
      // Вне top-10, но есть ранг
      setRankLine("Место в общем рейтинге смен: " + journalSlip.rank + ".");
      return;
    }
    
    if (journalSlip && journalSlip.rank) {
      // В top-10
      setRankLine("Место в таблице: " + journalSlip.rank + ".");
      return;
    }

    // Нет рейтинга — не показываем
    setRankLine("");
  }

  /**
   * Вернуться на диспетчерский экран из итогов.
   * Сохранить имя рабочего и конфиг смены для удобства.
   */
  function backToMenu() {
    stopGame();
    switchScreen("dispatch");
    showPauseOverlay(false);
    ui.workerInput.value = lastWorkerName || ui.workerInput.value;
    
    // Восстановить конфиг последней смены
    if (lastShiftInfo) {
      ui.lineSelect.value = lastShiftInfo.line;
      ui.brigadeSelect.value = lastShiftInfo.team;
    }
    
    updateStartButton();
  }

  /**
   * Повторить смену с тем же рабочим.
   * Если рабочего нет — вернуться на меню.
   */
  function repeatShift() {
    if (!lastWorkerName) {
      backToMenu();
      return;
    }

    ui.workerInput.value = lastWorkerName;
    updateStartButton();
    startShift();
  }

  /**
   * Изменить размер шрифта на величину delta (+ или -).
   */
  function adjustFont(delta) {
    changeFontSize((settings.fontSize || 16) + delta);
    // При изменении размера переиинициализировать аудио (если нужно)
    if (audioEngine && typeof audioEngine.init === "function") {
      audioEngine.init();
    }
    playUiClick();
  }

  /**
   * Переключить звук включ/выкл.
   */
  function toggleAudio() {
    if (!audioEngine || typeof audioEngine.toggle !== "function") {
      // Если нет аудио движка — просто инвертируем флаг
      settings.audioEnabled = !settings.audioEnabled;
    } else {
      // Спросить у аудиодвижка его новое состояние
      settings.audioEnabled = audioEngine.toggle();
    }

    settings = saveSettings(settings);
    updateAudioButtons();
  }

  // === ПРИВЯЗКА ОБРАБОТЧИКОВ СОБЫТИЙ ===
  // Диспетчерский экран: ввод рабочего и выбор параметров
  
  ui.workerInput.addEventListener("input", updateStartButton);
  ui.startBtn.addEventListener("click", startShift);

  // Когда выбран другой участок или бригада — запомнить выбор, обновить кнопку
  ui.lineSelect.addEventListener("change", function () {
    rememberShift();
    updateStartButton();
    playUiClick();
  });

  ui.brigadeSelect.addEventListener("change", function () {
    rememberShift();
    updateStartButton();
    playUiClick();
  });

  // === ИГРОВОЙ ЭКРАН: УПРАВЛЕНИЕ СМЕНЫ ===
  
  // Кнопка пауза/продолжить
  if (ui.pauseBtn) {
    ui.pauseBtn.addEventListener("click", function () {
      if (!currentGame) {
        return;
      }
      currentGame.togglePause();
      playUiClick();
    });
  }

  // Кнопка продолжить (альтернативная, может быть на оверлее)
  if (ui.resumeBtn) {
    ui.resumeBtn.addEventListener("click", function () {
      if (!currentGame || !currentGame.paused) {
        return;
      }
      currentGame.togglePause();
      playUiClick();
    });
  }

  // Кнопка завершить смену (сдать)
  if (ui.endBtn) {
    ui.endBtn.addEventListener("click", function () {
      if (!currentGame) {
        return;
      }
      // Если на паузе — сначала продолжить
      if (currentGame.paused) {
        currentGame.togglePause();
      }
      currentGame.finishRun();
      playUiClick();
    });
  }

  // === ИТОГОВЫЙ ЭКРАН: ДЕЙСТВИЯ ПОСЛЕ СМЕНЫ ===
  
  // Повторить смену
  if (ui.repeatBtn) {
    ui.repeatBtn.addEventListener("click", function () {
      playUiClick();
      repeatShift();
    });
  }

  // Вернуться на диспетчер
  if (ui.backBtn) {
    ui.backBtn.addEventListener("click", function () {
      playUiClick();
      backToMenu();
    });
  }

  // === УПРАВЛЕНИЕ ЗВУКОМ И ШРИФТОМ (все экраны) ===
  
  if (ui.audioBtnFloor) {
    ui.audioBtnFloor.addEventListener("click", toggleAudio);
  }

  if (ui.audioBtnDispatch) {
    ui.audioBtnDispatch.addEventListener("click", toggleAudio);
  }

  // Уменьшить шрифт
  if (ui.fontDecBtn) {
    ui.fontDecBtn.addEventListener("click", function () {
      adjustFont(-1);
    });
  }

  // Увеличить шрифт
  if (ui.fontIncBtn) {
    ui.fontIncBtn.addEventListener("click", function () {
      adjustFont(1);
    });
  }

  // === ЧИСТКА НА ВЫХОД ===
  window.addEventListener("beforeunload", stopGame);

  // === ИНИЦИАЛИЗАЦИЯ UI ===
  changeFontSize(settings.fontSize);
  updateAudioButtons();
  updateStartButton();
  showLedger(null);
})();
