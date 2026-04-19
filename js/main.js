(function () {
  // Основные экраны живут в одной рамке и только переключаются.
  const screenByName = {
    dispatch: document.getElementById("azot-dispatch-scene"),
    warehouse: document.getElementById("rack-floor-scene"),
    debrief: document.getElementById("shift-ledger-scene")
  };

  // Собираем ключевые узлы интерфейса в одном месте.
  const ui = {
    nameField: document.getElementById("picker-badge-input"),
    sectorSelect: document.getElementById("azot-sector-code"),
    brigadeSelect: document.getElementById("brigade-call-code"),
    startButton: document.getElementById("dispatch-shift-btn"),
    startSoundButton: document.getElementById("dispatch-sound-toggle"),
    startFontDown: document.getElementById("dispatch-font-down"),
    startFontUp: document.getElementById("dispatch-font-up"),

    canvas: document.getElementById("game-canvas"),

    hudName: document.getElementById("hud-picker"),
    hudSector: document.getElementById("hud-sector-readout"),
    hudClock: document.getElementById("hud-shift-clock"),
    hudScore: document.getElementById("hud-cargo-score"),
    hudLives: document.getElementById("hud-fall-limit"),

    pauseButton: document.getElementById("shift-pause-btn"),
    soundButton: document.getElementById("shift-sound-btn"),
    finishButton: document.getElementById("handover-shift-btn"),
    pauseScreen: document.getElementById("forklift-pause-gate"),
    resumeButton: document.getElementById("resume-shift-btn"),

    summary: document.getElementById("handover-summary"),
    summaryNote: document.getElementById("handover-note"),
    scoreboardBody: document.getElementById("brigade-ledger-body"),
    rankLine: document.getElementById("picker-ledger-rank"),
    restartButton: document.getElementById("restart-shift-btn"),
    backButton: document.getElementById("return-dispatch-btn")
  };

  // Справочник участка и бригады нужен и для UI, и для логики смены.
  const dispatchCatalog = {
    sectors: {
      "bulk-lane": { label: "Паллетный ряд", shortLabel: "Паллеты" },
      "rush-dock": { label: "Экспресс-ворота", shortLabel: "Экспресс" },
      "fragile-bay": { label: "Хрупкий ряд", shortLabel: "Хрупкий" }
    },
    brigades: {
      "north-3": { label: "Север-3" },
      "azot-pack": { label: "Азот-комплект" },
      "night-belt": { label: "Ночная лента" }
    }
  };

  // Без этих узлов смена всё равно не взлетит.
  const requiredNodes = [
    screenByName.dispatch,
    screenByName.warehouse,
    screenByName.debrief,
    ui.nameField,
    ui.sectorSelect,
    ui.brigadeSelect,
    ui.startButton,
    ui.canvas,
    ui.scoreboardBody
  ];

  if (requiredNodes.some(function (node) { return !node; })) {
    console.error("UI is incomplete: part was not found.");
    return;
  }

  const storageApi = window.AZOTStorage || {};
  const gameApi = window.AZOTGame || {};
  const audioApi = window.AZOTAudio || {};

  const loadPrefs = typeof storageApi.loadTerminalPrefs === "function"
    ? storageApi.loadTerminalPrefs
    : function () {
        return { fontSize: 16, soundEnabled: true, sectorCode: "bulk-lane", brigadeCode: "north-3" };
      };

  const savePrefs = typeof storageApi.saveTerminalPrefs === "function"
    ? storageApi.saveTerminalPrefs
    : function (nextPrefs) {
        return nextPrefs;
      };

  const loadBoard = typeof storageApi.loadBrigadeBoard === "function"
    ? storageApi.loadBrigadeBoard
    : function () {
        return [];
      };

  const saveShift = typeof storageApi.saveShiftResult === "function"
    ? storageApi.saveShiftResult
    : function (summaryOrName, score) {
        const name = summaryOrName && typeof summaryOrName === "object"
          ? summaryOrName.pickerName
          : summaryOrName;
        const points = summaryOrName && typeof summaryOrName === "object"
          ? summaryOrName.score
          : score;

        return {
          top10: [{ name: name, score: points }],
          rank: 1,
          saved: false,
          storageMode: "memory-only",
          boardRepair: false,
          droppedRecords: 0,
          badge: "Дежурный комплектовщик",
          scoreAudit: "legacy",
          expectedScore: points,
          pickerEntry: {
            name: name,
            score: points,
            shiftPassport: summaryOrName && typeof summaryOrName === "object"
              ? summaryOrName.shiftPassport
              : readShiftPassport()
          }
        };
      };

  // Даже в аварийном режиме стартовый экран должен открыться.
  let prefs = loadPrefs();
  let audio = audioApi.AudioManager
    ? new audioApi.AudioManager(prefs.soundEnabled)
    : { enabled: !!prefs.soundEnabled, toggle: function () { this.enabled = !this.enabled; return this.enabled; }, play: function () {}, ensureContext: function () {} };

  let currentRun = null;
  let lastName = "";
  let lastPassport = null;

  function getSectorMeta(code) {
    return dispatchCatalog.sectors[code] || dispatchCatalog.sectors["bulk-lane"];
  }

  function getBrigadeMeta(code) {
    return dispatchCatalog.brigades[code] || dispatchCatalog.brigades["north-3"];
  }

  function readShiftPassport() {
    const sectorCode = ui.sectorSelect && dispatchCatalog.sectors[ui.sectorSelect.value]
      ? ui.sectorSelect.value
      : "bulk-lane";
    const brigadeCode = ui.brigadeSelect && dispatchCatalog.brigades[ui.brigadeSelect.value]
      ? ui.brigadeSelect.value
      : "north-3";
    const sectorMeta = getSectorMeta(sectorCode);
    const brigadeMeta = getBrigadeMeta(brigadeCode);

    return {
      sectorCode: sectorCode,
      sectorLabel: sectorMeta.label,
      sectorShortLabel: sectorMeta.shortLabel,
      brigadeCode: brigadeCode,
      brigadeLabel: brigadeMeta.label
    };
  }

  function syncDispatchPrefs() {
    const passport = readShiftPassport();
    prefs.sectorCode = passport.sectorCode;
    prefs.brigadeCode = passport.brigadeCode;
    prefs = savePrefs(prefs);
    lastPassport = passport;
    return passport;
  }

  if (ui.sectorSelect) {
    ui.sectorSelect.value = dispatchCatalog.sectors[prefs.sectorCode] ? prefs.sectorCode : "bulk-lane";
  }
  if (ui.brigadeSelect) {
    ui.brigadeSelect.value = dispatchCatalog.brigades[prefs.brigadeCode] ? prefs.brigadeCode : "north-3";
  }
  lastPassport = readShiftPassport();

  // Размер шрифта сразу держим в безопасных пределах.
  function writeUiFont(size) {
    const bounded = Math.max(12, Math.min(22, Number(size) || 16));
    prefs.fontSize = bounded;
    document.documentElement.style.setProperty("--ui-font-size", bounded + "px");
    prefs = savePrefs(prefs);
  }

  function soundLabel() {
    return prefs.soundEnabled ? "Звук: вкл" : "Звук: выкл";
  }

  function refreshSoundButtons() {
    const label = soundLabel();

    if (ui.soundButton) {
      ui.soundButton.textContent = label;
    }
    if (ui.startSoundButton) {
      ui.startSoundButton.textContent = label;
    }
  }

  // Этот звук нужен только как короткий отклик на действие.
  function tapUiSound() {
    if (!prefs.soundEnabled || !audio || typeof audio.play !== "function") {
      return;
    }

    audio.play("click");
  }

  // Виден всегда только один экран.
  function setScreen(nextScreen) {
    Object.keys(screenByName).forEach(function (key) {
      const node = screenByName[key];
      const show = key === nextScreen;
      node.classList.toggle("active", show);
      node.setAttribute("aria-hidden", show ? "false" : "true");
    });
  }

  function asClock(secondsLeft) {
    const whole = Math.max(0, Math.ceil(secondsLeft));
    const minutes = String(Math.floor(whole / 60)).padStart(2, "0");
    const seconds = String(whole % 60).padStart(2, "0");
    return minutes + ":" + seconds;
  }

  // Пустое имя не должно запускать смену.
  function refreshStartButton() {
    ui.startButton.disabled = ui.nameField.value.trim().length === 0;
  }

  // HUD обновляем частями, чтобы не падать на неполном DOM.
  function paintHud(snapshot) {
    if (ui.hudName) {
      ui.hudName.textContent = snapshot.pickerName;
    }
    if (ui.hudSector) {
      const sectorLabel = snapshot.shiftPassport && snapshot.shiftPassport.sectorShortLabel
        ? snapshot.shiftPassport.sectorShortLabel
        : "Паллеты";
      ui.hudSector.textContent = snapshot.testMode ? "TEST · " + sectorLabel : sectorLabel;
    }
    if (ui.hudClock) {
      ui.hudClock.textContent = snapshot.testMode ? "∞" : asClock(snapshot.timeLeft);
    }
    if (ui.hudScore) {
      ui.hudScore.textContent = String(snapshot.score);
    }
    if (ui.hudLives) {
      ui.hudLives.textContent = String(snapshot.lives);
    }
  }

  // Таблицу пересобираем руками, без строкового HTML.
  function clearScoreboard() {
    while (ui.scoreboardBody.firstChild) {
      ui.scoreboardBody.removeChild(ui.scoreboardBody.firstChild);
    }
  }

  function appendScoreRow(place, name, score, rowClass) {
    const row = document.createElement("tr");
    const placeCell = document.createElement("td");
    const nameCell = document.createElement("td");
    const scoreCell = document.createElement("td");

    if (rowClass) {
      row.className = rowClass;
    }

    placeCell.textContent = String(place);
    nameCell.textContent = String(name);
    scoreCell.textContent = String(score);

    row.appendChild(placeCell);
    row.appendChild(nameCell);
    row.appendChild(scoreCell);
    ui.scoreboardBody.appendChild(row);
  }

  // После смены показываем либо топ, либо топ с отдельной строкой игрока.
  function renderScoreboard(savedResult) {
    const board = savedResult && Array.isArray(savedResult.top10)
      ? savedResult.top10
      : loadBoard().slice(0, 10);

    clearScoreboard();

    if (!board.length) {
      appendScoreRow("—", "Пока пусто", 0, "");
      return;
    }

    if (savedResult && savedResult.rank > 10 && savedResult.pickerEntry) {
      board.slice(0, 9).forEach(function (entry, index) {
        appendScoreRow(index + 1, entry.name, entry.score, "");
      });
      appendScoreRow(10, savedResult.pickerEntry.name, savedResult.pickerEntry.score, "brigade-row-current");
      return;
    }

    board.slice(0, 10).forEach(function (entry, index) {
      const isCurrentRow = savedResult &&
        savedResult.rank === index + 1 &&
        savedResult.pickerEntry &&
        savedResult.pickerEntry.name === entry.name &&
        savedResult.pickerEntry.score === entry.score;

      appendScoreRow(index + 1, entry.name, entry.score, isCurrentRow ? "brigade-row-current" : "");
    });
  }

  function setPauseView(paused) {
    if (!ui.pauseScreen) {
      return;
    }

    ui.pauseScreen.classList.toggle("hidden", !paused);
    ui.pauseScreen.setAttribute("aria-hidden", paused ? "false" : "true");

    if (ui.pauseButton) {
      ui.pauseButton.textContent = paused ? "Продолжить" : "Пауза";
    }
  }

  // При выходе в меню старую игровую сессию надо закрыть.
  function stopCurrentRun() {
    if (!currentRun) {
      return;
    }

    currentRun.stop();
    currentRun = null;
  }

  function readEnteredName() {
    return ui.nameField.value.trim().slice(0, 16);
  }

  // Ошибку показываем и в консоль, и в экран итогов.
  function showRuntimeIssue(message) {
    console.error(message);
    setScreen("debrief");
    screenByName.debrief.scrollTop = 0;

    if (ui.summary) {
      ui.summary.textContent = "Смена не запущена";
    }

    if (ui.summaryNote) {
      ui.summaryNote.textContent = message;
    }

    if (ui.rankLine) {
      ui.rankLine.classList.add("hidden");
    }

    renderScoreboard(null);
  }

  function readShiftStats(summary) {
    const source = summary && summary.stats && typeof summary.stats === "object"
      ? summary.stats
      : {};

    return {
      ordinaryPicked: Number(source.ordinaryPicked) || 0,
      urgentPicked: Number(source.urgentPicked) || 0,
      fragilePicked: Number(source.fragilePicked) || 0,
      falls: Number(source.falls) || 0,
      cartHits: Number(source.cartHits) || 0,
      cartCargoLosses: Number(source.cartCargoLosses) || 0,
      cartFragileLosses: Number(source.cartFragileLosses) || 0,
      urgentExpired: Number(source.urgentExpired) || 0,
      fragileBroken: Number(source.fragileBroken) || 0,
      boostsUsed: Number(source.boostsUsed) || 0
    };
  }

  function readSummaryPassport(summary, savedResult) {
    if (summary && summary.shiftPassport) {
      return summary.shiftPassport;
    }

    if (savedResult && savedResult.pickerEntry && savedResult.pickerEntry.shiftPassport) {
      return savedResult.pickerEntry.shiftPassport;
    }

    return lastPassport || readShiftPassport();
  }

  function buildShiftNotes(summary, savedResult) {
    const stats = readShiftStats(summary);
    const passport = readSummaryPassport(summary, savedResult);
    const notes = [];

    if (passport && passport.sectorLabel && passport.brigadeLabel) {
      notes.push("Смена принята на участке \"" + passport.sectorLabel + "\", бригада " + passport.brigadeLabel + ".");
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

    if (stats.boostsUsed) {
      notes.push("Энергетик подбирали " + stats.boostsUsed + " раз.");
    }

    if (savedResult && savedResult.badge) {
      notes.push("Статус смены: " + savedResult.badge + ".");
    }

    if (savedResult && savedResult.scoreAudit === "mismatch") {
      notes.push("Очки не сошлись со служебной статистикой, запись помечена для проверки.");
    }

    if (savedResult && savedResult.boardRepair) {
      notes.push("Таблица бригады была восстановлена после кривых записей.");
    }

    if (savedResult && savedResult.storageMode === "trimmed") {
      notes.push("Архив таблицы урезан, чтобы браузер всё-таки сохранил смену.");
    } else if (savedResult && savedResult.storageMode === "emergency-top10") {
      notes.push("Браузер дал сохранить только аварийный топ-10.");
    } else if (savedResult && savedResult.storageMode === "memory-only") {
      notes.push("Браузер не дал сохранить таблицу, результат остался только на экране.");
    }

    if (savedResult && savedResult.droppedRecords > 0) {
      notes.push("Из журнала убраны " + savedResult.droppedRecords + " битых или лишних записей.");
    }

    if (!notes.length) {
      notes.push("Смена закрыта без служебных замечаний.");
    }

    return notes.join(" ");
  }

  // Здесь собирается новая игровая смена и её коллбеки.
  function startShift() {
    const workerName = readEnteredName();
    const Runner = gameApi.AzotShiftRunner;
    const shiftPassport = syncDispatchPrefs();

    if (!workerName) {
      refreshStartButton();
      return;
    }

    if (typeof Runner !== "function") {
      showRuntimeIssue("Игровой модуль не загрузился. Обновите страницу.");
      return;
    }

    stopCurrentRun();
    lastName = workerName;
    setPauseView(false);
    setScreen("warehouse");

    if (audio && typeof audio.ensureContext === "function") {
      audio.ensureContext();
    }
    tapUiSound();

    currentRun = new Runner(ui.canvas, {
      audio: audio,
      shiftPassport: shiftPassport,
      onShiftBoardUpdate: paintHud,
      onPauseChange: setPauseView,
      onFinish: finishShift
    });

    currentRun.start(workerName, workerName.toLowerCase() === "tester");
  }

  // На экране отчёта учитываем тестовый режим и запись в таблицу.
  function finishShift(summary) {
    let savedResult;

    setScreen("debrief");
    screenByName.debrief.scrollTop = 0;

    if (summary.testMode) {
      ui.summary.textContent = "Тестовая смена завершена: " + summary.score + " очков";
      ui.summaryNote.textContent = buildShiftNotes(summary, {
        badge: "Тестовый прогон"
      }) + " Тестовый прогон в таблицу не записывается.";
      ui.rankLine.classList.add("hidden");
      renderScoreboard(null);
      return;
    }

    if (summary.reason === "canvas-error") {
      ui.summary.textContent = "Смена не стартовала: терминал не открыл игровое поле";
      ui.summaryNote.textContent = "Браузер не дал создать canvas. Перезагрузите страницу или попробуйте другой браузер.";
      ui.rankLine.classList.add("hidden");
      renderScoreboard(null);
      return;
    }

    if (summary.reason === "fall") {
      ui.summary.textContent = "Смена прервана из-за травм: " + summary.score + " очков";
    } else if (summary.reason === "timeout") {
      ui.summary.textContent = "Смена закрыта по таймеру: " + summary.score + " очков";
    } else {
      ui.summary.textContent = "Смена сдана: " + summary.score + " очков";
    }

    savedResult = saveShift(summary);
    renderScoreboard(savedResult);
    ui.summaryNote.textContent = buildShiftNotes(summary, savedResult);

    if (savedResult.saved === false) {
      ui.rankLine.classList.add("hidden");
      return;
    }

    if (savedResult.rank > 10) {
      ui.rankLine.textContent = "Место в общем рейтинге смен: " + savedResult.rank + ". В таблице показаны 1-9 места и ваш результат отдельной строкой.";
      ui.rankLine.classList.remove("hidden");
      return;
    }

    ui.rankLine.textContent = "Место в таблице бригады: " + savedResult.rank + ".";
    ui.rankLine.classList.remove("hidden");
  }

  // Возврат на старт не должен терять последнее имя.
  function backToStart() {
    stopCurrentRun();
    setScreen("dispatch");
    setPauseView(false);
    ui.nameField.value = lastName || ui.nameField.value;
    if (lastPassport) {
      ui.sectorSelect.value = lastPassport.sectorCode;
      ui.brigadeSelect.value = lastPassport.brigadeCode;
    }
    refreshStartButton();
    renderScoreboard(null);
  }

  function replayLastShift() {
    if (!lastName) {
      backToStart();
      return;
    }

    ui.nameField.value = lastName;
    refreshStartButton();
    startShift();
  }

  // Размер шрифта меняем сразу с сохранением в настройки.
  function changeFont(step) {
    writeUiFont((prefs.fontSize || 16) + step);
    if (audio && typeof audio.ensureContext === "function") {
      audio.ensureContext();
    }
    tapUiSound();
  }

  // Переключатель должен жить даже без аудиомодуля.
  function switchSound() {
    if (!audio || typeof audio.toggle !== "function") {
      prefs.soundEnabled = !prefs.soundEnabled;
    } else {
      prefs.soundEnabled = audio.toggle();
    }

    prefs = savePrefs(prefs);
    refreshSoundButtons();
  }

  // Базовые действия вешаем отдельно, чтобы поток был читаемее.
  ui.nameField.addEventListener("input", refreshStartButton);
  ui.startButton.addEventListener("click", startShift);
  ui.sectorSelect.addEventListener("change", function () {
    syncDispatchPrefs();
    tapUiSound();
  });
  ui.brigadeSelect.addEventListener("change", function () {
    syncDispatchPrefs();
    tapUiSound();
  });

  if (ui.pauseButton) {
    ui.pauseButton.addEventListener("click", function () {
      if (!currentRun) {
        return;
      }

      currentRun.togglePause();
      tapUiSound();
    });
  }

  if (ui.resumeButton) {
    ui.resumeButton.addEventListener("click", function () {
      if (!currentRun || !currentRun.paused) {
        return;
      }

      currentRun.togglePause();
      tapUiSound();
    });
  }

  if (ui.finishButton) {
    ui.finishButton.addEventListener("click", function () {
      if (!currentRun) {
        return;
      }

      if (currentRun.paused) {
        currentRun.togglePause();
      }

      currentRun.finishRun();
      tapUiSound();
    });
  }

  if (ui.restartButton) {
    ui.restartButton.addEventListener("click", function () {
      tapUiSound();
      replayLastShift();
    });
  }

  if (ui.backButton) {
    ui.backButton.addEventListener("click", function () {
      tapUiSound();
      backToStart();
    });
  }

  if (ui.soundButton) {
    ui.soundButton.addEventListener("click", switchSound);
  }
  if (ui.startSoundButton) {
    ui.startSoundButton.addEventListener("click", switchSound);
  }

  if (ui.startFontDown) {
    ui.startFontDown.addEventListener("click", function () {
      changeFont(-1);
    });
  }

  if (ui.startFontUp) {
    ui.startFontUp.addEventListener("click", function () {
      changeFont(1);
    });
  }

  // Перед закрытием вкладки убираем живую сессию.
  window.addEventListener("beforeunload", stopCurrentRun);

  writeUiFont(prefs.fontSize);
  refreshSoundButtons();
  refreshStartButton();
  renderScoreboard(null);
})();
