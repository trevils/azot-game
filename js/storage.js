(function () {
  const BRIGADE_BOARD_KEY = "azot-brigade-board-v2";
  const TERMINAL_PREFS_KEY = "azot-terminal-prefs-v2";
  const DEFAULT_PICKER_ALIAS = "Стажер";
  const BOARD_LIMIT = 60;

  const SHIFT_SCORE_RULES = {
    ordinaryPicked: 10,
    urgentPicked: 20,
    fragilePicked: 30,
    falls: -10,
    cartHits: -15,
    cartOrdinaryLosses: -5,
    cartUrgentLosses: -8,
    cartFragileLosses: -15
  };

  // Эти справочники нужны и для настроек, и для журнала смен.
  const DISPATCH_PASSPORT = {
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

  function readJson(key, fallbackValue) {
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) {
        return fallbackValue;
      }

      return JSON.parse(raw);
    } catch (error) {
      return fallbackValue;
    }
  }

  function writeJson(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (error) {
      return false;
    }
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function normalizeCounter(value) {
    const number = Number(value);

    if (!Number.isFinite(number) || number < 0) {
      return 0;
    }

    return Math.floor(number);
  }

  function normalizeScore(value) {
    const number = Number(value);

    if (!Number.isFinite(number)) {
      return 0;
    }

    return Math.max(0, Math.round(number));
  }

  function normalizePickerName(name) {
    if (typeof name !== "string") {
      return DEFAULT_PICKER_ALIAS;
    }

    const trimmed = name.trim().slice(0, 16);
    return trimmed || DEFAULT_PICKER_ALIAS;
  }

  function normalizeReason(reason) {
    if (reason === "fall" || reason === "timeout" || reason === "canvas-error") {
      return reason;
    }

    return "complete";
  }

  function normalizeShiftPassport(passport) {
    const source = passport && typeof passport === "object" ? passport : {};
    const sectorCode = DISPATCH_PASSPORT.sectors[source.sectorCode] ? source.sectorCode : "bulk-lane";
    const brigadeCode = DISPATCH_PASSPORT.brigades[source.brigadeCode] ? source.brigadeCode : "north-3";

    return {
      sectorCode: sectorCode,
      sectorLabel: DISPATCH_PASSPORT.sectors[sectorCode].label,
      sectorShortLabel: DISPATCH_PASSPORT.sectors[sectorCode].shortLabel,
      brigadeCode: brigadeCode,
      brigadeLabel: DISPATCH_PASSPORT.brigades[brigadeCode].label
    };
  }

  function createEmptyShiftStats() {
    return {
      ordinarySpawned: 0,
      urgentSpawned: 0,
      fragileSpawned: 0,
      ordinaryPicked: 0,
      urgentPicked: 0,
      fragilePicked: 0,
      falls: 0,
      cartHits: 0,
      cartCargoLosses: 0,
      cartOrdinaryLosses: 0,
      cartUrgentLosses: 0,
      cartFragileLosses: 0,
      urgentExpired: 0,
      fragileBroken: 0,
      boostsUsed: 0
    };
  }

  function normalizeShiftStats(stats) {
    const source = stats && typeof stats === "object" ? stats : {};

    return {
      ordinarySpawned: normalizeCounter(source.ordinarySpawned),
      urgentSpawned: normalizeCounter(source.urgentSpawned),
      fragileSpawned: normalizeCounter(source.fragileSpawned),
      ordinaryPicked: normalizeCounter(source.ordinaryPicked),
      urgentPicked: normalizeCounter(source.urgentPicked),
      fragilePicked: normalizeCounter(source.fragilePicked),
      falls: normalizeCounter(source.falls),
      cartHits: normalizeCounter(source.cartHits),
      cartCargoLosses: normalizeCounter(source.cartCargoLosses),
      cartOrdinaryLosses: normalizeCounter(source.cartOrdinaryLosses),
      cartUrgentLosses: normalizeCounter(source.cartUrgentLosses),
      cartFragileLosses: normalizeCounter(source.cartFragileLosses),
      urgentExpired: normalizeCounter(source.urgentExpired),
      fragileBroken: normalizeCounter(source.fragileBroken),
      boostsUsed: normalizeCounter(source.boostsUsed)
    };
  }

  function hasDetailedShiftStats(stats) {
    return Object.keys(stats).some(function (key) {
      return stats[key] > 0;
    });
  }

  function recountShiftScore(stats) {
    let total = 0;

    total += stats.ordinaryPicked * SHIFT_SCORE_RULES.ordinaryPicked;
    total += stats.urgentPicked * SHIFT_SCORE_RULES.urgentPicked;
    total += stats.fragilePicked * SHIFT_SCORE_RULES.fragilePicked;
    total += stats.falls * SHIFT_SCORE_RULES.falls;
    total += stats.cartHits * SHIFT_SCORE_RULES.cartHits;
    total += stats.cartOrdinaryLosses * SHIFT_SCORE_RULES.cartOrdinaryLosses;
    total += stats.cartUrgentLosses * SHIFT_SCORE_RULES.cartUrgentLosses;
    total += stats.cartFragileLosses * SHIFT_SCORE_RULES.cartFragileLosses;

    return Math.max(0, total);
  }

  function createEntryId() {
    return "shift-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
  }

  function buildShiftBadge(entry) {
    const stats = entry.stats;
    const passport = entry.shiftPassport;

    if (entry.reason === "canvas-error") {
      return "Сбой терминала";
    }

    if (entry.reason === "fall" && stats.falls >= 3) {
      return "Нарушение ТБ";
    }

    if (passport.sectorCode === "rush-dock" && stats.urgentPicked >= 4 && stats.urgentExpired === 0) {
      return "Диспетчер экспресс-ворот";
    }

    if (passport.sectorCode === "fragile-bay" && stats.fragilePicked >= 3 && stats.fragileBroken === 0 && stats.cartFragileLosses === 0) {
      return "Смотритель хрупкого ряда";
    }

    if (passport.sectorCode === "bulk-lane" && stats.ordinaryPicked >= 8 && stats.cartCargoLosses <= 1) {
      return "Паллетный мотор";
    }

    if (stats.urgentPicked >= 4 && stats.urgentExpired === 0) {
      return "Охотник за срочкой";
    }

    if (stats.fragilePicked >= 3 && stats.fragileBroken === 0 && stats.cartFragileLosses === 0) {
      return "Аккуратный сборщик";
    }

    if (stats.falls === 0 && stats.cartHits === 0) {
      return "Смена без травм";
    }

    if (stats.boostsUsed >= 3) {
      return "Спринтер склада";
    }

    if (stats.cartCargoLosses >= 3) {
      return "Сложный маршрут";
    }

    return "Дежурный комплектовщик";
  }

  function countShiftIncidents(stats) {
    return stats.falls + stats.cartHits + stats.cartCargoLosses + stats.urgentExpired + stats.fragileBroken;
  }

  function compareBoardEntries(leftEntry, rightEntry) {
    if (leftEntry.score !== rightEntry.score) {
      return rightEntry.score - leftEntry.score;
    }

    const incidentGap = countShiftIncidents(leftEntry.stats) - countShiftIncidents(rightEntry.stats);
    if (incidentGap !== 0) {
      return incidentGap;
    }

    if (leftEntry.stats.urgentPicked !== rightEntry.stats.urgentPicked) {
      return rightEntry.stats.urgentPicked - leftEntry.stats.urgentPicked;
    }

    if (leftEntry.stats.fragilePicked !== rightEntry.stats.fragilePicked) {
      return rightEntry.stats.fragilePicked - leftEntry.stats.fragilePicked;
    }

    return leftEntry.createdAt - rightEntry.createdAt;
  }

  function finalizeBoardEntry(entry) {
    const normalizedStats = normalizeShiftStats(entry.stats);
    const expectedScore = hasDetailedShiftStats(normalizedStats)
      ? recountShiftScore(normalizedStats)
      : normalizeScore(entry.score);
    const scoreAudit = hasDetailedShiftStats(normalizedStats)
      ? (normalizeScore(entry.score) === expectedScore ? "ok" : "mismatch")
      : "legacy";

    return {
      entryId: entry.entryId || createEntryId(),
      name: normalizePickerName(entry.name),
      score: normalizeScore(entry.score),
      createdAt: normalizeCounter(entry.createdAt) || Date.now(),
      reason: normalizeReason(entry.reason),
      lives: normalizeCounter(entry.lives),
      testMode: !!entry.testMode,
      shiftPassport: normalizeShiftPassport(entry.shiftPassport),
      stats: normalizedStats,
      badge: "",
      scoreAudit: scoreAudit,
      expectedScore: expectedScore
    };
  }

  function normalizeBoardEntry(rawEntry) {
    if (!rawEntry || typeof rawEntry !== "object") {
      return null;
    }

    const entry = finalizeBoardEntry({
      entryId: typeof rawEntry.entryId === "string" ? rawEntry.entryId : "",
      name: rawEntry.name || rawEntry.pickerName,
      score: rawEntry.score,
      createdAt: rawEntry.createdAt,
      reason: rawEntry.reason,
      lives: rawEntry.lives,
      testMode: rawEntry.testMode,
      shiftPassport: rawEntry.shiftPassport,
      stats: rawEntry.stats
    });

    entry.badge = buildShiftBadge(entry);

    return entry;
  }

  function buildLegacyShiftEntry(name, score) {
    const stats = createEmptyShiftStats();
    const entry = finalizeBoardEntry({
      entryId: createEntryId(),
      name: name,
      score: score,
      createdAt: Date.now(),
      reason: "complete",
      lives: 0,
      testMode: false,
      shiftPassport: normalizeShiftPassport(null),
      stats: stats
    });

    entry.badge = buildShiftBadge(entry);
    return entry;
  }

  function buildShiftEntryFromSummary(summary) {
    const source = summary && typeof summary === "object" ? summary : {};
    const stats = normalizeShiftStats(source.stats);
    const entry = finalizeBoardEntry({
      entryId: createEntryId(),
      name: source.pickerName,
      score: source.score,
      createdAt: Date.now(),
      reason: source.reason,
      lives: source.lives,
      testMode: !!source.testMode,
      shiftPassport: source.shiftPassport,
      stats: stats
    });

    entry.badge = buildShiftBadge(entry);
    return entry;
  }

  function readBoardState() {
    const storedBoard = readJson(BRIGADE_BOARD_KEY, []);
    let repaired = !Array.isArray(storedBoard);
    let droppedRecords = 0;
    let board = [];

    if (!Array.isArray(storedBoard)) {
      return {
        entries: [],
        repaired: true,
        droppedRecords: 0
      };
    }

    // Старые и битые записи приводим к одному формату.
    for (let index = 0; index < storedBoard.length; index += 1) {
      const entry = normalizeBoardEntry(storedBoard[index]);

      if (!entry) {
        droppedRecords += 1;
        repaired = true;
        continue;
      }

      if (entry.badge !== storedBoard[index].badge || entry.scoreAudit !== storedBoard[index].scoreAudit) {
        repaired = true;
      }

      board.push(entry);
    }

    board.sort(compareBoardEntries);

    if (board.length > BOARD_LIMIT) {
      droppedRecords += board.length - BOARD_LIMIT;
      board = board.slice(0, BOARD_LIMIT);
      repaired = true;
    }

    return {
      entries: board,
      repaired: repaired,
      droppedRecords: droppedRecords
    };
  }

  function persistBoard(entries) {
    const fullBoard = entries.slice(0, BOARD_LIMIT);

    if (writeJson(BRIGADE_BOARD_KEY, fullBoard)) {
      return {
        saved: true,
        storageMode: "full",
        persistedEntries: fullBoard,
        droppedByStorage: 0
      };
    }

    const trimmedBoard = fullBoard.slice(0, 40);
    if (writeJson(BRIGADE_BOARD_KEY, trimmedBoard)) {
      return {
        saved: true,
        storageMode: "trimmed",
        persistedEntries: trimmedBoard,
        droppedByStorage: fullBoard.length - trimmedBoard.length
      };
    }

    const emergencyBoard = fullBoard.slice(0, 10);
    if (writeJson(BRIGADE_BOARD_KEY, emergencyBoard)) {
      return {
        saved: true,
        storageMode: "emergency-top10",
        persistedEntries: emergencyBoard,
        droppedByStorage: fullBoard.length - emergencyBoard.length
      };
    }

    return {
      saved: false,
      storageMode: "memory-only",
      persistedEntries: fullBoard,
      droppedByStorage: 0
    };
  }

  function loadBrigadeBoard() {
    const boardState = readBoardState();

    if (boardState.repaired) {
      persistBoard(boardState.entries);
    }

    return boardState.entries;
  }

  function saveShiftResult(summaryOrName, maybeScore) {
    const boardState = readBoardState();
    const shiftEntry = summaryOrName && typeof summaryOrName === "object"
      ? buildShiftEntryFromSummary(summaryOrName)
      : buildLegacyShiftEntry(summaryOrName, maybeScore);
    const rankedBoard = boardState.entries.concat(shiftEntry).sort(compareBoardEntries);
    const nextBoard = rankedBoard.slice(0, BOARD_LIMIT);
    const persistResult = persistBoard(nextBoard);
    const visibleBoard = persistResult.persistedEntries.slice(0, 10);
    const rank = rankedBoard.findIndex(function (entry) {
      return entry.entryId === shiftEntry.entryId;
    }) + 1;

    return {
      top10: visibleBoard,
      rank: rank > 0 ? rank : rankedBoard.length + 1,
      saved: persistResult.saved,
      storageMode: persistResult.storageMode,
      boardRepair: boardState.repaired,
      droppedRecords: boardState.droppedRecords + persistResult.droppedByStorage,
      pickerEntry: shiftEntry,
      badge: shiftEntry.badge,
      scoreAudit: shiftEntry.scoreAudit,
      expectedScore: shiftEntry.expectedScore
    };
  }

  function loadTerminalPrefs() {
    const storedPrefs = readJson(TERMINAL_PREFS_KEY, {});
    const safePrefs = {
      fontSize: clamp(normalizeCounter(storedPrefs.fontSize) || 16, 12, 22),
      soundEnabled: storedPrefs.soundEnabled !== false,
      sectorCode: DISPATCH_PASSPORT.sectors[storedPrefs.sectorCode] ? storedPrefs.sectorCode : "bulk-lane",
      brigadeCode: DISPATCH_PASSPORT.brigades[storedPrefs.brigadeCode] ? storedPrefs.brigadeCode : "north-3"
    };

    if (
      !storedPrefs ||
      storedPrefs.fontSize !== safePrefs.fontSize ||
      storedPrefs.soundEnabled !== safePrefs.soundEnabled ||
      storedPrefs.sectorCode !== safePrefs.sectorCode ||
      storedPrefs.brigadeCode !== safePrefs.brigadeCode
    ) {
      writeJson(TERMINAL_PREFS_KEY, safePrefs);
    }

    return safePrefs;
  }

  function saveTerminalPrefs(nextPrefs) {
    const safePrefs = {
      fontSize: clamp(normalizeCounter(nextPrefs && nextPrefs.fontSize) || 16, 12, 22),
      soundEnabled: !(nextPrefs && nextPrefs.soundEnabled === false),
      sectorCode: nextPrefs && DISPATCH_PASSPORT.sectors[nextPrefs.sectorCode] ? nextPrefs.sectorCode : "bulk-lane",
      brigadeCode: nextPrefs && DISPATCH_PASSPORT.brigades[nextPrefs.brigadeCode] ? nextPrefs.brigadeCode : "north-3"
    };

    writeJson(TERMINAL_PREFS_KEY, safePrefs);
    return safePrefs;
  }

  window.AZOTStorage = {
    loadTerminalPrefs: loadTerminalPrefs,
    saveTerminalPrefs: saveTerminalPrefs,
    loadBrigadeBoard: loadBrigadeBoard,
    saveShiftResult: saveShiftResult
  };
})();
