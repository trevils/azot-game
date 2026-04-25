(function () {
  const screens = {
    dispatch: document.getElementById("azot-dispatch-scene"),
    game: document.getElementById("rack-floor-scene"),
    summary: document.getElementById("shift-ledger-scene")
  };

  const ui = {
    workerInput: document.getElementById("picker-badge-input"),
    lineSelect: document.getElementById("azot-sector-code"),
    brigadeSelect: document.getElementById("brigade-call-code"),
    startBtn: document.getElementById("dispatch-shift-btn"),
    audioBtnDispatch: document.getElementById("dispatch-sound-toggle"),
    fontDecBtn: document.getElementById("dispatch-font-down"),
    fontIncBtn: document.getElementById("dispatch-font-up"),
    canvas: document.getElementById("game-canvas"),
    workerBadge: document.getElementById("hud-picker"),
    lineBadge: document.getElementById("hud-sector-readout"),
    timer: document.getElementById("hud-shift-clock"),
    scoreBoard: document.getElementById("hud-cargo-score"),
    livesBoard: document.getElementById("hud-fall-limit"),
    pauseBtn: document.getElementById("shift-pause-btn"),
    audioBtnFloor: document.getElementById("shift-sound-btn"),
    endBtn: document.getElementById("handover-shift-btn"),
    pauseOverlay: document.getElementById("forklift-pause-gate"),
    resumeBtn: document.getElementById("resume-shift-btn"),
    summaryTitle: document.getElementById("handover-summary"),
    summaryBody: document.getElementById("handover-note"),
    ledgerTable: document.getElementById("brigade-ledger-body"),
    rankLine: document.getElementById("picker-ledger-rank"),
    repeatBtn: document.getElementById("restart-shift-btn"),
    backBtn: document.getElementById("return-dispatch-btn")
  };

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

  const missing = requiredElements.filter(function (item) {
    return !item.elem;
  }).map(function (item) {
    return item.id;
  });

  if (missing.length) {
    window.AZOTBootFault = {
      at: Date.now(),
      location: "dispatch-desk",
      missing: missing
    };
    console.error("Не удалось инициализировать интерфейс: " + missing.join(", "));
    return;
  }

  const warehouse = {
    lines: {
      "bulk-lane": {
        label: "Паллетный ряд",
        shortLabel: "Паллеты",
        tag: "PLT-17",
        scoreGoal: 400,
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
        scoreGoal: 180,
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
        scoreGoal: 150,
        planNote: "сдать хрупкий товар без боя",
        rules: "бой хрупкого считается браком смены",
        handoverPoint: "контрольный стол Ланиной",
        briefing: "закрыть хрупкий ряд без боя и возвратов",
        errorMsg: "Хрупкий ряд остался без игрового поля"
      }
    },
    teams: {
      "north-3": { label: "Север-3", lead: "Романов", deskLocation: "окно А2", callSign: "N3" },
      "azot-pack": { label: "Азот-комплект", lead: "Ведерникова", deskLocation: "окно Б1", callSign: "AZP" },
      "night-belt": { label: "Ночная лента", lead: "Чернов", deskLocation: "ночной пост", callSign: "NBT" }
    }
  };

  const storage = window.AZOTStorage || {};
  const audioModule = window.AZOTAudio || {};
  const gameEngine = window.AZOTGame || {};

  function normalizeSettings(rawSettings) {
    const source = rawSettings && typeof rawSettings === "object" ? rawSettings : {};
    const line = warehouse.lines[source.line] ? source.line : source.sectorCode;
    const team = warehouse.teams[source.team] ? source.team : source.brigadeCode;

    return {
      fontSize: Math.max(12, Math.min(22, Number(source.fontSize) || 16)),
      audioEnabled: source.audioEnabled !== false && source.sound !== false && source.soundEnabled !== false,
      line: warehouse.lines[line] ? line : "bulk-lane",
      team: warehouse.teams[team] ? team : "north-3"
    };
  }

  function toStoragePrefs(nextSettings) {
    const source = nextSettings && typeof nextSettings === "object" ? nextSettings : {};

    return {
      fontSize: Math.max(12, Math.min(22, Number(source.fontSize) || 16)),
      soundEnabled: source.audioEnabled !== false && source.sound !== false,
      sectorCode: warehouse.lines[source.line] ? source.line : "bulk-lane",
      brigadeCode: warehouse.teams[source.team] ? source.team : "north-3"
    };
  }

  const loadSettings = typeof storage.pullDutyConsolePrefs === "function"
    ? function () { return normalizeSettings(storage.pullDutyConsolePrefs()); }
    : typeof storage.load === "function"
      ? function () { return normalizeSettings(storage.load()); }
      : function () { return normalizeSettings(null); };

  const saveSettings = typeof storage.stashDutyConsolePrefs === "function"
    ? function (nextSettings) { return normalizeSettings(storage.stashDutyConsolePrefs(toStoragePrefs(nextSettings))); }
    : typeof storage.save === "function"
      ? function (nextSettings) { return normalizeSettings(storage.save(nextSettings)); }
      : function (nextSettings) { return normalizeSettings(nextSettings); };

  const readLeaderboard = typeof storage.readCrewWatchboard === "function"
    ? storage.readCrewWatchboard.bind(storage)
    : typeof storage.getBoard === "function"
      ? storage.getBoard.bind(storage)
      : function () { return []; };

  const writeShiftResult = typeof storage.logShiftToDutyJournal === "function"
    ? storage.logShiftToDutyJournal.bind(storage)
    : typeof storage.record === "function"
      ? storage.record.bind(storage)
      : function (summaryOrName, maybeScore) {
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

  function ensureCanvas() {
    if (!ui.canvas || !(ui.canvas instanceof HTMLCanvasElement)) {
      return null;
    }

    try {
      if (ui.canvas.getContext("2d")) {
        return ui.canvas;
      }
    } catch (error) {}

    if (!ui.canvas.parentNode) {
      return null;
    }

    const newCanvas = document.createElement("canvas");
    newCanvas.id = ui.canvas.id || "game-canvas";
    newCanvas.width = 1024;
    newCanvas.height = 768;
    newCanvas.style.cssText = ui.canvas.style.cssText || "";

    try {
      ui.canvas.parentNode.replaceChild(newCanvas, ui.canvas);
      ui.canvas = newCanvas;
      return newCanvas.getContext("2d") ? newCanvas : null;
    } catch (error) {
      return null;
    }
  }

  function noop() {}

  function createSilentAudioEngine(enabled) {
    return {
      on: enabled !== false,
      toggle: function () {
        this.on = !this.on;
        return this.on;
      },
      play: noop,
      init: noop,
      startBg: noop,
      stopBg: noop,
      startAmbient: function () {
        this.startBg();
      },
      stopAmbient: function () {
        this.stopBg();
      },
      setVolume: noop
    };
  }

  function normalizeAudioEngine(rawAudioEngine, enabled) {
    const audioEngine = rawAudioEngine && typeof rawAudioEngine === "object"
      ? rawAudioEngine
      : createSilentAudioEngine(enabled);
    const startBg = typeof audioEngine.startBg === "function"
      ? audioEngine.startBg.bind(audioEngine)
      : typeof audioEngine.startAmbient === "function"
        ? audioEngine.startAmbient.bind(audioEngine)
        : noop;
    const stopBg = typeof audioEngine.stopBg === "function"
      ? audioEngine.stopBg.bind(audioEngine)
      : typeof audioEngine.stopAmbient === "function"
        ? audioEngine.stopAmbient.bind(audioEngine)
        : noop;

    audioEngine.on = enabled !== false && audioEngine.on !== false;
    if (typeof audioEngine.toggle !== "function") {
      audioEngine.toggle = function () {
        this.on = !this.on;
        return this.on;
      };
    }
    if (typeof audioEngine.play !== "function") {
      audioEngine.play = noop;
    }
    if (typeof audioEngine.init !== "function") {
      audioEngine.init = noop;
    }
    if (typeof audioEngine.setVolume !== "function") {
      audioEngine.setVolume = noop;
    }

    audioEngine.startBg = startBg;
    audioEngine.stopBg = stopBg;
    audioEngine.startAmbient = typeof audioEngine.startAmbient === "function"
      ? audioEngine.startAmbient.bind(audioEngine)
      : startBg;
    audioEngine.stopAmbient = typeof audioEngine.stopAmbient === "function"
      ? audioEngine.stopAmbient.bind(audioEngine)
      : stopBg;

    return audioEngine;
  }

  let settings = loadSettings();
  let audioEngine = normalizeAudioEngine(
    typeof audioModule.create === "function"
      ? audioModule.create(settings.audioEnabled)
      : audioModule.Engine
        ? new audioModule.Engine(settings.audioEnabled)
        : null,
    settings.audioEnabled
  );
  settings.audioEnabled = audioEngine.on !== false;

  let currentGame = null;
  let lastWorkerName = "";
  let lastShiftInfo = null;

  function getLineConfig(code) {
    return warehouse.lines[code] || warehouse.lines["bulk-lane"];
  }

  function getBrigadeConfig(code) {
    return warehouse.teams[code] || warehouse.teams["north-3"];
  }

  function makeShiftInfo() {
    const lineCode = ui.lineSelect && warehouse.lines[ui.lineSelect.value] ? ui.lineSelect.value : "bulk-lane";
    const teamCode = ui.brigadeSelect && warehouse.teams[ui.brigadeSelect.value] ? ui.brigadeSelect.value : "north-3";
    const line = getLineConfig(lineCode);
    const team = getBrigadeConfig(teamCode);

    return {
      line: lineCode,
      lineName: line.label,
      lineShort: line.shortLabel,
      tag: line.tag,
      score: line.scoreGoal,
      plan: line.planNote,
      rules: line.rules,
      handover: line.handoverPoint,
      briefing: line.briefing,
      faultMsg: line.errorMsg,
      team: teamCode,
      teamName: team.label,
      lead: team.lead,
      callSign: team.callSign,
      handoverDesk: team.deskLocation
    };
  }

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

  function rememberShift() {
    const info = makeShiftInfo();
    settings.line = info.line;
    settings.team = info.team;
    settings = saveSettings(settings);
    lastShiftInfo = info;
    return info;
  }

  if (ui.lineSelect) {
    ui.lineSelect.value = warehouse.lines[settings.line] ? settings.line : "bulk-lane";
  }
  if (ui.brigadeSelect) {
    ui.brigadeSelect.value = warehouse.teams[settings.team] ? settings.team : "north-3";
  }
  lastShiftInfo = makeShiftInfo();

  function changeFontSize(size) {
    const clamped = Math.max(12, Math.min(22, Number(size) || 16));
    settings.fontSize = clamped;
    document.documentElement.style.setProperty("--ui-font-size", clamped + "px");
    settings = saveSettings(settings);
  }

  function getAudioLabel() {
    return settings.audioEnabled ? "Звук: вкл" : "Звук: выкл";
  }

  function updateAudioButtons() {
    const label = getAudioLabel();
    if (ui.audioBtnFloor) {
      ui.audioBtnFloor.textContent = label;
    }
    if (ui.audioBtnDispatch) {
      ui.audioBtnDispatch.textContent = label;
    }
  }

  function playUiClick() {
    if (!settings.audioEnabled || !audioEngine || typeof audioEngine.play !== "function") {
      return;
    }
    audioEngine.play("click");
  }

  function switchScreen(nextScreen) {
    Object.keys(screens).forEach(function (key) {
      const elem = screens[key];
      const show = key === nextScreen;
      elem.classList.toggle("active", show);
      elem.setAttribute("aria-hidden", show ? "false" : "true");
    });
  }

  function formatTime(seconds) {
    const whole = Math.max(0, Math.ceil(seconds));
    const mins = String(Math.floor(whole / 60)).padStart(2, "0");
    const secs = String(whole % 60).padStart(2, "0");
    return mins + ":" + secs;
  }

  function updateStartButton() {
    const info = makeShiftInfo();
    const hasName = ui.workerInput.value.trim().length > 0;

    ui.startBtn.disabled = !hasName;
    ui.startBtn.textContent = hasName
      ? "Открыть смену · " + info.tag + " / " + info.callSign
      : "Открыть смену";
  }

  function updateHUD(state) {
    const shift = state && (state.shiftPassport || state.shiftInfo) ? (state.shiftPassport || state.shiftInfo) : {};

    if (ui.workerBadge) {
      ui.workerBadge.textContent = state.workerName || state.pickerName || "-";
    }
    if (ui.lineBadge) {
      const label = shift.sectorLabel || shift.boardTag || shift.tag || "Паллетный ряд";
      ui.lineBadge.textContent = state.testMode ? "TEST · " + label : label;
    }
    if (ui.timer) {
      ui.timer.textContent = state.testMode ? "∞" : formatTime(state.timeLeft);
    }
    if (ui.scoreBoard) {
      ui.scoreBoard.textContent = String(state.score);
    }
    if (ui.livesBoard) {
      ui.livesBoard.textContent = String(state.lives);
    }
  }

  function clearLedger() {
    while (ui.ledgerTable.firstChild) {
      ui.ledgerTable.removeChild(ui.ledgerTable.firstChild);
    }
  }

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

  function mergeShiftInfo(summary, journalSlip) {
    const fallback = makeShiftPassport(lastShiftInfo || makeShiftInfo());
    const source = (journalSlip && journalSlip.pickerRow && journalSlip.pickerRow.shiftPassport) ||
      (summary && (summary.shiftPassport || summary.shiftInfo)) ||
      {};

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

  function evaluateTest(summary, passport, rawStats) {
    const stats = normalizeShiftStats(rawStats);
    const pickedTotal = stats.ordinaryPicked + stats.urgentPicked + stats.fragilePicked;
    const incidents = stats.falls + stats.cartHits + stats.urgentExpired + stats.fragileBroken;
    const laneLabel = passport && passport.sectorLabel ? passport.sectorLabel : "участке";
    const passed = pickedTotal >= 6 && incidents <= 1;

    return {
      title: passed ? "Тест пройден" : "Тест завершён",
      badge: passed ? "Испытание пройдено" : "Тестовый прогон",
      report: "Тест на " + laneLabel + ": собрано " + pickedTotal + " заказов, инцидентов " + incidents + "."
    };
  }

  function showLedger(record) {
    clearLedger();

    const rows = Array.isArray(record && record.top10) ? record.top10 : readLeaderboard();

    if (!Array.isArray(rows) || !rows.length) {
      addLedgerRow("-", "Пока нет результатов", 0);
      return;
    }

    rows.slice(0, 10).forEach(function (row, index) {
      const name = row && (row.name || row.pickerName) ? (row.name || row.pickerName) : "Игрок";
      const score = Math.max(0, Number(row && row.score) || 0);
      addLedgerRow(index + 1, name, score);
    });

    if (record && record.rank > 10 && record.pickerRow) {
      addLedgerRow("...", record.pickerRow.name || "Игрок", Math.max(0, Number(record.pickerRow.score) || 0));
    }
  }

  function setRankLine(message) {
    if (!message) {
      ui.rankLine.textContent = "";
      ui.rankLine.classList.add("hidden");
      return;
    }

    ui.rankLine.textContent = message;
    ui.rankLine.classList.remove("hidden");
  }

  function showPauseOverlay(paused) {
    ui.pauseOverlay.classList.toggle("hidden", !paused);
    ui.pauseOverlay.setAttribute("aria-hidden", paused ? "false" : "true");
    if (ui.pauseBtn) {
      ui.pauseBtn.textContent = paused ? "Продолжить" : "Пауза";
    }
  }

  function stopGame() {
    if (!currentGame) {
      return;
    }
    currentGame.stop();
    currentGame = null;
  }

  function getWorkerName() {
    return ui.workerInput.value.trim().slice(0, 16);
  }

  function reportError(errorText) {
    const info = makeShiftInfo();
    const fullMessage = info.faultMsg + ". " + errorText + " Сообщите на " + info.handover + ".";

    window.AZOTLastError = {
      at: Date.now(),
      line: info.tag,
      team: info.callSign,
      message: fullMessage
    };

    switchScreen("summary");
    screens.summary.scrollTop = 0;
    ui.summaryTitle.textContent = "Смена не запущена";
    ui.summaryBody.textContent = fullMessage;
    setRankLine("");
    showLedger(null);
  }

  function composeDutyHandover(summary, journalSlip) {
    const stats = normalizeShiftStats(summary && summary.stats);
    const passport = mergeShiftInfo(summary, journalSlip);
    const notes = [];

    notes.push(
      "Смена по линии " + passport.boardTag + " (" + passport.sectorLabel + "), бригада " +
      passport.brigadeLabel + " [" + passport.brigadeCallSign + "], старший " +
      passport.brigadeLead + ", сдача через " + passport.handoverDesk + "."
    );

    if (!summary.testMode) {
      if (summary.score >= passport.targetPoints) {
        notes.push("План участка закрыт: " + summary.score + " из " + passport.targetPoints + " очков.");
      } else {
        notes.push("План участка не закрыт: " + summary.score + " из " + passport.targetPoints + " очков.");
      }
    }

    if (stats.urgentPicked || stats.urgentExpired) {
      notes.push("Срочные заказы: собрано " + stats.urgentPicked + ", просрочено " + stats.urgentExpired + ".");
    }
    if (stats.fragilePicked || stats.fragileBroken || stats.cartFragileLosses) {
      notes.push("Хрупкие заказы: доставлено " + stats.fragilePicked + ", разбито " + stats.fragileBroken + ", увезено тележками " + stats.cartFragileLosses + ".");
    }
    if (stats.falls || stats.cartHits || stats.cartCargoLosses) {
      notes.push("Потери смены: падений " + stats.falls + ", ударов тележкой " + stats.cartHits + ", утрачено заказов " + stats.cartCargoLosses + ".");
    }
    if (journalSlip && journalSlip.shiftBadge) {
      notes.push("Статус смены: " + journalSlip.shiftBadge + ".");
    }
    if (journalSlip && journalSlip.serviceNote) {
      notes.push("Служебная отметка: " + journalSlip.serviceNote + ".");
    }
    if (journalSlip && journalSlip.reviewFlag && journalSlip.reviewReason) {
      notes.push("Нужно внимание мастера: " + journalSlip.reviewReason + ".");
    }

    return notes.join(" ");
  }

  function startShift() {
    const name = getWorkerName();
    const info = rememberShift();
    const shiftPassport = makeShiftPassport(info);
    const engine = gameEngine.AzotShiftRunner || window.AZOTShiftRunner;
    const canvas = ensureCanvas();

    if (!name) {
      updateStartButton();
      return;
    }
    if (typeof engine !== "function") {
      reportError("Игровой движок не загрузился.");
      return;
    }
    if (!canvas) {
      reportError("Canvas недоступен.");
      return;
    }

    stopGame();
    lastWorkerName = name;
    showPauseOverlay(false);
    switchScreen("game");

    if (audioEngine && typeof audioEngine.init === "function") {
      audioEngine.init();
    }
    playUiClick();

    currentGame = new engine(ui.canvas, {
      audioEngine: audioEngine,
      shiftPassport: shiftPassport,
      shiftInfo: shiftPassport,
      onShiftBoardUpdate: updateHUD,
      onStateUpdate: updateHUD,
      onPauseChange: showPauseOverlay,
      onPauseToggle: showPauseOverlay,
      onFinish: endShift,
      onEnd: endShift
    });

    currentGame.start(name, name.toLowerCase() === "tester");
  }

  function endShift(result) {
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

    if (summary.testMode) {
      const test = evaluateTest(summary, summary.shiftPassport || summary.shiftInfo, summary.stats);
      ui.summaryTitle.textContent = test.title + ": " + summary.score + " очков";
      ui.summaryBody.textContent = test.report + " Тестовый прогон не записывается в таблицу.";
      setRankLine("");
      showLedger(null);
      return;
    }

    if (summary.reason === "canvas-error") {
      ui.summaryTitle.textContent = "Смена не стартовала: терминал не открыл игровое поле";
      ui.summaryBody.textContent = "Браузер не дал создать canvas. Перезагрузите страницу и попробуйте снова.";
      setRankLine("");
      showLedger(null);
      return;
    }

    if (summary.reason === "fall") {
      ui.summaryTitle.textContent = "Смена прервана из-за падений: " + summary.score + " очков";
    } else if (summary.reason === "timeout") {
      ui.summaryTitle.textContent = "Смена закрыта по таймеру: " + summary.score + " очков";
    } else {
      ui.summaryTitle.textContent = "Смена сдана: " + summary.score + " очков";
    }

    journalSlip = writeShiftResult({
      pickerName: summary.pickerName || summary.workerName || lastWorkerName || "Игрок",
      score: Math.max(0, Number(summary.score) || 0),
      testMode: !!summary.testMode,
      lives: Math.max(0, Number(summary.lives) || 0),
      reason: summary.reason || "complete",
      shiftPassport: summary.shiftPassport || summary.shiftInfo || makeShiftPassport(lastShiftInfo || makeShiftInfo()),
      stats: summary.stats || {}
    });

    ui.summaryBody.textContent = composeDutyHandover(summary, journalSlip);
    showLedger(journalSlip);

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

    if (journalSlip && journalSlip.archiveSaved === false) {
      setRankLine("Результат показан только на экране: браузер не сохранил таблицу.");
      return;
    }
    if (journalSlip && journalSlip.rank > 10) {
      setRankLine("Место в общем рейтинге смен: " + journalSlip.rank + ".");
      return;
    }
    if (journalSlip && journalSlip.rank) {
      setRankLine("Место в таблице: " + journalSlip.rank + ".");
      return;
    }

    setRankLine("");
  }

  function backToMenu() {
    stopGame();
    switchScreen("dispatch");
    showPauseOverlay(false);
    ui.workerInput.value = lastWorkerName || ui.workerInput.value;
    if (lastShiftInfo) {
      ui.lineSelect.value = lastShiftInfo.line;
      ui.brigadeSelect.value = lastShiftInfo.team;
    }
    updateStartButton();
  }

  function repeatShift() {
    if (!lastWorkerName) {
      backToMenu();
      return;
    }

    ui.workerInput.value = lastWorkerName;
    updateStartButton();
    startShift();
  }

  function adjustFont(delta) {
    changeFontSize((settings.fontSize || 16) + delta);
    if (audioEngine && typeof audioEngine.init === "function") {
      audioEngine.init();
    }
    playUiClick();
  }

  function toggleAudio() {
    if (!audioEngine || typeof audioEngine.toggle !== "function") {
      settings.audioEnabled = !settings.audioEnabled;
    } else {
      settings.audioEnabled = audioEngine.toggle();
    }

    settings = saveSettings(settings);
    updateAudioButtons();
  }

  ui.workerInput.addEventListener("input", updateStartButton);
  ui.startBtn.addEventListener("click", startShift);

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

  if (ui.pauseBtn) {
    ui.pauseBtn.addEventListener("click", function () {
      if (!currentGame) {
        return;
      }
      currentGame.togglePause();
      playUiClick();
    });
  }

  if (ui.resumeBtn) {
    ui.resumeBtn.addEventListener("click", function () {
      if (!currentGame || !currentGame.paused) {
        return;
      }
      currentGame.togglePause();
      playUiClick();
    });
  }

  if (ui.endBtn) {
    ui.endBtn.addEventListener("click", function () {
      if (!currentGame) {
        return;
      }
      if (currentGame.paused) {
        currentGame.togglePause();
      }
      currentGame.finishRun();
      playUiClick();
    });
  }

  if (ui.repeatBtn) {
    ui.repeatBtn.addEventListener("click", function () {
      playUiClick();
      repeatShift();
    });
  }

  if (ui.backBtn) {
    ui.backBtn.addEventListener("click", function () {
      playUiClick();
      backToMenu();
    });
  }

  if (ui.audioBtnFloor) {
    ui.audioBtnFloor.addEventListener("click", toggleAudio);
  }

  if (ui.audioBtnDispatch) {
    ui.audioBtnDispatch.addEventListener("click", toggleAudio);
  }

  if (ui.fontDecBtn) {
    ui.fontDecBtn.addEventListener("click", function () {
      adjustFont(-1);
    });
  }

  if (ui.fontIncBtn) {
    ui.fontIncBtn.addEventListener("click", function () {
      adjustFont(1);
    });
  }

  window.addEventListener("beforeunload", stopGame);

  changeFontSize(settings.fontSize);
  updateAudioButtons();
  updateStartButton();
  showLedger(null);
})();
