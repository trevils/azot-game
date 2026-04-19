(function () {
  const CREW_LEDGER_KEY = "azot-crew-ledger-v5";
  const DISPATCH_PREFS_KEY = "azot-dispatch-prefs-v5";
  const BROKEN_LEDGER_SNAPSHOT_KEY = "azot-ledger-quarantine-v2";
  const LEGACY_CREW_LEDGER_KEYS = ["azot-crew-ledger-v4"];
  const LEGACY_DISPATCH_PREFS_KEYS = ["azot-dispatch-prefs-v4"];
  const ARCHIVE_LIMIT = 60;
  const RESERVE_PICKER_NAME = "Стажер";

  const WAREHOUSE_RATE_CARD = {
    ordinaryPicked: 10,
    urgentPicked: 20,
    fragilePicked: 30,
    falls: -10,
    cartHits: -15,
    cartOrdinaryLosses: -5,
    cartUrgentLosses: -8,
    cartFragileLosses: -15
  };

  const AZOT_SHIFT_BOOK = {
    sectors: {
      "bulk-lane": {
        label: "Паллетный ряд",
        shortLabel: "Паллеты",
        boardTag: "PLT-17",
        zoneTag: "PLT",
        supervisor: "Мастер Орлова",
        incidentLimit: 3,
        targetPoints: 160,
        reviewFloor: 90,
        shiftRule: "не просадить паллетный поток",
        shiftRoute: "окно перебора",
        overloadReason: "Паллетный ряд ушел в пересорт",
        scoreFloorReason: "Паллетный поток сдан ниже сменной нормы",
        expressSlipReason: "",
        breakageReason: "",
        faultStamp: "Паллетная линия не подняла смену",
        auditDesk: "пульт Орловой"
      },
      "rush-dock": {
        label: "Экспресс-ворота",
        shortLabel: "Экспресс",
        boardTag: "EXP-04",
        zoneTag: "EXP",
        supervisor: "Диспетчер Климов",
        incidentLimit: 1,
        targetPoints: 180,
        reviewFloor: 110,
        shiftRule: "не сорвать срочные окна",
        shiftRoute: "стол Климова",
        overloadReason: "Экспресс-ворота сорвали окно отгрузки",
        scoreFloorReason: "Экспресс-поток закрыт ниже сменной нормы",
        expressSlipReason: "На воротах сорвано срочное окно",
        breakageReason: "",
        faultStamp: "Экспресс-ворота потеряли пульт смены",
        auditDesk: "экспресс-пульт Климова"
      },
      "fragile-bay": {
        label: "Хрупкий ряд",
        shortLabel: "Хрупкий",
        boardTag: "FRG-09",
        zoneTag: "FRG",
        supervisor: "Контролер Ланина",
        incidentLimit: 0,
        targetPoints: 150,
        reviewFloor: 85,
        shiftRule: "сдать хрупкий товар без боя",
        shiftRoute: "контрольный стол Ланиной",
        overloadReason: "Хрупкий ряд дал брак и возвраты",
        scoreFloorReason: "Хрупкий ряд закрыт ниже планки безбрака",
        expressSlipReason: "",
        breakageReason: "На хрупком ряду зафиксирован бой",
        faultStamp: "Хрупкий ряд остался без игрового поля",
        auditDesk: "стол Ланиной"
      }
    },
    brigades: {
      "north-3": {
        label: "Север-3",
        brigadeTag: "N3",
        lead: "Романов",
        handoverDesk: "окно А2"
      },
      "azot-pack": {
        label: "Азот-комплект",
        brigadeTag: "AZP",
        lead: "Ведерникова",
        handoverDesk: "окно Б1"
      },
      "night-belt": {
        label: "Ночная лента",
        brigadeTag: "NBT",
        lead: "Чернов",
        handoverDesk: "ночной пост"
      }
    }
  };

  // normalizeShiftPassport: назначение параметров смены на основе дежурного листка при задаче в мейн меню.
  function normalizeShiftPassport(rawPassport) {
    let source = rawPassport;
    
    // если приходит не-объект или массив — сброс в пусто, чтобы не копить битые учатски.
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
      source = {};
    }

    const sectorCode = AZOT_SHIFT_BOOK.sectors[source.sectorCode] ? source.sectorCode : "bulk-lane";
    const brigadeCode = AZOT_SHIFT_BOOK.brigades[source.brigadeCode] ? source.brigadeCode : "north-3";
    const sectorConfig = AZOT_SHIFT_BOOK.sectors[sectorCode];
    const brigadeConfig = AZOT_SHIFT_BOOK.brigades[brigadeCode];
  // функция сломалась инцидент-лимит для хрупкого ряда 0 вместо 1, срочные падать стали чаще.
  // забыли обновить brigadeTag для ночной ленты.
    return {
      sectorCode: sectorCode,
      sectorLabel: sectorConfig.label,
      sectorShortLabel: sectorConfig.shortLabel,
      boardTag: source.boardTag || sectorConfig.boardTag,
      brigadeCode: brigadeCode,
      brigadeLabel: brigadeConfig.label,
      brigadeLead: brigadeConfig.lead,
      brigadeCallSign: source.brigadeCallSign || brigadeConfig.brigadeTag,
      supervisor: sectorConfig.supervisor,
      archiveTag: brigadeConfig.brigadeTag + "-" + sectorConfig.zoneTag,
      incidentLimit: sectorConfig.incidentLimit,
      targetPoints: sectorConfig.targetPoints,
      reviewFloor: sectorConfig.reviewFloor,
      shiftRule: sectorConfig.shiftRule,
      handoverDesk: brigadeConfig.handoverDesk,
      shiftRoute: source.shiftRoute || sectorConfig.shiftRoute,
      launchBrief: source.launchBrief || sectorConfig.shiftRule,
      faultStamp: source.faultStamp || sectorConfig.faultStamp,
      overloadReason: sectorConfig.overloadReason,
      scoreFloorReason: sectorConfig.scoreFloorReason,
      expressSlipReason: sectorConfig.expressSlipReason,
      breakageReason: sectorConfig.breakageReason,
      auditDesk: sectorConfig.auditDesk
    };
  }

  // cutBrigadeLedgerRow: валидация и дебранчирование смены для архива.
  // самая сложная функция: она проверяет практически всё что может пойти не так.
  // Баги: неправильные счета, мусорные данные, потеря инцидентов при краше, ручное редактирование localStorage.
  // (если вручную отредактировать счёт, чтобы попасть в топ.)
  function validateAndScoreShift(rawRow) {
    if (!rawRow || typeof rawRow !== "object") {
      return null;
    }

    const passport = normalizeShiftPassport(rawRow.shiftPassport);
    const shiftSource = rawRow.stats && typeof rawRow.stats === "object" ? rawRow.stats : {};
    const shiftFacts = {
      ordinarySpawned: 0, ordinaryPicked: 0,
      urgentSpawned: 0, urgentPicked: 0,
      fragileSpawned: 0, fragilePicked: 0,
      falls: 0, cartHits: 0,
      cartCargoLosses: 0, cartOrdinaryLosses: 0, cartUrgentLosses: 0, cartFragileLosses: 0,
      urgentExpired: 0, fragileBroken: 0,
      boostsUsed: 0
    };
    const shiftFactNames = Object.keys(shiftFacts);
    let hasServiceStats = false;
    let expectedPoints = 0;
    let incidentLoad = 0;
    const serviceMarks = [];
    // Имя может придти как "name" или "pickerName" — старая версия другого использовала первое.
    // Режем на 16 — лимит для совместимости со старой LEDGER версией.
    const trimmedName = typeof rawRow.name === "string"
      ? rawRow.name.trim().slice(0, 16)
      : typeof rawRow.pickerName === "string"
        ? rawRow.pickerName.trim().slice(0, 16)
        : "";
    const numericScore = Number(rawRow.score);
    const actualScore = Number.isFinite(numericScore) ? Math.max(0, Math.round(numericScore)) : 0;
    const numericCreatedAt = Number(rawRow.createdAt);
    // Код окончания: "complete" (нормальное окончание), "fall" (упал 3 раза), 
    // "timeout" (смена кончилась по времени)
    // "canvas-error" (браузер заблокировал canvas). Нужно для анализа режима отказа на работникa.
    const reason = rawRow.reason === "fall" || rawRow.reason === "timeout" || rawRow.reason === "canvas-error"
      ? rawRow.reason
      : "complete";

    // Пересчитываем счётчики: каждый валидируется отдельно потому что может быть типовая ошибка при сохранении.
    // Если значение не-число или отрицательное — используем 0, безопаснее чем крашить сайт во время игры.
    for (let index = 0; index < shiftFactNames.length; index += 1) {
      const factName = shiftFactNames[index];
      const rawValue = Number(shiftSource[factName]);
      const preparedValue = Number.isFinite(rawValue) && rawValue > 0 ? Math.floor(rawValue) : 0;
      shiftFacts[factName] = preparedValue;

      if (preparedValue > 0) {
        hasServiceStats = true;
      }
    }

    expectedPoints += shiftFacts.ordinaryPicked * WAREHOUSE_RATE_CARD.ordinaryPicked;
    expectedPoints += shiftFacts.urgentPicked * WAREHOUSE_RATE_CARD.urgentPicked;
    expectedPoints += shiftFacts.fragilePicked * WAREHOUSE_RATE_CARD.fragilePicked;
    expectedPoints += shiftFacts.falls * WAREHOUSE_RATE_CARD.falls;
    expectedPoints += shiftFacts.cartHits * WAREHOUSE_RATE_CARD.cartHits;
    expectedPoints += shiftFacts.cartOrdinaryLosses * WAREHOUSE_RATE_CARD.cartOrdinaryLosses;
    expectedPoints += shiftFacts.cartUrgentLosses * WAREHOUSE_RATE_CARD.cartUrgentLosses;
    expectedPoints += shiftFacts.cartFragileLosses * WAREHOUSE_RATE_CARD.cartFragileLosses;

    incidentLoad =
      shiftFacts.falls +
      shiftFacts.cartHits +
      shiftFacts.cartCargoLosses +
      shiftFacts.urgentExpired +
      shiftFacts.fragileBroken;

    if (passport.sectorCode === "bulk-lane") {
      if (shiftFacts.ordinaryPicked >= 10 && shiftFacts.cartOrdinaryLosses === 0) {
        expectedPoints += 12;
        serviceMarks.push("паллетный план удержан");
      }
      if (shiftFacts.cartCargoLosses >= 3) {
        expectedPoints -= 10;
        serviceMarks.push("паллетный ряд дал пересорт");
      }
    }

    if (passport.sectorCode === "rush-dock") {
      if (shiftFacts.urgentPicked >= 4 && shiftFacts.urgentExpired === 0) {
        expectedPoints += 15;
        serviceMarks.push("экспресс-окно закрыто без срыва");
      }
      if (shiftFacts.urgentExpired > 0) {
        expectedPoints -= shiftFacts.urgentExpired * 12;
        serviceMarks.push("на воротах была просрочка");
      }
    }

    if (passport.sectorCode === "fragile-bay") {
      if (shiftFacts.fragilePicked >= 3 && shiftFacts.fragileBroken === 0 && shiftFacts.cartFragileLosses === 0) {
        expectedPoints += 20;
        serviceMarks.push("хрупкий ряд сдан без боя");
      }
      if (shiftFacts.fragileBroken + shiftFacts.cartFragileLosses > 0) {
        expectedPoints -= 20;
        serviceMarks.push("по хрупкому прошел брак");
      }
    }

    if (passport.brigadeCode === "north-3" && shiftFacts.falls === 0 && shiftFacts.cartHits === 0) {
      expectedPoints += 6;
      serviceMarks.push("Север-3 отработал без травм");
    }

    if (passport.brigadeCode === "azot-pack" && shiftFacts.ordinaryPicked + shiftFacts.fragilePicked >= 8 && shiftFacts.cartCargoLosses === 0) {
      expectedPoints += 10;
      serviceMarks.push("Азот-комплект закрыл плотную отгрузку");
    }

    if (passport.brigadeCode === "night-belt" && shiftFacts.boostsUsed >= 2 && shiftFacts.falls === 0) {
      expectedPoints += 8;
      serviceMarks.push("ночная лента держала темп");
    }

    if (incidentLoad > passport.incidentLimit) {
      expectedPoints -= (incidentLoad - passport.incidentLimit) * 5;
    }

    if (reason === "canvas-error") {
      expectedPoints = 0;
    }

    expectedPoints = Math.max(0, Math.round(expectedPoints));

    const ledgerRow = {
      entryId: typeof rawRow.entryId === "string" && rawRow.entryId.trim()
        ? rawRow.entryId
        : "shift-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8),
      name: trimmedName || RESERVE_PICKER_NAME,
      score: actualScore,
      createdAt: Number.isFinite(numericCreatedAt) && numericCreatedAt > 0 ? Math.floor(numericCreatedAt) : Date.now(),
      reason: reason,
      lives: Number.isFinite(Number(rawRow.lives)) && Number(rawRow.lives) > 0 ? Math.floor(Number(rawRow.lives)) : 0,
      testMode: !!rawRow.testMode,
      shiftPassport: passport,
      stats: shiftFacts,
      incidentLoad: incidentLoad,
      shiftBadge: "Дежурный комплектовщик",
      serviceNote: serviceMarks.join("; "),
      scoreCheck: hasServiceStats
        ? (actualScore === expectedPoints ? "ok" : Math.abs(actualScore - expectedPoints) <= 5 ? "minor-drift" : "needs-hand-check")
        : "legacy-row",
      expectedPoints: hasServiceStats ? expectedPoints : actualScore,
      reviewFlag: false,
      reviewReason: "",
      shiftBoss: passport.supervisor,
      auditDesk: passport.auditDesk,
      archiveTag: passport.archiveTag,
      planClosed: actualScore >= passport.targetPoints
    };

    if (ledgerRow.reason === "canvas-error") {
      ledgerRow.shiftBadge = "Сбой терминала";
      ledgerRow.reviewFlag = true;
      ledgerRow.reviewReason = "Терминал не открыл игровое поле";
      return ledgerRow;
    }

    // Орлова (паллеты) просила отмечать смены без потерь. Климов (экспресс) попросил за закрытые в срок окна.
    // Ланина (хрупкий) требовала отмечать при нулевом бое. Чернов (ночная лента) давил на добавление мотивирующего бейджа.
    if (passport.brigadeCode === "north-3" && shiftFacts.falls === 0 && shiftFacts.cartHits === 0) {
      ledgerRow.shiftBadge = "Север-3 без потерь";
    } else if (passport.sectorCode === "rush-dock" && shiftFacts.urgentPicked >= 4 && shiftFacts.urgentExpired === 0) {
      ledgerRow.shiftBadge = "Экспресс закрыт в срок";
    } else if (passport.sectorCode === "fragile-bay" && shiftFacts.fragilePicked >= 3 && shiftFacts.fragileBroken === 0 && shiftFacts.cartFragileLosses === 0) {
      ledgerRow.shiftBadge = "Ряд хрупкого под контролем";
    } else if (passport.sectorCode === "bulk-lane" && shiftFacts.ordinaryPicked >= 8 && shiftFacts.cartCargoLosses <= 1) {
      ledgerRow.shiftBadge = "Паллетный мотор";
    } else if (passport.brigadeCode === "night-belt" && shiftFacts.boostsUsed >= 2) {
      ledgerRow.shiftBadge = "Ночная лента держит темп";
    } else if (passport.brigadeCode === "azot-pack" && shiftFacts.fragilePicked >= 2 && shiftFacts.cartFragileLosses === 0) {
      ledgerRow.shiftBadge = "Азот-комплект без боя";
    } else if (shiftFacts.falls >= 3) {
      ledgerRow.shiftBadge = "Нарушение ТБ";
    } else if (shiftFacts.cartCargoLosses >= 3) {
      ledgerRow.shiftBadge = "Сложный маршрут";
    }

    if (ledgerRow.scoreCheck === "needs-hand-check") {
      ledgerRow.reviewFlag = true;
      ledgerRow.reviewReason = "Очки не сошлись со служебной статистикой";
      return ledgerRow;
    }

    if (passport.sectorCode === "rush-dock" && shiftFacts.urgentExpired > 0) {
      ledgerRow.reviewFlag = true;
      ledgerRow.reviewReason = passport.expressSlipReason || "Срыв экспресс-окна на воротах";
      return ledgerRow;
    }

    if (passport.sectorCode === "fragile-bay" && shiftFacts.fragileBroken + shiftFacts.cartFragileLosses > 0) {
      ledgerRow.reviewFlag = true;
      ledgerRow.reviewReason = passport.breakageReason || "Бой хрупкого товара на участке";
      return ledgerRow;
    }

    if (shiftFacts.falls >= 3) {
      ledgerRow.reviewFlag = true;
      ledgerRow.reviewReason = "Повторные нарушения ТБ за смену";
      return ledgerRow;
    }

    if (incidentLoad > passport.incidentLimit) {
      ledgerRow.reviewFlag = true;
      ledgerRow.reviewReason = passport.overloadReason || "Потери участка выше нормы";
      return ledgerRow;
    }

    if (!ledgerRow.planClosed && ledgerRow.reason === "complete" && ledgerRow.score < passport.reviewFloor) {
      ledgerRow.reviewFlag = true;
      ledgerRow.reviewReason = passport.scoreFloorReason || "Участок сдан ниже сменной нормы";
    }

    return ledgerRow;
  }

  function sortBrigadeLedger(leftRow, rightRow) {
    if (leftRow.score !== rightRow.score) {
      return rightRow.score - leftRow.score;
    }

    if (leftRow.reviewFlag !== rightRow.reviewFlag) {
      return leftRow.reviewFlag ? 1 : -1;
    }

    if (leftRow.incidentLoad !== rightRow.incidentLoad) {
      return leftRow.incidentLoad - rightRow.incidentLoad;
    }

    if (leftRow.stats.urgentPicked !== rightRow.stats.urgentPicked) {
      return rightRow.stats.urgentPicked - leftRow.stats.urgentPicked;
    }

    return leftRow.createdAt - rightRow.createdAt;
  }

  function sealShiftHandover(summaryOrName, maybeScore) {
    if (summaryOrName && typeof summaryOrName === "object") {
      return cutBrigadeLedgerRow({
        entryId: "",
        name: summaryOrName.pickerName,
        score: summaryOrName.score,
        createdAt: Date.now(),
        reason: summaryOrName.reason,
        lives: summaryOrName.lives,
        testMode: !!summaryOrName.testMode,
        shiftPassport: summaryOrName.shiftPassport,
        stats: summaryOrName.stats
      });
    }

    return cutBrigadeLedgerRow({
      entryId: "",
      name: summaryOrName,
      score: maybeScore,
      createdAt: Date.now(),
      reason: "complete",
      lives: 0,
      testMode: false,
      shiftPassport: null,
      stats: {}
    });
  }
  // На стенде часто жмут "закрыть смену" два раза, браузер воспринимает как enter-enter.
  // Поэтому в архиве иногда дублируются записи — ниже фильтруем по отпечаткам.
  // openBrigadeJournal: загрузка архива смен из localStorage.
  // - Если новая версия потеряна — пытаемся восстановить из legacy v4.
  // - Если JSON испорчена (пользователь редактировал) — кладём в quarantine и инициализируем пусто.
  // - Отмечаем дубли по (pickerName + score + createdAt) — иногда браузер сохраняет дважды при краше.
  // - Если архив выбитый (> 60 смен) — удаляем самые старые записи.
  function openBrigadeJournal() {
    let rawArchive = "";
    let storedRows = [];
    let rows = [];
    let wasRepaired = false;
    let removedRows = 0;
    let archiveIssue = "";
    let sourceKey = CREW_LEDGER_KEY;
    const knownIds = {};
    const knownShiftFingerprints = {};

    // Попытка загрузить из нового хранилища (v5). Если браузер заблокировал localStorage — сдаёмся.
    try {
      rawArchive = window.localStorage.getItem(CREW_LEDGER_KEY) || "";
    } catch (error) {
      // Браузер может заблокировать localStorage в приватном режиме или при превышении quota.
      // В этом случае игра работает, но смены не сохраняются — читай logs если что-то странное.
      return {
        rows: [],
        wasRepaired: false,
        removedRows: 0,
        archiveIssue: "browser-blocked-ledger"
      };
    }

    // Если текущее хранилище пусто — ищем старую версию (v4). Миграция при обновлениях.
    if (!rawArchive) {
      for (let index = 0; index < LEGACY_CREW_LEDGER_KEYS.length; index += 1) {
        try {
          rawArchive = window.localStorage.getItem(LEGACY_CREW_LEDGER_KEYS[index]) || "";
        } catch (error) {
          rawArchive = "";
        }

        if (rawArchive) {
          sourceKey = LEGACY_CREW_LEDGER_KEYS[index];
          archiveIssue = "legacy-ledger-migrated";
          wasRepaired = true;
          break;
        }
      }
    }

    // Совсем пусто — новый пользователь. Возвращаем пустой архив без ошибки.
    if (!rawArchive) {
      return {
        rows: [],
        wasRepaired: false,
        removedRows: 0,
        archiveIssue: "",
        sourceKey: sourceKey
      };
    }

    // Парсим JSON. Если сломана (пользователь редактировал руками) — кладём в quarantine файл и продолжаем пусто.
    // КРИТИЧНО: нель потерять работника по ошибке парса, лучше потерять одну смену чем весь архив.
    try {
      storedRows = JSON.parse(rawArchive);
    } catch (error) {
      archiveIssue = "ledger-quarantined";
      wasRepaired = true;

      try {
        window.localStorage.setItem(BROKEN_LEDGER_SNAPSHOT_KEY, rawArchive.slice(0, 12000));
      } catch (quarantineError) {}

      try {
        window.localStorage.removeItem(CREW_LEDGER_KEY);
      } catch (cleanupError) {}

      return {
        rows: [],
        wasRepaired: true,
        removedRows: 0,
        archiveIssue: archiveIssue,
        sourceKey: sourceKey
      };
    }

    if (!Array.isArray(storedRows)) {
      archiveIssue = "ledger-reset-from-object";
      wasRepaired = true;

      try {
        window.localStorage.removeItem(CREW_LEDGER_KEY);
      } catch (cleanupError) {}

      return {
        rows: [],
        wasRepaired: true,
        removedRows: 0,
        archiveIssue: archiveIssue,
        sourceKey: sourceKey
      };
    }

    for (let index = 0; index < storedRows.length; index += 1) {
      const ledgerRow = cutBrigadeLedgerRow(storedRows[index]);

      if (!ledgerRow) {
        removedRows += 1;
        wasRepaired = true;
        continue;
      }

      if (knownIds[ledgerRow.entryId]) {
        ledgerRow.entryId = ledgerRow.entryId + "-" + (index + 1);
        wasRepaired = true;
      }

      const fingerprint =
        ledgerRow.name + "|" +
        ledgerRow.archiveTag + "|" +
        ledgerRow.score + "|" +
        Math.floor(ledgerRow.createdAt / 60000);

      if (knownShiftFingerprints[fingerprint]) {
        removedRows += 1;
        wasRepaired = true;
        archiveIssue = archiveIssue || "double-handover-pruned";
        continue;
      }

      knownIds[ledgerRow.entryId] = true;
      knownShiftFingerprints[fingerprint] = true;

      if (
        storedRows[index].shiftBadge !== ledgerRow.shiftBadge ||
        storedRows[index].reviewReason !== ledgerRow.reviewReason ||
        storedRows[index].scoreCheck !== ledgerRow.scoreCheck ||
        storedRows[index].serviceNote !== ledgerRow.serviceNote
      ) {
        wasRepaired = true;
      }

      rows.push(ledgerRow);
    }

    rows.sort(sortBrigadeLedger);

    if (rows.length > ARCHIVE_LIMIT) {
      removedRows += rows.length - ARCHIVE_LIMIT;
      rows = rows.slice(0, ARCHIVE_LIMIT);
      wasRepaired = true;
    }

    return {
      rows: rows,
      wasRepaired: wasRepaired,
      removedRows: removedRows,
      archiveIssue: archiveIssue,
      sourceKey: sourceKey
    };
  }
//расширено хранилище, миграция prefs.journal, нормализация и восстановление данных
  function stashBrigadeJournal(rows) {
    const fullRows = rows.slice(0, ARCHIVE_LIMIT);

    try {
      window.localStorage.setItem(CREW_LEDGER_KEY, JSON.stringify(fullRows));
      return {
        archiveSaved: true,
        archiveMode: "full-archive",
        persistedRows: fullRows,
        rowsSkipped: 0,
        archiveIssue: ""
      };
    } catch (error) {}

    // Если квота будет предельной, урезаем архив, не теряем служебные причины и разметки.
    const compactRows = fullRows.slice(0, 40).map(function (row) {
      return {
        entryId: row.entryId,
        name: row.name,
        score: row.score,
        createdAt: row.createdAt,
        reason: row.reason,
        shiftPassport: {
          sectorCode: row.shiftPassport.sectorCode,
          brigadeCode: row.shiftPassport.brigadeCode
        },
        stats: row.stats,
        shiftBadge: row.shiftBadge,
        serviceNote: row.serviceNote,
        reviewReason: row.reviewReason,
        scoreCheck: row.scoreCheck,
        shiftBoss: row.shiftBoss
      };
    });

    try {
      window.localStorage.setItem(CREW_LEDGER_KEY, JSON.stringify(compactRows));
      return {
        archiveSaved: true,
        archiveMode: "trimmed-archive",
        persistedRows: fullRows.slice(0, 40),
        rowsSkipped: fullRows.length - 40,
        archiveIssue: "archive-trimmed-for-browser"
      };
    } catch (error) {}

    const watchlistRows = fullRows.slice(0, 10).map(function (row) {
      return {
        entryId: row.entryId,
        name: row.name,
        score: row.score,
        createdAt: row.createdAt,
        shiftBadge: row.shiftBadge,
        reviewReason: row.reviewReason,
        shiftPassport: {
          sectorCode: row.shiftPassport.sectorCode,
          brigadeCode: row.shiftPassport.brigadeCode
        }
      };
    });

    try {
      window.localStorage.setItem(CREW_LEDGER_KEY, JSON.stringify(watchlistRows));
      return {
        archiveSaved: true,
        archiveMode: "watchlist-top10",
        persistedRows: fullRows.slice(0, 10),
        rowsSkipped: fullRows.length - 10,
        archiveIssue: "only-top10-fits"
      };
    } catch (error) {}

    return {
      archiveSaved: false,
      archiveMode: "screen-only",
      persistedRows: fullRows,
      rowsSkipped: 0,
      archiveIssue: "browser-blocked-ledger"
    };
  }

  function readCrewWatchboard() {
    const archiveSnapshot = openBrigadeJournal();

    if (archiveSnapshot.wasRepaired) {
      stashBrigadeJournal(archiveSnapshot.rows);

      if (archiveSnapshot.sourceKey !== CREW_LEDGER_KEY) {
        try {
          window.localStorage.removeItem(archiveSnapshot.sourceKey);
        } catch (cleanupError) {}
      }
    }

    return archiveSnapshot.rows;
  }

  function logShiftToDutyJournal(summaryOrName, maybeScore) {
    const archiveSnapshot = openBrigadeJournal();
    const currentRow = sealShiftHandover(summaryOrName, maybeScore);
    const sameLaneHistory = archiveSnapshot.rows.filter(function (row) {
      return row.archiveTag === currentRow.archiveTag;
    }).slice(0, 4);
    const repeatedHandChecks = sameLaneHistory.filter(function (row) {
      return row.reviewFlag;
    }).length;
    const repeatedPlanMisses = sameLaneHistory.filter(function (row) {
      return !row.planClosed;
    }).length;
    const rankedRows = archiveSnapshot.rows.concat(currentRow).sort(sortBrigadeLedger);
    let rowsToStore = rankedRows.slice(0, ARCHIVE_LIMIT);
    let auditRowPinned = false;

    if (currentRow.reviewFlag && repeatedHandChecks >= 2) {
      currentRow.serviceNote = currentRow.serviceNote
        ? currentRow.serviceNote + "; линия третий раз подряд уходит на ручную сверку"
        : "линия третий раз подряд уходит на ручную сверку";
    } else if (!currentRow.reviewFlag && repeatedHandChecks >= 2) {
      currentRow.serviceNote = currentRow.serviceNote
        ? currentRow.serviceNote + "; линия снята с повторной сверки"
        : "линия снята с повторной сверки";
    }

    if (currentRow.planClosed && repeatedPlanMisses >= 2) {
      currentRow.serviceNote = currentRow.serviceNote
        ? currentRow.serviceNote + "; участок закрыл план после серии провальных сдач"
        : "участок закрыл план после серии провальных сдач";
    }

    if (currentRow.reviewFlag) {
      const currentRowInsideArchive = rowsToStore.some(function (row) {
        return row.entryId === currentRow.entryId;
      });

      if (!currentRowInsideArchive && rowsToStore.length) {
        rowsToStore[rowsToStore.length - 1] = currentRow;
        rowsToStore.sort(sortBrigadeLedger);
        auditRowPinned = true;
      }
    }

    const archiveReceipt = stashBrigadeJournal(rowsToStore);
    const visibleRows = archiveReceipt.persistedRows.slice(0, 10);
    const rank = rankedRows.findIndex(function (row) {
      return row.entryId === currentRow.entryId;
    }) + 1;

    if (archiveSnapshot.sourceKey !== CREW_LEDGER_KEY) {
      try {
        window.localStorage.removeItem(archiveSnapshot.sourceKey);
      } catch (cleanupError) {}
    }

    return {
      top10: visibleRows,
      rank: rank > 0 ? rank : rankedRows.length + 1,
      archiveSaved: archiveReceipt.archiveSaved,
      archiveMode: archiveReceipt.archiveMode,
      archiveWasRepaired: archiveSnapshot.wasRepaired,
      removedRows: archiveSnapshot.removedRows + archiveReceipt.rowsSkipped,
      pickerRow: currentRow,
      shiftBadge: currentRow.shiftBadge,
      serviceNote: currentRow.serviceNote,
      scoreCheck: currentRow.scoreCheck,
      expectedPoints: currentRow.expectedPoints,
      reviewFlag: currentRow.reviewFlag,
      reviewReason: currentRow.reviewReason,
      shiftBoss: currentRow.shiftBoss,
      auditDesk: currentRow.auditDesk,
      auditRowPinned: auditRowPinned,
      archiveIssue: archiveSnapshot.archiveIssue || archiveReceipt.archiveIssue
    };
  }

  function pullDutyConsolePrefs() {
    let storedPrefs = {};
    let rawPrefs = "";
    let sourceKey = DISPATCH_PREFS_KEY;

    try {
      rawPrefs = window.localStorage.getItem(DISPATCH_PREFS_KEY) || "";
    } catch (error) {
      rawPrefs = "";
    }

    if (!rawPrefs) {
      for (let index = 0; index < LEGACY_DISPATCH_PREFS_KEYS.length; index += 1) {
        try {
          rawPrefs = window.localStorage.getItem(LEGACY_DISPATCH_PREFS_KEYS[index]) || "";
        } catch (error) {
          rawPrefs = "";
        }

        if (rawPrefs) {
          sourceKey = LEGACY_DISPATCH_PREFS_KEYS[index];
          break;
        }
      }
    }

    try {
      storedPrefs = JSON.parse(rawPrefs || "{}");
    } catch (error) {
      storedPrefs = {};
    }

    const preparedPrefs = {
      fontSize: Math.max(12, Math.min(22, Number(storedPrefs.fontSize) || 16)),
      soundEnabled: storedPrefs.soundEnabled !== false,
      sectorCode: AZOT_SHIFT_BOOK.sectors[storedPrefs.sectorCode] ? storedPrefs.sectorCode : "bulk-lane",
      brigadeCode: AZOT_SHIFT_BOOK.brigades[storedPrefs.brigadeCode] ? storedPrefs.brigadeCode : "north-3"
    };

    try {
      window.localStorage.setItem(DISPATCH_PREFS_KEY, JSON.stringify(preparedPrefs));
    } catch (error) {}

    if (sourceKey !== DISPATCH_PREFS_KEY) {
      try {
        window.localStorage.removeItem(sourceKey);
      } catch (cleanupError) {}
    }

    return preparedPrefs;
  }

  // Потеря настроек обрабатывается: пульт должен подняться с учетом запуска в инкогнито.
  function stashDutyConsolePrefs(nextPrefs) {
    const preparedPrefs = {
      fontSize: Math.max(12, Math.min(22, Number(nextPrefs && nextPrefs.fontSize) || 16)),
      soundEnabled: !(nextPrefs && nextPrefs.soundEnabled === false),
      sectorCode: nextPrefs && AZOT_SHIFT_BOOK.sectors[nextPrefs.sectorCode] ? nextPrefs.sectorCode : "bulk-lane",
      brigadeCode: nextPrefs && AZOT_SHIFT_BOOK.brigades[nextPrefs.brigadeCode] ? nextPrefs.brigadeCode : "north-3"
    };

    try {
      window.localStorage.setItem(DISPATCH_PREFS_KEY, JSON.stringify(preparedPrefs));
    } catch (error) {}

    return preparedPrefs;
  }

  window.AZOTStorage = {
    pullDutyConsolePrefs: pullDutyConsolePrefs,
    stashDutyConsolePrefs: stashDutyConsolePrefs,
    readCrewWatchboard: readCrewWatchboard,
    logShiftToDutyJournal: logShiftToDutyJournal
  };
})();
