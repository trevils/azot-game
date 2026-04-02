(function () {
  const SCORE_KEY = 'azot-order-picker-scores-v1';
  const SETTINGS_KEY = 'azot-order-picker-settings-v1';

  function loadScores() {
    try {
      const raw = localStorage.getItem(SCORE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      return [];
    }
  }

  function saveScores(scores) {
    localStorage.setItem(SCORE_KEY, JSON.stringify(scores));
  }

  function saveScore(name, score) {
    const cleanName = (name || 'Игрок').trim().slice(0, 16) || 'Игрок';
    const cleanScore = Math.max(0, Math.floor(score || 0));
    const createdAt = Date.now();
    const scores = loadScores();

    scores.push({
      name: cleanName,
      score: cleanScore,
      createdAt: createdAt
    });

    scores.sort(function (a, b) {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return a.createdAt - b.createdAt;
    });

    const rank = scores.findIndex(function (entry) {
      return entry.createdAt === createdAt;
    }) + 1;

    const keptScores = scores.slice(0, 100);
    const top10 = keptScores.slice(0, 10);
    saveScores(keptScores);
    return {
      top10: top10,
      rank: rank,
      playerEntry: {
        name: cleanName,
        score: cleanScore,
        createdAt: createdAt
      }
    };
  }

  function loadSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return {
        fontSize: typeof parsed.fontSize === 'number' ? parsed.fontSize : 16,
        soundEnabled: parsed.soundEnabled !== false
      };
    } catch (error) {
      return {
        fontSize: 16,
        soundEnabled: true
      };
    }
  }

  function saveSettings(settings) {
    const safeSettings = {
      fontSize: Math.min(22, Math.max(12, Number(settings.fontSize) || 16)),
      soundEnabled: settings.soundEnabled !== false
    };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(safeSettings));
    return safeSettings;
  }

  window.AZOTStorage = {
    loadScores: loadScores,
    saveScore: saveScore,
    loadSettings: loadSettings,
    saveSettings: saveSettings
  };
})();
