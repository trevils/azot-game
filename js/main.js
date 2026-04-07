(function () {
  const screens = {
    start: document.getElementById('start-screen'),
    game: document.getElementById('game-screen'),
    end: document.getElementById('end-screen')
  };

  const elements = {
    nameInput: document.getElementById('player-name'),
    startButton: document.getElementById('start-btn'),
    startFontDown: document.getElementById('start-font-down'),
    startFontUp: document.getElementById('start-font-up'),
    startSoundButton: document.getElementById('start-sound-btn'),

    canvas: document.getElementById('game-canvas'),
    hudPlayer: document.getElementById('hud-player'),
    hudMode: document.getElementById('hud-mode'),
    hudTimer: document.getElementById('hud-timer'),
    hudScore: document.getElementById('hud-score'),
    pauseButton: document.getElementById('pause-btn'),
    soundButton: document.getElementById('sound-btn'),
    fontDownButton: document.getElementById('font-down-btn'),
    fontUpButton: document.getElementById('font-up-btn'),
    finishButton: document.getElementById('finish-btn'),

    pauseOverlay: document.getElementById('pause-overlay'),
    resumeButton: document.getElementById('resume-btn'),

    endSummary: document.getElementById('end-summary'),
    endExtra: document.getElementById('end-extra'),
    leaderboardBody: document.getElementById('leaderboard-body'),
    playerRank: document.getElementById('player-rank'),
    restartButton: document.getElementById('restart-btn'),
    backButton: document.getElementById('back-btn')
  };

  let settings = window.AZOTStorage.loadSettings();
  let audio = new window.AZOTAudio.AudioManager(settings.soundEnabled);
  let game = null;
  let lastPlayerName = '';

  function applyFontSize(value) {
    settings.fontSize = Math.max(12, Math.min(22, value));
    document.documentElement.style.setProperty('--ui-font-size', settings.fontSize + 'px');
    settings = window.AZOTStorage.saveSettings(settings);
  }

  function applySoundButtons() {
    const label = settings.soundEnabled ? 'Звук: вкл' : 'Звук: выкл';
    elements.soundButton.textContent = label;
    elements.startSoundButton.textContent = label;
  }

  function toggleSound() {
    settings.soundEnabled = audio.toggle();
    settings = window.AZOTStorage.saveSettings(settings);
    applySoundButtons();
  }

  function setScreen(name) {
    Object.keys(screens).forEach(function (key) {
      const active = key === name;
      screens[key].classList.toggle('active', active);
      screens[key].setAttribute('aria-hidden', active ? 'false' : 'true');
    });
  }

  function formatTime(timeLeft) {
    const total = Math.max(0, Math.ceil(timeLeft));
    const minutes = String(Math.floor(total / 60)).padStart(2, '0');
    const seconds = String(total % 60).padStart(2, '0');
    return minutes + ':' + seconds;
  }

  function updateStartButtonState() {
    elements.startButton.disabled = elements.nameInput.value.trim().length === 0;
  }

  function updateHud(payload) {
    elements.hudPlayer.textContent = payload.playerName;
    elements.hudMode.textContent = payload.testMode ? 'TEST MODE' : 'Обычный';
    elements.hudTimer.textContent = payload.testMode ? '∞' : formatTime(payload.timeLeft);
    elements.hudScore.textContent = String(payload.score);
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;');
  }

  function createLeaderboardRow(place, name, score, extraClass) {
    const row = document.createElement('tr');
    if (extraClass) {
      row.className = extraClass;
    }
    row.innerHTML =
      '<td>' + place + '</td>' +
      '<td>' + escapeHtml(name) + '</td>' +
      '<td>' + score + '</td>';
    return row;
  }

  function renderLeaderboard(result) {
    const scores = result && result.top10 ? result.top10 : window.AZOTStorage.loadScores();
    elements.leaderboardBody.innerHTML = '';

    if (!scores.length) {
      elements.leaderboardBody.appendChild(createLeaderboardRow('—', 'Пока пусто', 0, ''));
      return;
    }

    if (result && result.rank > 10 && result.playerEntry) {
      scores.slice(0, 9).forEach(function (entry, index) {
        elements.leaderboardBody.appendChild(
          createLeaderboardRow(index + 1, entry.name, entry.score, '')
        );
      });
      elements.leaderboardBody.appendChild(
        createLeaderboardRow(
          result.rank,
          result.playerEntry.name,
          result.playerEntry.score,
          'leaderboard-row-own'
        )
      );
      return;
    }

    scores.forEach(function (entry, index) {
      elements.leaderboardBody.appendChild(
        createLeaderboardRow(index + 1, entry.name, entry.score, '')
      );
    });
  }

  function showPause(isPaused) {
    elements.pauseOverlay.classList.toggle('hidden', !isPaused);
    elements.pauseOverlay.setAttribute('aria-hidden', isPaused ? 'false' : 'true');
    elements.pauseButton.textContent = isPaused ? 'Продолжить' : 'Пауза';
  }

  function destroyGame() {
    if (game) {
      game.stop();
      game = null;
    }
  }

  function startGame() {
    const name = elements.nameInput.value.trim().slice(0, 16);
    if (!name) {
      return;
    }

    destroyGame();
    lastPlayerName = name;
    showPause(false);
    setScreen('game');

    audio.ensureContext();
    if (settings.soundEnabled) {
      audio.play('click');
    }

    game = new window.AZOTGame.StorageRunner(elements.canvas, {
      audio: audio,
      onHudUpdate: updateHud,
      onPauseChange: showPause,
      onFinish: onFinish
    });

    game.start(name, name.toLowerCase() === 'tester');
  }

  function onFinish(payload) {
    setScreen('end');
    screens.end.scrollTop = 0;

    if (payload.testMode) {
      elements.endSummary.textContent = 'Тестовая смена завершена: ' + payload.score + ' очков';
      elements.endExtra.textContent = 'Тестовый результат не сохраняется в таблицу.';
      elements.playerRank.classList.add('hidden');
      renderLeaderboard(null);
      return;
    }

    if (payload.reason === 'fall') {
      elements.endSummary.textContent = 'Смена провалена: ' + payload.score + ' очков';
    } else {
      elements.endSummary.textContent = 'Итог: ' + payload.score + ' очков';
    }

    const saveResult = window.AZOTStorage.saveScore(payload.playerName, payload.score);
    renderLeaderboard(saveResult);

    if (saveResult.rank > 10) {
      elements.endExtra.textContent = payload.reason === 'fall'
        ? 'Ты выпал за нижний уровень. Таблица показывает топ-9 и твоё место.'
        : 'Таблица показывает топ-9 и твоё место вместо 10-й строки.';
      elements.playerRank.textContent = 'Твоё место в общем рейтинге: ' + saveResult.rank;
      elements.playerRank.classList.remove('hidden');
    } else {
      elements.endExtra.textContent = payload.reason === 'fall'
        ? 'Ты выпал за нижний уровень. Результат сохранён в таблицу.'
        : 'Результат сохранён в таблицу.';
      elements.playerRank.classList.add('hidden');
    }
  }

  function goToStart() {
    destroyGame();
    setScreen('start');
    showPause(false);
    elements.nameInput.value = lastPlayerName || elements.nameInput.value;
    updateStartButtonState();
    renderLeaderboard(null);
  }

  function restartRun() {
    if (lastPlayerName) {
      elements.nameInput.value = lastPlayerName;
      updateStartButtonState();
      startGame();
    } else {
      goToStart();
    }
  }

  elements.nameInput.addEventListener('input', updateStartButtonState);
  elements.startButton.addEventListener('click', startGame);

  elements.pauseButton.addEventListener('click', function () {
    if (game) {
      game.togglePause();
      if (settings.soundEnabled) {
        audio.play('click');
      }
    }
  });

  elements.resumeButton.addEventListener('click', function () {
    if (game && game.paused) {
      game.togglePause();
      if (settings.soundEnabled) {
        audio.play('click');
      }
    }
  });

  elements.finishButton.addEventListener('click', function () {
    if (game) {
      if (game.paused) {
        game.togglePause();
      }
      game.finishRun();
      if (settings.soundEnabled) {
        audio.play('click');
      }
    }
  });

  elements.restartButton.addEventListener('click', function () {
    if (settings.soundEnabled) {
      audio.play('click');
    }
    restartRun();
  });

  elements.backButton.addEventListener('click', function () {
    if (settings.soundEnabled) {
      audio.play('click');
    }
    goToStart();
  });

  elements.soundButton.addEventListener('click', toggleSound);
  elements.startSoundButton.addEventListener('click', toggleSound);

  function changeFont(delta) {
    applyFontSize(settings.fontSize + delta);
    audio.ensureContext();
    if (settings.soundEnabled) {
      audio.play('click');
    }
  }

  elements.fontDownButton.addEventListener('click', function () {
    changeFont(-1);
  });
  elements.fontUpButton.addEventListener('click', function () {
    changeFont(1);
  });
  elements.startFontDown.addEventListener('click', function () {
    changeFont(-1);
  });
  elements.startFontUp.addEventListener('click', function () {
    changeFont(1);
  });

  window.addEventListener('beforeunload', destroyGame);

  applyFontSize(settings.fontSize);
  applySoundButtons();
  updateStartButtonState();
  renderLeaderboard(null);
})();
