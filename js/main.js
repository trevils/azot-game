(function () {
  const terminalScenes = {
    dutyDesk: document.getElementById("azot-dispatch-scene"),
    rackFloor: document.getElementById("rack-floor-scene"),
    handoverDesk: document.getElementById("shift-ledger-scene")
  };

  const dutyDesk = {
    badgeAliasInput: document.getElementById("picker-badge-input"),
    laneSelect: document.getElementById("azot-sector-code"),
    crewSelect: document.getElementById("brigade-call-code"),
    releaseShiftButton: document.getElementById("dispatch-shift-btn"),
    dispatchSoundButton: document.getElementById("dispatch-sound-toggle"),
    typeDownButton: document.getElementById("dispatch-font-down"),
    typeUpButton: document.getElementById("dispatch-font-up"),

    shiftCanvas: document.getElementById("game-canvas"),

    boardBadge: document.getElementById("hud-picker"),
    boardLane: document.getElementById("hud-sector-readout"),
    boardTimer: document.getElementById("hud-shift-clock"),
    boardScore: document.getElementById("hud-cargo-score"),
    boardLives: document.getElementById("hud-fall-limit"),

    freezeShiftButton: document.getElementById("shift-pause-btn"),
    floorSoundButton: document.getElementById("shift-sound-btn"),
    closeShiftButton: document.getElementById("handover-shift-btn"),
    freezeGate: document.getElementById("forklift-pause-gate"),
    reopenShiftButton: document.getElementById("resume-shift-btn"),

    handoverHeadline: document.getElementById("handover-summary"),
    handoverBody: document.getElementById("handover-note"),
    brigadeTableBody: document.getElementById("brigade-ledger-body"),
    handoverRankLine: document.getElementById("picker-ledger-rank"),
    rerunButton: document.getElementById("restart-shift-btn"),
    returnButton: document.getElementById("return-dispatch-btn")
  };

  // Здесь лежит рабочая карта склада: коды линий, планки и столы сдачи.
  const azotDutyBoard = {
    sectors: {
      "bulk-lane": {
        label: "Паллетный ряд",
        shortLabel: "Паллеты",
        boardTag: "PLT-17",
        targetPoints: 160,
        planNote: "не просадить поток паллет",
        issueLimitNote: "допускается до трёх потерь по участку",
        shiftRoute: "окно перебора",
        launchBrief: "держать паллетный поток без пересорта",
        faultStamp: "Паллетная линия не подняла смену"
      },
      "rush-dock": {
        label: "Экспресс-ворота",
        shortLabel: "Экспресс",
        boardTag: "EXP-04",
        targetPoints: 180,
        planNote: "не сорвать срочные окна",
        issueLimitNote: "просрочка срочных недопустима",
        shiftRoute: "стол Климова",
        launchBrief: "держать срочные окна без просадки",
        faultStamp: "Экспресс-ворота потеряли пульт смены"
      },
      "fragile-bay": {
        label: "Хрупкий ряд",
        shortLabel: "Хрупкий",
        boardTag: "FRG-09",
        targetPoints: 150,
        planNote: "сдать хрупкий товар без боя",
        issueLimitNote: "бой хрупкого считается браком смены",
        shiftRoute: "контрольный стол Ланиной",
        launchBrief: "закрыть хрупкий ряд без боя и возвратов",
        faultStamp: "Хрупкий ряд остался без игрового поля"
      }
    },
    brigades: {
      "north-3": { label: "Север-3", lead: "Романов", handoverDesk: "окно А2", callSign: "N3" },
      "azot-pack": { label: "Азот-комплект", lead: "Ведерникова", handoverDesk: "окно Б1", callSign: "AZP" },
      "night-belt": { label: "Ночная лента", lead: "Чернов", handoverDesk: "ночной пост", callSign: "NBT" }
    }
  };

  const mustExistOnDesk = [
    terminalScenes.dutyDesk,
    terminalScenes.rackFloor,
    terminalScenes.handoverDesk,
    dutyDesk.badgeAliasInput,
    dutyDesk.laneSelect,
    dutyDesk.crewSelect,
    dutyDesk.releaseShiftButton,
    dutyDesk.shiftCanvas,
    dutyDesk.brigadeTableBody
  ];
  const mustExistLabels = [
    "azot-dispatch-scene",
    "rack-floor-scene",
    "shift-ledger-scene",
    "picker-badge-input",
    "azot-sector-code",
    "brigade-call-code",
    "dispatch-shift-btn",
    "game-canvas",
    "brigade-ledger-body"
  ];
  const missingDeskNodes = mustExistOnDesk.map(function (node, index) {
    return node ? "" : mustExistLabels[index];
  }).filter(function (label) {
    return !!label;
  });

  if (missingDeskNodes.length) {
    window.AZOTBootFault = {
      at: Date.now(),
      post: "dispatch-desk",
      missingNodes: missingDeskNodes,
      note: "Пульт не поднялся полностью"
    };
    console.error("AZOT dispatch desk boot aborted. Missing nodes: " + missingDeskNodes.join(", "));
    return;
  }
// инициализации на DOM сразу, чтобы не драться с async.
// TODO: Переделать на EventListener когда перейдём на модули, но пока так.
  const archiveDesk = window.AZOTStorage || {};  // хранилище смен
  const depotSound = window.AZOTAudio || {};      //(может быть disabled)
  const gameCore = window.AZOTGame || {};         // AzotShiftRunner

  // Версия 3: требовала, чтобы в случае block canvas мы создавали новый.
  // Раньше игра просто падала. На старых частый случай.
  function restoreCanvasIfNeeded() {
    if (!dutyDesk.shiftCanvas || !(dutyDesk.shiftCanvas instanceof HTMLCanvasElement)) return null;
    
    let ctx;
    try {
      ctx = dutyDesk.shiftCanvas.getContext("2d");
      if (ctx) return dutyDesk.shiftCanvas;
    } catch (blocked) {
      // Браузер заблокировал canvas (Security policy)
      console.warn("Canvas context blocked by browser policy");
    }

    if (!dutyDesk.shiftCanvas.parentNode) return null;
    
    // Пересоздаём canvas от нуля
    const fallback = document.createElement("canvas");
    fallback.id = dutyDesk.shiftCanvas.id || "game-canvas";
    fallback.width = 1024;  // требования тз по жесткой рамке разрешения
    fallback.height = 768;
    fallback.style.cssText = dutyDesk.shiftCanvas.style.cssText || "";
    
    try {
      dutyDesk.shiftCanvas.parentNode.replaceChild(fallback, dutyDesk.shiftCanvas);
      dutyDesk.shiftCanvas = fallback;
    } catch (replaceErr) {
      console.error("Failed to replace canvas in DOM", replaceErr);
      return null;
    }
    
    try {
      return fallback.getContext("2d") ? fallback : null;
    } catch (e) {
      return null;
    }
  }

  const pullDutyConsolePrefs = typeof archiveDesk.pullDutyConsolePrefs === "function"
    ? archiveDesk.pullDutyConsolePrefs
    : function () {
        return { fontSize: 16, soundEnabled: true, sectorCode: "bulk-lane", brigadeCode: "north-3" };
      };

  const stashDutyConsolePrefs = typeof archiveDesk.stashDutyConsolePrefs === "function"
    ? archiveDesk.stashDutyConsolePrefs
    : function (nextPrefs) {
        return nextPrefs;
      };

  const readCrewWatchboard = typeof archiveDesk.readCrewWatchboard === "function"
    ? archiveDesk.readCrewWatchboard
    : function () {
        return [];
      };

  const logShiftToDutyJournal = typeof archiveDesk.logShiftToDutyJournal === "function"
    ? archiveDesk.logShiftToDutyJournal
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
          archiveSaved: false,
          archiveMode: "screen-only",
          archiveWasRepaired: false,
          removedRows: 0,
          shiftBadge: "Дежурный комплектовщик",
          scoreCheck: "legacy-row",
          expectedPoints: points,
          reviewFlag: false,
          reviewReason: "",
          archiveIssue: "browser-blocked-ledger",
          pickerRow: {
            name: name,
            score: points,
            shiftPassport: summaryOrName && typeof summaryOrName === "object"
              ? summaryOrName.shiftPassport
              : buildDutySlip()
          },
          serviceNote: "",
          shiftBoss: "",
          auditDesk: "",
          auditRowPinned: false
        };
      };

  let terminalPrefs = pullDutyConsolePrefs();
  let terminalAudio = depotSound.AudioManager
    ? new depotSound.AudioManager(terminalPrefs.soundEnabled)
    : { enabled: !!terminalPrefs.soundEnabled, toggle: function () { this.enabled = !this.enabled; return this.enabled; }, play: function () {}, ensureContext: function () {} };

  let activeShiftRun = null;
  let lastBadgeAlias = "";
  let lastDutySlip = null;

  function takeLaneCard(code) {
    return azotDutyBoard.sectors[code] || azotDutyBoard.sectors["bulk-lane"];
  }

  function takeCrewCard(code) {
    return azotDutyBoard.brigades[code] || azotDutyBoard.brigades["north-3"];
  }

  function buildDutySlip() {
    const sectorCode = dutyDesk.laneSelect && azotDutyBoard.sectors[dutyDesk.laneSelect.value]
      ? dutyDesk.laneSelect.value
      : "bulk-lane";
    const brigadeCode = dutyDesk.crewSelect && azotDutyBoard.brigades[dutyDesk.crewSelect.value]
      ? dutyDesk.crewSelect.value
      : "north-3";
    const sectorMeta = takeLaneCard(sectorCode);
    const brigadeMeta = takeCrewCard(brigadeCode);

    return {
      sectorCode: sectorCode,
      sectorLabel: sectorMeta.label,
      sectorShortLabel: sectorMeta.shortLabel,
      boardTag: sectorMeta.boardTag,
      targetPoints: sectorMeta.targetPoints,
      planNote: sectorMeta.planNote,
      issueLimitNote: sectorMeta.issueLimitNote,
      shiftRoute: sectorMeta.shiftRoute,
      launchBrief: sectorMeta.launchBrief,
      faultStamp: sectorMeta.faultStamp,
      brigadeCode: brigadeCode,
      brigadeLabel: brigadeMeta.label,
      brigadeLead: brigadeMeta.lead,
      brigadeCallSign: brigadeMeta.callSign,
      handoverDesk: brigadeMeta.handoverDesk
    };
  }

  function rememberDutySlip() {
    const passport = buildDutySlip();
    terminalPrefs.sectorCode = passport.sectorCode;
    terminalPrefs.brigadeCode = passport.brigadeCode;
    terminalPrefs = stashDutyConsolePrefs(terminalPrefs);
    lastDutySlip = passport;
    return passport;
  }

  if (dutyDesk.laneSelect) {
    dutyDesk.laneSelect.value = azotDutyBoard.sectors[terminalPrefs.sectorCode] ? terminalPrefs.sectorCode : "bulk-lane";
  }
  if (dutyDesk.crewSelect) {
    dutyDesk.crewSelect.value = azotDutyBoard.brigades[terminalPrefs.brigadeCode] ? terminalPrefs.brigadeCode : "north-3";
  }
  lastDutySlip = buildDutySlip();

  function setConsoleTypeSize(size) {
    const bounded = Math.max(12, Math.min(22, Number(size) || 16));
    terminalPrefs.fontSize = bounded;
    document.documentElement.style.setProperty("--ui-font-size", bounded + "px");
    terminalPrefs = stashDutyConsolePrefs(terminalPrefs);
  }

  function buildSoundSwitchLabel() {
    return terminalPrefs.soundEnabled ? "Звук: вкл" : "Звук: выкл";
  }

  function paintSoundToggles() {
    const label = buildSoundSwitchLabel();

    if (dutyDesk.floorSoundButton) {
      dutyDesk.floorSoundButton.textContent = label;
    }
    if (dutyDesk.dispatchSoundButton) {
      dutyDesk.dispatchSoundButton.textContent = label;
    }
  }

  function beepDutyKey() {
    if (!terminalPrefs.soundEnabled || !terminalAudio || typeof terminalAudio.play !== "function") {
      return;
    }

    terminalAudio.play("click");
  }

  function showDeskMode(nextMode) {
    Object.keys(terminalScenes).forEach(function (key) {
      const node = terminalScenes[key];
      const show = key === nextMode;
      node.classList.toggle("active", show);
      node.setAttribute("aria-hidden", show ? "false" : "true");
    });
  }

  function formatDutyTimer(secondsLeft) {
    const whole = Math.max(0, Math.ceil(secondsLeft));
    const minutes = String(Math.floor(whole / 60)).padStart(2, "0");
    const seconds = String(whole % 60).padStart(2, "0");
    return minutes + ":" + seconds;
  }

  function paintReleaseShiftButton() {
    const slip = buildDutySlip();
    const hasName = dutyDesk.badgeAliasInput.value.trim().length > 0;

    dutyDesk.releaseShiftButton.disabled = !hasName;
    dutyDesk.releaseShiftButton.textContent = hasName
      ? "Открыть смену · " + slip.boardTag + " / " + slip.brigadeCallSign
      : "Открыть смену";
  }

  function paintUpperBoard(snapshot) {
    if (dutyDesk.boardBadge) {
      dutyDesk.boardBadge.textContent = snapshot.pickerName;
    }
    if (dutyDesk.boardLane) {
      const sectorLabel = snapshot.shiftPassport && snapshot.shiftPassport.boardTag
        ? snapshot.shiftPassport.boardTag
        : "Паллеты";
      dutyDesk.boardLane.textContent = snapshot.testMode ? "TEST · " + sectorLabel : sectorLabel;
    }
    if (dutyDesk.boardTimer) {
      dutyDesk.boardTimer.textContent = snapshot.testMode ? "∞" : formatDutyTimer(snapshot.timeLeft);
    }
    if (dutyDesk.boardScore) {
      dutyDesk.boardScore.textContent = String(snapshot.score);
    }
    if (dutyDesk.boardLives) {
      dutyDesk.boardLives.textContent = String(snapshot.lives);
    }
  }

  function clearCrewBoard() {
    while (dutyDesk.brigadeTableBody.firstChild) {
      dutyDesk.brigadeTableBody.removeChild(dutyDesk.brigadeTableBody.firstChild);
    }
  }

  function drawCrewBoardRow(place, name, score, rowClass) {
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
    dutyDesk.brigadeTableBody.appendChild(row);
  }

  function paintCrewBoard(journalSlip) {
    const board = journalSlip && Array.isArray(journalSlip.top10)
      ? journalSlip.top10
      : readCrewWatchboard().slice(0, 10);
    const activeCrewCard = takeCrewCard(dutyDesk.crewSelect ? dutyDesk.crewSelect.value : "");

    clearCrewBoard();

    if (!board.length) {
      drawCrewBoardRow("—", "Журнал " + activeCrewCard.callSign + " пуст", 0, "");
      return;
    }

    if (journalSlip && journalSlip.rank > 10 && journalSlip.pickerRow) {
      board.slice(0, 9).forEach(function (entry, index) {
        drawCrewBoardRow(index + 1, entry.name, entry.score, "");
      });
      drawCrewBoardRow(10, journalSlip.pickerRow.name, journalSlip.pickerRow.score, "brigade-row-current");
      return;
    }

    board.slice(0, 10).forEach(function (entry, index) {
      const isCurrentRow = journalSlip &&
        journalSlip.rank === index + 1 &&
        journalSlip.pickerRow &&
        journalSlip.pickerRow.name === entry.name &&
        journalSlip.pickerRow.score === entry.score;

      drawCrewBoardRow(index + 1, entry.name, entry.score, isCurrentRow ? "brigade-row-current" : "");
    });
  }

  function paintFreezeGate(paused) {
    if (!dutyDesk.freezeGate) {
      return;
    }

    dutyDesk.freezeGate.classList.toggle("hidden", !paused);
    dutyDesk.freezeGate.setAttribute("aria-hidden", paused ? "false" : "true");

    if (dutyDesk.freezeShiftButton) {
      dutyDesk.freezeShiftButton.textContent = paused ? "Продолжить" : "Пауза";
    }
  }

  function retireActiveRun() {
    if (!activeShiftRun) {
      return;
    }

    activeShiftRun.stop();
    activeShiftRun = null;
  }

  function readBadgeAlias() {
    return dutyDesk.badgeAliasInput.value.trim().slice(0, 16);
  }

  // Если линия не поднялась, оставляем маршрутный инцидент для мастера.
  function routeDeskFault(message) {
    const slip = buildDutySlip();
    const faultTicket = slip.boardTag + "-" + slip.brigadeCallSign + "-" + String(Date.now()).slice(-5);
    const routedMessage = "[" + faultTicket + "] " + slip.faultStamp + ". " + message + " Сообщите на " + slip.shiftRoute + ".";
    const dutyIncidentQueue = Array.isArray(window.AZOTDutyIncidentQueue)
      ? window.AZOTDutyIncidentQueue
      : [];

    console.error(routedMessage);
    dutyIncidentQueue.push({
      ticket: faultTicket,
      openedAt: Date.now(),
      lane: slip.boardTag,
      brigade: slip.brigadeCallSign,
      route: slip.shiftRoute,
      handoverDesk: slip.handoverDesk,
      message: routedMessage
    });
    window.AZOTDutyIncidentQueue = dutyIncidentQueue.slice(-12);
    window.AZOTLastDeskFault = {
      at: Date.now(),
      ticket: faultTicket,
      lane: slip.boardTag,
      brigade: slip.brigadeCallSign,
      message: routedMessage
    };

    showDeskMode("handoverDesk");
    terminalScenes.handoverDesk.scrollTop = 0;

    if (dutyDesk.handoverHeadline) {
      dutyDesk.handoverHeadline.textContent = "Смена не запущена";
    }

    if (dutyDesk.handoverBody) {
      dutyDesk.handoverBody.textContent = routedMessage;
    }

    if (dutyDesk.handoverRankLine) {
      dutyDesk.handoverRankLine.classList.add("hidden");
    }

    paintCrewBoard(null);
  }

  function liftShiftFacts(summary) {
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

  function rebuildDutySlip(summary, journalSlip) {
    const fallbackPassport = lastDutySlip || buildDutySlip();
    const rawPassport = summary && summary.shiftPassport
      ? summary.shiftPassport
      : journalSlip && journalSlip.pickerRow && journalSlip.pickerRow.shiftPassport
        ? journalSlip.pickerRow.shiftPassport
        : fallbackPassport;
    const sectorCard = takeLaneCard(rawPassport && rawPassport.sectorCode);
    const brigadeCard = takeCrewCard(rawPassport && rawPassport.brigadeCode);

    return {
      sectorCode: rawPassport && rawPassport.sectorCode ? rawPassport.sectorCode : fallbackPassport.sectorCode,
      sectorLabel: rawPassport && rawPassport.sectorLabel ? rawPassport.sectorLabel : sectorCard.label,
      sectorShortLabel: rawPassport && rawPassport.sectorShortLabel ? rawPassport.sectorShortLabel : sectorCard.shortLabel,
      boardTag: rawPassport && rawPassport.boardTag ? rawPassport.boardTag : sectorCard.boardTag,
      targetPoints: typeof rawPassport.targetPoints === "number" && rawPassport.targetPoints > 0
        ? rawPassport.targetPoints
        : sectorCard.targetPoints,
      planNote: rawPassport && rawPassport.planNote ? rawPassport.planNote : sectorCard.planNote,
      issueLimitNote: rawPassport && rawPassport.issueLimitNote ? rawPassport.issueLimitNote : sectorCard.issueLimitNote,
      shiftRoute: rawPassport && rawPassport.shiftRoute ? rawPassport.shiftRoute : sectorCard.shiftRoute,
      launchBrief: rawPassport && rawPassport.launchBrief ? rawPassport.launchBrief : sectorCard.launchBrief,
      faultStamp: rawPassport && rawPassport.faultStamp ? rawPassport.faultStamp : sectorCard.faultStamp,
      brigadeCode: rawPassport && rawPassport.brigadeCode ? rawPassport.brigadeCode : fallbackPassport.brigadeCode,
      brigadeLabel: rawPassport && rawPassport.brigadeLabel ? rawPassport.brigadeLabel : brigadeCard.label,
      brigadeLead: rawPassport && rawPassport.brigadeLead ? rawPassport.brigadeLead : brigadeCard.lead,
      brigadeCallSign: rawPassport && rawPassport.brigadeCallSign ? rawPassport.brigadeCallSign : brigadeCard.callSign,
      handoverDesk: rawPassport && rawPassport.handoverDesk ? rawPassport.handoverDesk : brigadeCard.handoverDesk
    };
  }

  // По этому тексту мастер видит, чем закончилась смена и куда ушел хвост.
  function composeDutyHandover(summary, journalSlip) {
    const stats = liftShiftFacts(summary);
    const passport = rebuildDutySlip(summary, journalSlip);
    const notes = [];

    if (passport && passport.sectorLabel && passport.brigadeLabel) {
      notes.push(
        "Смена принята на линии " + passport.boardTag + " (" + passport.sectorLabel + "), бригада " + passport.brigadeLabel +
        " [" + passport.brigadeCallSign + "], старший " + passport.brigadeLead + ", сдача через " + passport.handoverDesk + "."
      );
    }

    if (typeof passport.targetPoints === "number") {
      if (summary.score >= passport.targetPoints) {
        notes.push("План участка закрыт: " + summary.score + " из " + passport.targetPoints + " очков.");
      } else {
        notes.push(
          "План участка не закрыт: " + summary.score + " из " + passport.targetPoints +
          " очков. Основная задача смены была — " + passport.planNote + ". На запуске линии держали правило: " + passport.launchBrief + "."
        );
      }
    }

    if (summary.score >= passport.targetPoints + 35) {
      notes.push("Линия вышла в запас по очкам и может закрыть соседний поток без пересменки.");
    } else if (summary.score > 0 && summary.score < passport.targetPoints - 45) {
      notes.push("Смена сильно просела относительно планки, мастеру стоит проверить стартовый разбор линии и расклад тележек.");
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

    if (journalSlip && journalSlip.shiftBadge) {
      notes.push("Статус смены: " + journalSlip.shiftBadge + ".");
    }

    if (journalSlip && journalSlip.serviceNote) {
      notes.push("Служебная отметка смены: " + journalSlip.serviceNote + ".");
    }

    if (!journalSlip || !journalSlip.reviewFlag) {
      if (stats.urgentExpired === 0 && stats.fragileBroken === 0 && stats.cartHits === 0 && stats.falls === 0) {
        notes.push("Смена прошла чисто: линия не дала ни травмы, ни просрочки, ни боя.");
      }
    }

    if (journalSlip && journalSlip.reviewFlag && journalSlip.reviewReason) {
      if (journalSlip.shiftBoss && journalSlip.auditDesk) {
        notes.push("Нужно внимание мастера: " + journalSlip.reviewReason + ". Проверка у " + journalSlip.shiftBoss + ", сдача на " + journalSlip.auditDesk + ".");
      } else if (journalSlip.shiftBoss) {
        notes.push("Нужно внимание мастера: " + journalSlip.reviewReason + ". Проверка у " + journalSlip.shiftBoss + ".");
      } else {
        notes.push("Нужно внимание мастера: " + journalSlip.reviewReason + ".");
      }
    }

    if (passport && passport.issueLimitNote && (stats.falls || stats.cartHits || stats.cartCargoLosses || stats.urgentExpired || stats.fragileBroken)) {
      notes.push("Для этого участка действует правило: " + passport.issueLimitNote + ".");
    }

    if (journalSlip && journalSlip.archiveWasRepaired) {
      notes.push("Журнал бригады пришлось чинить перед записью новой смены.");
    }

    if (journalSlip && journalSlip.archiveMode === "trimmed-archive") {
      notes.push("Архив урезан до сокращённой версии, иначе браузер не принимал запись.");
    } else if (journalSlip && journalSlip.archiveMode === "watchlist-top10") {
      notes.push("В браузере поместился только сторожевой топ-10 смен.");
    } else if (journalSlip && journalSlip.archiveMode === "screen-only") {
      notes.push("Браузер не дал сохранить журнал, итог остался только на экране.");
    }

    if (journalSlip && journalSlip.removedRows > 0) {
      notes.push("Из архива вычищены " + journalSlip.removedRows + " битых или лишних строк.");
    }

    if (journalSlip && journalSlip.auditRowPinned) {
      notes.push("Служебную смену с замечанием оставили в архиве принудительно, даже вне обычного лимита.");
    }

    if (journalSlip && journalSlip.archiveIssue === "ledger-quarantined") {
      notes.push("Старый битый архив убран в карантин, журнал собран заново.");
    } else if (journalSlip && journalSlip.archiveIssue === "legacy-ledger-migrated") {
      notes.push("Журнал со старого формата подтянули в новый архив смены без потери таблицы.");
    } else if (journalSlip && journalSlip.archiveIssue === "archive-trimmed-for-browser") {
      notes.push("Браузер отказался держать полный архив и принял только облегчённую версию.");
    } else if (journalSlip && journalSlip.archiveIssue === "only-top10-fits") {
      notes.push("После переполнения удалось удержать только верхушку рейтинга.");
    } else if (journalSlip && journalSlip.archiveIssue === "double-handover-pruned") {
      notes.push("Из журнала сняты дубли смены, которые обычно остаются после повторной сдачи.");
    }

    if (!notes.length) {
      notes.push("Смена закрыта без служебных замечаний.");
    }

    return notes.join(" ");
  }

  function launchDutyRun() {
    const workerName = readBadgeAlias();
    const shiftPassport = rememberDutySlip();
    const gameDef = gameCore.AzotShiftRunner || window.AZOTShiftRunner;
    const cvs = restoreCanvasIfNeeded();

    // Запрет начала смены без имени, чтобы не было анонимных записей в журнале и рейтинге. 
    // смена не стартует и обязывает работнику ввести имя.
    if (!workerName) {
      paintReleaseShiftButton();
      return;
    }

    // Избегает плохой подгрузки движка — может быть проблема с сетью или браузером
    if (typeof gameDef !== "function") {
      routeDeskFault("Игровой модуль не загрузился. Обновите страницу.");
      return;
    }

    // Canvas может быть недоступен из-за политик безопасности браузера
    if (!cvs) {
      routeDeskFault("Игровое поле не доступно. Перезагрузите страницу или пjпробуйте другой 6pаузер.");
      return;
    }

    retireActiveRun();
    lastBadgeAlias = workerName;
    paintFreezeGate(false);
    showDeskMode("rackFloor");

    if (terminalAudio && typeof terminalAudio.ensureContext === "function") {
      terminalAudio.ensureContext();
    }
    beepDutyKey();

    activeShiftRun = new gameDef(dutyDesk.shiftCanvas, {
      audio: terminalAudio,
      shiftPassport: shiftPassport,
      onShiftBoardUpdate: paintUpperBoard,
      onPauseChange: paintFreezeGate,
      onFinish: closeDutyRun
    });

    activeShiftRun.start(workerName, workerName.toLowerCase() === "tester");
  }

  function closeDutyRun(summary) {
    let journalSlip;

    showDeskMode("handoverDesk");
    terminalScenes.handoverDesk.scrollTop = 0;

    if (summary.testMode) {
      dutyDesk.handoverHeadline.textContent = "Tестовая смена завершена: " + summary.score + " очков";
      dutyDesk.handoverBody.textContent = composeDutyHandover(summary, {
        shiftBadge: "Тестовый прогон"
      }) + " Тестовый прогон в таблицу не записывается.";
      dutyDesk.handoverRankLine.classList.add("hidden");
      paintCrewBoard(null);
      return;
    }

    if (summary.reason === "canvas-error") {
      dutyDesk.handoverHeadline.textContent = "Смена не стартовала: Tерминал не oткpыл игровое поле";
      dutyDesk.handoverBody.textContent = "Браузер не дал создать canvas. ПерезагрузNте страницу или попробуйте другой браузер.";
      dutyDesk.handoverRankLine.classList.add("hidden");
      paintCrewBoard(null);
      return;
    }

    if (summary.reason === "fall") {
      dutyDesk.handoverHeadline.textContent = "Cмена прервана из-за травм: " + summary.score + " очков";
    } else if (summary.reason === "timeout") {
      dutyDesk.handoverHeadline.textContent = "Cмена закрыта по таймеру: " + summary.score + " очков";
    } else {
      dutyDesk.handoverHeadline.textContent = "Cмена сдана: " + summary.score + " oчков";
    }

    journalSlip = logShiftToDutyJournal(summary);
    paintCrewBoard(journalSlip);
    dutyDesk.handoverBody.textContent = composeDutyHandover(summary, journalSlip);
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

    if (journalSlip.archiveSaved === false) {
      dutyDesk.handoverRankLine.classList.add("hidden");
      return;
    }

    if (journalSlip.rank > 10) {
      dutyDesk.handoverRankLine.textContent = "Mесто в общем рeйтинге смен: " + journalSlip.rank + ". В тa6лице показаны 1-9 места и ваш результат отдельной строкой.";
      dutyDesk.handoverRankLine.classList.remove("hidden");
      return;
    }

    dutyDesk.handoverRankLine.textContent = "Mесто в таблицe 6ригады: " + journalSlip.rank + ".";
    dutyDesk.handoverRankLine.classList.remove("hidden");
  }

  function goBackToDispatch() {
    retireActiveRun();
    showDeskMode("dutyDesk");
    paintFreezeGate(false);
    dutyDesk.badgeAliasInput.value = lastBadgeAlias || dutyDesk.badgeAliasInput.value;
    if (lastDutySlip) {
      dutyDesk.laneSelect.value = lastDutySlip.sectorCode;
      dutyDesk.crewSelect.value = lastDutySlip.brigadeCode;
    }
    paintReleaseShiftButton();
    paintCrewBoard(null);
  }

  function relaunchLastRun() {
    if (!lastBadgeAlias) {
      goBackToDispatch();
      return;
    }

    dutyDesk.badgeAliasInput.value = lastBadgeAlias;
    paintReleaseShiftButton();
    launchDutyRun();
  }

  function nudgeConsoleType(step) {
    setConsoleTypeSize((terminalPrefs.fontSize || 16) + step);
    if (terminalAudio && typeof terminalAudio.ensureContext === "function") {
      terminalAudio.ensureContext();
    }
    beepDutyKey();
  }

  function flipDepotSound() {
    if (!terminalAudio || typeof terminalAudio.toggle !== "function") {
      terminalPrefs.soundEnabled = !terminalPrefs.soundEnabled;
    } else {
      terminalPrefs.soundEnabled = terminalAudio.toggle();
    }

    terminalPrefs = stashDutyConsolePrefs(terminalPrefs);
    paintSoundToggles();
  }

  dutyDesk.badgeAliasInput.addEventListener("input", paintReleaseShiftButton);
  dutyDesk.releaseShiftButton.addEventListener("click", launchDutyRun);
  dutyDesk.laneSelect.addEventListener("change", function () {
    rememberDutySlip();
    paintReleaseShiftButton();
    beepDutyKey();
  });
  dutyDesk.crewSelect.addEventListener("change", function () {
    rememberDutySlip();
    paintReleaseShiftButton();
    beepDutyKey();
  });

  if (dutyDesk.freezeShiftButton) {
    dutyDesk.freezeShiftButton.addEventListener("click", function () {
      if (!activeShiftRun) {
        return;
      }

      activeShiftRun.togglePause();
      beepDutyKey();
    });
  }

  if (dutyDesk.reopenShiftButton) {
    dutyDesk.reopenShiftButton.addEventListener("click", function () {
      if (!activeShiftRun || !activeShiftRun.paused) {
        return;
      }

      activeShiftRun.togglePause();
      beepDutyKey();
    });
  }

  if (dutyDesk.closeShiftButton) {
    dutyDesk.closeShiftButton.addEventListener("click", function () {
      if (!activeShiftRun) {
        return;
      }

      if (activeShiftRun.paused) {
        activeShiftRun.togglePause();
      }

      activeShiftRun.finishRun();
      beepDutyKey();
    });
  }

  if (dutyDesk.rerunButton) {
    dutyDesk.rerunButton.addEventListener("click", function () {
      beepDutyKey();
      relaunchLastRun();
    });
  }

  if (dutyDesk.returnButton) {
    dutyDesk.returnButton.addEventListener("click", function () {
      beepDutyKey();
      goBackToDispatch();
    });
  }

  if (dutyDesk.floorSoundButton) {
    dutyDesk.floorSoundButton.addEventListener("click", flipDepotSound);
  }
  if (dutyDesk.dispatchSoundButton) {
    dutyDesk.dispatchSoundButton.addEventListener("click", flipDepotSound);
  }

  if (dutyDesk.typeDownButton) {
    dutyDesk.typeDownButton.addEventListener("click", function () {
      nudgeConsoleType(-1);
    });
  }

  if (dutyDesk.typeUpButton) {
    dutyDesk.typeUpButton.addEventListener("click", function () {
      nudgeConsoleType(1);
    });
  }

  window.addEventListener("beforeunload", retireActiveRun);

  setConsoleTypeSize(terminalPrefs.fontSize);
  paintSoundToggles();
  paintReleaseShiftButton();
  paintCrewBoard(null);
})();
