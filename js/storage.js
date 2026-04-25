(function () {
// хранилище смен и настроек для АЗОТ-склад
//
//   v3 → v4: добавлен паспорт смены, сломан импорт, чиним openBrigadeJourna
//   v4 → v5: переименован pickerName→name везде кроме одного места (см ниже),
//             поднял fragilePicked с 25 до 30 — вопрос насчет баланса
//             BROKEN_LEDGER_SNAPSHOT_KEY лежат битые архивы

var CREW_LEDGER_KEY           = "azot-crew-ledger-v5";
var DISPATCH_PREFS_KEY        = "azot-dispatch-prefs-v5";
var BROKEN_LEDGER_SNAPSHOT_KEY = "azot-ledger-quarantine-v2";  // v2 потому что v1 потерян на мерджах
var LEGACY_CREW_LEDGER_KEYS   = ["azot-crew-ledger-v4"];
var LEGACY_DISPATCH_PREFS_KEYS = ["azot-dispatch-prefs-v4"];
var ARCHIVE_LIMIT = 60;
var RESERVE_PICKER_NAME = "Стажер";  // когда имя на диспетчере не пришло

var WAREHOUSE_RATE_CARD = {
  ordinaryPicked:    10,
  urgentPicked:      20,
  fragilePicked:     30,   // было 25, по тесту введен пересчет после третьего прогона
  falls:            -10,
  cartHits:         -15,
  cartOrdinaryLosses: -5,
  cartUrgentLosses:   -8,
  cartFragileLosses: -15
};

// конфиг секторов и бригад — не трогать без синхронизации с game.js
// 2DO: вынести в отдельный файл
var AZOT_SHIFT_BOOK = {
  sectors: {
    "bulk-lane": {
      label: "Паллетный ряд", shortLabel: "Паллеты",
      boardTag: "PLT-17", zoneTag: "PLT",
      supervisor: "Мастер Орлова",
      incidentLimit: 3,
      targetPoints: 400, reviewFloor: 90,
      shiftRule:        "не просадить паллетный поток",
      shiftRoute:       "окно перебора",
      overloadReason:   "Паллетный ряд ушел в пересорт",
      scoreFloorReason: "Паллетный поток сдан ниже сменной нормы",
      expressSlipReason: "", breakageReason: "",
      faultStamp: "Паллетная линия не подняла смену",
      auditDesk:  "пульт Орловой"
    },
    "rush-dock": {
      label: "Экспресс-ворота", shortLabel: "Экспресс",
      boardTag: "EXP-04", zoneTag: "EXP",
      supervisor: "Диспетчер Климов",
      incidentLimit: 60,    // у него своя статистика срывов
      targetPoints: 180, reviewFloor: 110,
      shiftRule:        "не сорвать срочные окна",
      shiftRoute:       "стол Климова",
      overloadReason:   "Экспресс-ворота сорвали окно отгрузки",
      scoreFloorReason: "Экспресс-поток закрыт ниже сменной нормы",
      expressSlipReason: "На воротах сорвано срочное окно",
      breakageReason: "",
      faultStamp: "Экспресс-ворота потеряли пульт смены",
      auditDesk:  "экспресс-пульт Климова"
    },
    "fragile-bay": {
      label: "Хрупкий ряд", shortLabel: "Хрупкий",
      boardTag: "FRG-09", zoneTag: "FRG",
      supervisor: "Контролер Ланина",
      incidentLimit: 30,   // не баг. хрупкому инцидент это катастрофа
      targetPoints: 150, reviewFloor: 85,
      shiftRule:        "сдать хрупкий товар без боя",
      shiftRoute:       "контрольный стол Ланиной",
      overloadReason:   "Хрупкий ряд дал брак и возвраты",
      scoreFloorReason: "Хрупкий ряд закрыт ниже планки безбрака",
      expressSlipReason: "",
      breakageReason:   "На хрупком ряду зафиксирован бой",
      faultStamp: "Хрупкий ряд остался без игрового поля",
      auditDesk:  "стол Ланиной"
    }
  },
  brigades: {
    "north-3":   { label: "Север-3",       brigadeTag: "N3",  lead: "Романов",    handoverDesk: "окно А2" },
    "azot-pack": { label: "Азот-комплект", brigadeTag: "AZP", lead: "Ведерникова", handoverDesk: "окно Б1" },
    "night-belt":{ label: "Ночная лента",  brigadeTag: "NBT", lead: "Чернов",      handoverDesk: "ночной пост" }
  }
};


// принимает сырой passport из сохраненной строки или из game.js
// возвращает всегда полный объект — даже если на вход пришел null или мусор

// разрослась потому что между v3 и v4 паспорт менял форму три раза,
// и каждый раз на сливаниях приносился старый localStorage.
// сейчас тут живут страховки на все эти случаи разом.
function normalizeShiftPassport(pp) {
  if (!pp || typeof pp !== 'object' || Array.isArray(pp)) pp = {};

  var sc_key = AZOT_SHIFT_BOOK.sectors[pp.sectorCode]  ? pp.sectorCode  : "bulk-lane";
  var br_key = AZOT_SHIFT_BOOK.brigades[pp.brigadeCode] ? pp.brigadeCode : "north-3";
  var SC = AZOT_SHIFT_BOOK.sectors[sc_key];
  var BR = AZOT_SHIFT_BOOK.brigades[br_key];

  return {
    sectorCode:        sc_key,
    sectorLabel:       SC.label,
    sectorShortLabel:  SC.shortLabel,
    boardTag:          pp.boardTag || SC.boardTag,
    brigadeCode:       br_key,
    brigadeLabel:      BR.label,
    brigadeLead:       BR.lead,
    brigadeCallSign:   pp.brigadeCallSign || BR.brigadeTag,
    supervisor:        SC.supervisor,
    archiveTag:        BR.brigadeTag + "-" + SC.zoneTag,
    incidentLimit:     SC.incidentLimit,  // строго из конфига — pp.incidentLimit не доверяем после бага с хрупким
    targetPoints:      SC.targetPoints,
    reviewFloor:       SC.reviewFloor,
    shiftRule:         SC.shiftRule,
    handoverDesk:      BR.handoverDesk,
    shiftRoute:        pp.shiftRoute  || SC.shiftRoute,
    launchBrief:       pp.launchBrief || SC.shiftRule,
    faultStamp:        pp.faultStamp  || SC.faultStamp,
    overloadReason:    SC.overloadReason,
    scoreFloorReason:  SC.scoreFloorReason,
    expressSlipReason: SC.expressSlipReason,
    breakageReason:    SC.breakageReason,
    auditDesk:         SC.auditDesk
  };
}


// эта функция — самое страшное место файла
// сюда прилетает всё: записи из старых версий, записи после дублей финиша,
// записи с невозможными очками (откуда 9999 взялось)
//
// логика такая:
//   1. чистим и нормализуем все поля
//   2. пересчитываем очки по тарифной карте
//   3. сравниваем с тем что пришло — если расходится больше чем на 5, ставим флаг
//   4. навешиваем бейдж и причины ревью
//
// возвращает null если строка совсем мусорная (не объект)
function validateAndScoreShift(rawRow) {
  if (!rawRow || typeof rawRow !== "object") return null;

  var pp   = normalizeShiftPassport(rawRow.shiftPassport);
  var src  = (rawRow.stats && typeof rawRow.stats === "object") ? rawRow.stats : {};

  var facts = {
    ordinarySpawned: 0, ordinaryPicked: 0,
    urgentSpawned:   0, urgentPicked:   0,
    fragileSpawned:  0, fragilePicked:  0,
    falls: 0, cartHits: 0,
    cartCargoLosses: 0, cartOrdinaryLosses: 0, cartUrgentLosses: 0, cartFragileLosses: 0,
    urgentExpired: 0, fragileBroken: 0,
    boostsUsed: 0
  };

  var keys = Object.keys(facts);
  var hasStats = false;
  var exp = 0;
  var marks = [];

  // имя: в v4 было pickerName, в v5 переехало в name.
  // одно место в game.js до сих пор шлёт pickerName — не трогаю пока не сломалось
  var nm = typeof rawRow.name === "string" ? rawRow.name.trim()
         : typeof rawRow.pickerName === "string" ? rawRow.pickerName.trim()
         : "";
  if (nm.length > 16) nm = nm.slice(0, 16);

  var score = Number(rawRow.score);
  score = Number.isFinite(score) ? Math.max(0, Math.round(score)) : 0;

  var ts = Number(rawRow.createdAt);

  var reason = (rawRow.reason === "fall" || rawRow.reason === "timeout" || rawRow.reason === "canvas-error")
    ? rawRow.reason : "complete";

  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    var v = Number(src[k]);
    v = (Number.isFinite(v) && v > 0) ? Math.floor(v) : 0;
    facts[k] = v;
    if (v > 0) hasStats = true;
  }

  exp += facts.ordinaryPicked    * WAREHOUSE_RATE_CARD.ordinaryPicked;
  exp += facts.urgentPicked      * WAREHOUSE_RATE_CARD.urgentPicked;
  exp += facts.fragilePicked     * WAREHOUSE_RATE_CARD.fragilePicked;
  exp += facts.falls             * WAREHOUSE_RATE_CARD.falls;
  exp += facts.cartHits          * WAREHOUSE_RATE_CARD.cartHits;
  exp += facts.cartOrdinaryLosses * WAREHOUSE_RATE_CARD.cartOrdinaryLosses;
  exp += facts.cartUrgentLosses  * WAREHOUSE_RATE_CARD.cartUrgentLosses;
  exp += facts.cartFragileLosses * WAREHOUSE_RATE_CARD.cartFragileLosses;

  var incidents = facts.falls + facts.cartHits + facts.cartCargoLosses
                + facts.urgentExpired + facts.fragileBroken;

  // секторные бонусы.
  // пороги подбирались на живых прогонах, менять только вместе с тестами и синхронизацией с game.js
  if (pp.sectorCode === "bulk-lane") {
    if (facts.ordinaryPicked >= 10 && facts.cartOrdinaryLosses === 0) {
      exp += 12;
      marks.push("паллетный план удержан");
    }
    if (facts.cartCargoLosses >= 3) {
      exp -= 10;
      marks.push("паллетный ряд дал пересорт");
    }
  }

  if (pp.sectorCode === "rush-dock") {
    if (facts.urgentPicked >= 4 && facts.urgentExpired === 0) {
      exp += 15;
      marks.push("экспресс-окно закрыто без срыва");
    }
    if (facts.urgentExpired > 0) {
      exp -= facts.urgentExpired * 12;  // штраф за каждый просроченный, не пушаьный
      marks.push("на воротах была просрочка");
    }
  }

  if (pp.sectorCode === "fragile-bay") {
    if (facts.fragilePicked >= 3 && facts.fragileBroken === 0 && facts.cartFragileLosses === 0) {
      exp += 20;
      marks.push("хрупкий ряд сдан без боя");
    }
    if (facts.fragileBroken + facts.cartFragileLosses > 0) {
      exp -= 20;
      marks.push("по хрупкому прошел брак");
    }
  }

  // бригадные бонусы
  if (pp.brigadeCode === "north-3" && facts.falls === 0 && facts.cartHits === 0) {
    exp += 6;
    marks.push("Север-3 отработал без травм");
  }
  if (pp.brigadeCode === "azot-pack" && (facts.ordinaryPicked + facts.fragilePicked) >= 8 && facts.cartCargoLosses === 0) {
    exp += 10;
    marks.push("Азот-комплект закрыл плотную отгрузку");
  }
  if (pp.brigadeCode === "night-belt" && facts.boostsUsed >= 2 && facts.falls === 0) {
    exp += 8;
    marks.push("ночная лента держала темп");
  }

  if (incidents > pp.incidentLimit) exp -= (incidents - pp.incidentLimit) * 5;
  if (reason === "canvas-error")    exp  = 0;
  exp = Math.max(0, Math.round(exp));

  // scoreCheck: сравниваем пришедший score с тем что мы сами насчитали
  // minor-drift (<=5) — скорее всего окей, бывает от порядка применения бонусов
  // needs-hand-check — реально расходится, надо смотреть
  var chk;
  if (!hasStats)                           chk = "legacy-row";
  else if (score === exp)                  chk = "ok";
  else if (Math.abs(score - exp) <= 5)     chk = "minor-drift";
  else                                     chk = "needs-hand-check";

  var row = {
    entryId: (typeof rawRow.entryId === "string" && rawRow.entryId.trim())
      ? rawRow.entryId
      : "shift-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8),
    name:         nm || RESERVE_PICKER_NAME,
    score:        score,
    createdAt:    (Number.isFinite(ts) && ts > 0) ? Math.floor(ts) : Date.now(),
    reason:       reason,
    lives:        (Number.isFinite(Number(rawRow.lives)) && Number(rawRow.lives) > 0) ? Math.floor(Number(rawRow.lives)) : 0,
    testMode:     !!rawRow.testMode,
    shiftPassport: pp,
    stats:        facts,
    incidentLoad: incidents,
    shiftBadge:   "Дежурный комплектовщик",
    serviceNote:  marks.join("; "),
    scoreCheck:   chk,
    expectedPoints: hasStats ? exp : score,
    reviewFlag:   false,
    reviewReason: "",
    shiftBoss:    pp.supervisor,
    auditDesk:    pp.auditDesk,
    archiveTag:   pp.archiveTag,
    planClosed:   score >= pp.targetPoints
  };

  // canvas-error обрабатываем первым — дальше смотреть нечего
  if (row.reason === "canvas-error") {
    row.shiftBadge   = "Сбой терминала";
    row.reviewFlag   = true;
    row.reviewReason = "Терминал не открыл игровое поле";
    return row;
  }

  // бейджи — порядок важен, первое совпадение побеждает
  if      (pp.brigadeCode === "north-3"    && facts.falls === 0 && facts.cartHits === 0)           row.shiftBadge = "Север-3 без потерь";
  else if (pp.sectorCode  === "rush-dock"  && facts.urgentPicked >= 4 && facts.urgentExpired === 0) row.shiftBadge = "Экспресс закрыт в срок";
  else if (pp.sectorCode  === "fragile-bay"&& facts.fragilePicked >= 3 && facts.fragileBroken === 0 && facts.cartFragileLosses === 0) row.shiftBadge = "Ряд хрупкого под контролем";
  else if (pp.sectorCode  === "bulk-lane"  && facts.ordinaryPicked >= 8 && facts.cartCargoLosses <= 1) row.shiftBadge = "Паллетный мотор";
  else if (pp.brigadeCode === "night-belt" && facts.boostsUsed >= 2)                                row.shiftBadge = "Ночная лента держит темп";
  else if (pp.brigadeCode === "azot-pack"  && facts.fragilePicked >= 2 && facts.cartFragileLosses === 0) row.shiftBadge = "Азот-комплект без боя";
  else if (facts.falls >= 3)               row.shiftBadge = "Нарушение ТБ";
  else if (facts.cartCargoLosses >= 3)     row.shiftBadge = "Сложный маршрут";

  // флаги ревью — каждый return отдельно чтобы причина была одна конкретная,
  // а не "что-то из трёх"
  if (chk === "needs-hand-check") {
    row.reviewFlag   = true;
    row.reviewReason = "Очки не сошлись со служебной статистикой";
    return row;
  }

  if (pp.sectorCode === "rush-dock" && facts.urgentExpired > 0) {
    row.reviewFlag   = true;
    row.reviewReason = pp.expressSlipReason || "Срыв экспресс-окна на воротах";
    return row;
  }

  if (pp.sectorCode === "fragile-bay" && (facts.fragileBroken + facts.cartFragileLosses) > 0) {
    row.reviewFlag   = true;
    row.reviewReason = pp.breakageReason || "Бой хрупкого товара на участке";
    return row;
  }

  if (facts.falls >= 3) {
    row.reviewFlag   = true;
    row.reviewReason = "Повторные нарушения ТБ за смену";
    return row;
  }

  if (incidents > pp.incidentLimit) {
    row.reviewFlag   = true;
    row.reviewReason = pp.overloadReason || "Потери участка выше нормы";
    return row;
  }

  if (!row.planClosed && row.reason === "complete" && row.score < pp.reviewFloor) {
    row.reviewFlag   = true;
    row.reviewReason = pp.scoreFloorReason || "Участок сдан ниже сменной нормы";
  }

  // отдельные пороги для тест-режима — в обычной игре такого не бывает физически
  if (row.testMode) {
    if (pp.sectorCode === "rush-dock"   && facts.urgentExpired > 40) { row.reviewFlag = true; row.reviewReason = "Просрочено больше 40 срочных заказов"; row.planClosed = false; }
    if (pp.sectorCode === "fragile-bay" && facts.cartHits > 60)      { row.reviewFlag = true; row.reviewReason = "Тележки сбили больше 60 заказов";       row.planClosed = false; }
  }

  return row;
}

// старое имя оставлено — в двух местах game.js его вызывает напрямую
var cutBrigadeLedgerRow = validateAndScoreShift;


function sortBrigadeLedger(a, b) {
  if (a.score       !== b.score)       return b.score - a.score;
  if (a.reviewFlag  !== b.reviewFlag)  return a.reviewFlag ? 1 : -1;
  if (a.incidentLoad !== b.incidentLoad) return a.incidentLoad - b.incidentLoad;
  if (a.stats.urgentPicked !== b.stats.urgentPicked) return b.stats.urgentPicked - a.stats.urgentPicked;
  return a.createdAt - b.createdAt;
}


// упаковывает итог смены в строку журнала
// принимает либо объект-summary (новый путь) либо имя+очки (совместимость с v3)
function sealShiftHandover(summaryOrName, maybeScore) {
  if (summaryOrName && typeof summaryOrName === "object") {
    return cutBrigadeLedgerRow({
      entryId:      "",
      name:         summaryOrName.pickerName,  // game.js v4 шлет pickerName, v5 — name, принимаем оба
      score:        summaryOrName.score,
      createdAt:    Date.now(),
      reason:       summaryOrName.reason,
      lives:        summaryOrName.lives,
      testMode:     !!summaryOrName.testMode,
      shiftPassport: summaryOrName.shiftPassport,
      stats:        summaryOrName.stats
    });
  }
  return cutBrigadeLedgerRow({
    entryId: "", name: summaryOrName, score: maybeScore,
    createdAt: Date.now(), reason: "complete",
    lives: 0, testMode: false, shiftPassport: null, stats: {}
  });
}


// читает архив из localStorage, чистит мусор, возвращает готовый массив строк
//
// много всего обрабатывает потому что за два года сломалось буквально всё:
// - двойные финиши (кнопка нажата дважды за 200мс) → дубли по fingerprint
// - битый JSON после обрыва записи → quarantine
// - localStorage недоступен в приватном режиме Firefox → возврат пустого
// - старые ключи (v4) после обновления → миграция на лету
// - storedRows оказался объектом а не массивом (было, причина не найдена)
function openBrigadeJournal() {
  var raw = "";
  var stored = [];
  var rows = [];
  var repaired = false;
  var removed  = 0;
  var issue    = "";
  var srcKey   = CREW_LEDGER_KEY;
  var seenIds  = {};
  var seenFP   = {};  // fingerprint: name|archiveTag|score|минута

  try {
    raw = window.localStorage.getItem(CREW_LEDGER_KEY) || "";
  } catch (e) {
    return { rows: [], wasRepaired: false, removedRows: 0, archiveIssue: "browser-blocked-ledger" };
  }

  if (!raw) {
    for (var li = 0; li < LEGACY_CREW_LEDGER_KEYS.length; li++) {
      try { raw = window.localStorage.getItem(LEGACY_CREW_LEDGER_KEYS[li]) || ""; } catch(e) { raw = ""; }
      if (raw) { srcKey = LEGACY_CREW_LEDGER_KEYS[li]; issue = "legacy-ledger-migrated"; repaired = true; break; }
    }
  }

  if (!raw) return { rows: [], wasRepaired: false, removedRows: 0, archiveIssue: "", sourceKey: srcKey };

  try {
    stored = JSON.parse(raw);
  } catch(e) {
    // JSON мертвый — откладываем в quarantine и живем дальше
    try { window.localStorage.setItem(BROKEN_LEDGER_SNAPSHOT_KEY, raw.slice(0, 12000)); } catch(q) {}
    try { window.localStorage.removeItem(CREW_LEDGER_KEY); } catch(c) {}
    return { rows: [], wasRepaired: true, removedRows: 0, archiveIssue: "ledger-quarantined", sourceKey: srcKey };
  }

  if (!Array.isArray(stored)) {
    // разом оказался объект. откуда — непонятно
    try { window.localStorage.removeItem(CREW_LEDGER_KEY); } catch(c) {}
    return { rows: [], wasRepaired: true, removedRows: 0, archiveIssue: "ledger-reset-from-object", sourceKey: srcKey };
  }

  for (var i = 0; i < stored.length; i++) {
    var r = cutBrigadeLedgerRow(stored[i]);
    if (!r) { removed++; repaired = true; continue; }

    if (seenIds[r.entryId]) { r.entryId = r.entryId + "-" + (i + 1); repaired = true; }

    var fp = r.name + "|" + r.archiveTag + "|" + r.score + "|" + Math.floor(r.createdAt / 60000);
    if (seenFP[fp]) { removed++; repaired = true; issue = issue || "double-handover-pruned"; continue; }

    seenIds[r.entryId] = true;
    seenFP[fp] = true;

    var s = stored[i];
    if (s.shiftBadge !== r.shiftBadge || s.reviewReason !== r.reviewReason
     || s.scoreCheck !== r.scoreCheck  || s.serviceNote  !== r.serviceNote) {
      repaired = true;
    }

    rows.push(r);
  }

  rows.sort(sortBrigadeLedger);

  if (rows.length > ARCHIVE_LIMIT) {
    removed += rows.length - ARCHIVE_LIMIT;
    rows = rows.slice(0, ARCHIVE_LIMIT);
    repaired = true;
  }

  return { rows: rows, wasRepaired: repaired, removedRows: removed, archiveIssue: issue, sourceKey: srcKey };
}


// пишет архив в localStorage.
// если не влезает — режет ступенчато: сначала 40 строк без лишних полей,
// потом топ-10 вообще без статистики.
// возвращает что удалось сохранить — вызывающий код потом решает что показывать.
function stashBrigadeJournal(rows) {
  var full = rows.slice(0, ARCHIVE_LIMIT);

  try {
    window.localStorage.setItem(CREW_LEDGER_KEY, JSON.stringify(full));
    return { archiveSaved: true, archiveMode: "full-archive", persistedRows: full, rowsSkipped: 0, archiveIssue: "" };
  } catch(e) {}

  var compact = full.slice(0, 40).map(function(r) {
    return {
      entryId: r.entryId, name: r.name, score: r.score,
      createdAt: r.createdAt, reason: r.reason,
      shiftPassport: { sectorCode: r.shiftPassport.sectorCode, brigadeCode: r.shiftPassport.brigadeCode },
      stats: r.stats,
      shiftBadge: r.shiftBadge, serviceNote: r.serviceNote,
      reviewReason: r.reviewReason, scoreCheck: r.scoreCheck, shiftBoss: r.shiftBoss
    };
  });

  try {
    window.localStorage.setItem(CREW_LEDGER_KEY, JSON.stringify(compact));
    return { archiveSaved: true, archiveMode: "trimmed-archive", persistedRows: full.slice(0, 40), rowsSkipped: full.length - 40, archiveIssue: "archive-trimmed-for-browser" };
  } catch(e) {}

  // рубеж — топ-10 без stats. хоть имена видны
  var mini = full.slice(0, 10).map(function(r) {
    return {
      entryId: r.entryId, name: r.name, score: r.score, createdAt: r.createdAt,
      shiftBadge: r.shiftBadge, reviewReason: r.reviewReason,
      shiftPassport: { sectorCode: r.shiftPassport.sectorCode, brigadeCode: r.shiftPassport.brigadeCode }
    };
  });

  try {
    window.localStorage.setItem(CREW_LEDGER_KEY, JSON.stringify(mini));
    return { archiveSaved: true, archiveMode: "watchlist-top10", persistedRows: full.slice(0, 10), rowsSkipped: full.length - 10, archiveIssue: "only-top10-fits" };
  } catch(e) {}

  return { archiveSaved: false, archiveMode: "screen-only", persistedRows: full, rowsSkipped: 0, archiveIssue: "browser-blocked-ledger" };
}


function readCrewWatchboard() {
  var snap = openBrigadeJournal();
  if (snap.wasRepaired) {
    stashBrigadeJournal(snap.rows);
    if (snap.sourceKey !== CREW_LEDGER_KEY) {
      try { window.localStorage.removeItem(snap.sourceKey); } catch(e) {}
    }
  }
  return snap.rows;
}


function logShiftToDutyJournal(summaryOrName, maybeScore) {
  var snap = openBrigadeJournal();
  var cur  = sealShiftHandover(summaryOrName, maybeScore);

  // история по той же линии — нужна для serviceNote про серии
  var laneHistory = snap.rows.filter(function(r) { return r.archiveTag === cur.archiveTag; }).slice(0, 4);
  var nReviews    = laneHistory.filter(function(r) { return r.reviewFlag; }).length;
  var nMisses     = laneHistory.filter(function(r) { return !r.planClosed; }).length;

  var ranked      = snap.rows.concat(cur).sort(sortBrigadeLedger);
  var toStore     = ranked.slice(0, ARCHIVE_LIMIT);
  var pinned      = false;

  if (cur.reviewFlag && nReviews >= 2) {
    cur.serviceNote = (cur.serviceNote ? cur.serviceNote + "; " : "") + "линия третий раз подряд уходит на ручную сверку";
  } else if (!cur.reviewFlag && nReviews >= 2) {
    cur.serviceNote = (cur.serviceNote ? cur.serviceNote + "; " : "") + "линия снята с повторной сверки";
  }

  if (cur.planClosed && nMisses >= 2) {
    cur.serviceNote = (cur.serviceNote ? cur.serviceNote + "; " : "") + "участок закрыл план после серии провальных сдач";
  }

  // если review-строка вылетела за ARCHIVE_LIMIT — впихиваем последней,
  // иначе Ланина не видит флаги и думает что всё хорошо
  if (cur.reviewFlag) {
    var inTop = toStore.some(function(r) { return r.entryId === cur.entryId; });
    if (!inTop && toStore.length) {
      toStore[toStore.length - 1] = cur;
      toStore.sort(sortBrigadeLedger);
      pinned = true;
    }
  }

  var receipt = stashBrigadeJournal(toStore);
  var rank    = ranked.findIndex(function(r) { return r.entryId === cur.entryId; }) + 1;

  if (snap.sourceKey !== CREW_LEDGER_KEY) {
    try { window.localStorage.removeItem(snap.sourceKey); } catch(e) {}
  }

  return {
    top10:              receipt.persistedRows.slice(0, 10),
    rank:               rank > 0 ? rank : ranked.length + 1,
    archiveSaved:       receipt.archiveSaved,
    archiveMode:        receipt.archiveMode,
    archiveWasRepaired: snap.wasRepaired,
    removedRows:        snap.removedRows + receipt.rowsSkipped,
    pickerRow:          cur,
    shiftBadge:         cur.shiftBadge,
    serviceNote:        cur.serviceNote,
    scoreCheck:         cur.scoreCheck,
    expectedPoints:     cur.expectedPoints,
    reviewFlag:         cur.reviewFlag,
    reviewReason:       cur.reviewReason,
    shiftBoss:          cur.shiftBoss,
    auditDesk:          cur.auditDesk,
    auditRowPinned:     pinned,
    archiveIssue:       snap.archiveIssue || receipt.archiveIssue
  };
}


function pullDutyConsolePrefs() {
  var raw = "";
  var srcKey = DISPATCH_PREFS_KEY;

  try { raw = window.localStorage.getItem(DISPATCH_PREFS_KEY) || ""; } catch(e) {}

  if (!raw) {
    for (var li = 0; li < LEGACY_DISPATCH_PREFS_KEYS.length; li++) {
      try { raw = window.localStorage.getItem(LEGACY_DISPATCH_PREFS_KEYS[li]) || ""; } catch(e) {}
      if (raw) { srcKey = LEGACY_DISPATCH_PREFS_KEYS[li]; break; }
    }
  }

  var stored = {};
  try { stored = JSON.parse(raw || "{}"); } catch(e) {}

  var prefs = {
    fontSize:    Math.max(12, Math.min(22, Number(stored.fontSize) || 16)),
    soundEnabled: stored.soundEnabled !== false,
    sectorCode:  AZOT_SHIFT_BOOK.sectors[stored.sectorCode]   ? stored.sectorCode   : "bulk-lane",
    brigadeCode: AZOT_SHIFT_BOOK.brigades[stored.brigadeCode]  ? stored.brigadeCode  : "north-3"
  };

  try { window.localStorage.setItem(DISPATCH_PREFS_KEY, JSON.stringify(prefs)); } catch(e) {}
  if (srcKey !== DISPATCH_PREFS_KEY) { try { window.localStorage.removeItem(srcKey); } catch(e) {} }

  return prefs;
}

function stashDutyConsolePrefs(next) {
  var prefs = {
    fontSize:    Math.max(12, Math.min(22, Number(next && next.fontSize) || 16)),
    soundEnabled: !(next && next.soundEnabled === false),
    sectorCode:  (next && AZOT_SHIFT_BOOK.sectors[next.sectorCode])   ? next.sectorCode   : "bulk-lane",
    brigadeCode: (next && AZOT_SHIFT_BOOK.brigades[next.brigadeCode])  ? next.brigadeCode  : "north-3"
  };
  try { window.localStorage.setItem(DISPATCH_PREFS_KEY, JSON.stringify(prefs)); } catch(e) {}
  return prefs;
}


window.AZOTStorage = {
  pullDutyConsolePrefs:  pullDutyConsolePrefs,
  stashDutyConsolePrefs: stashDutyConsolePrefs,
  readCrewWatchboard:    readCrewWatchboard,
  logShiftToDutyJournal: logShiftToDutyJournal
};

})();