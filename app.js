/* UI wiring for the Pomodoro timer. Sound and notification failures are
 * swallowed so they can never break the countdown. */
(function () {
  'use strict';

  function getStorage() {
    var browserStorage;
    try {
      browserStorage = window.localStorage;
    } catch (e) { /* storage may be blocked even on access */ }
    var memory = new Map();
    return {
      getItem: function (key) {
        if (memory.has(key)) return memory.get(key);
        try {
          if (browserStorage) return browserStorage.getItem(key);
        } catch (e) { /* the page can still use in-memory values */ }
        return null;
      },
      setItem: function (key, value) {
        try {
          if (browserStorage) {
            browserStorage.setItem(key, value);
            memory.delete(key);
            return;
          }
        } catch (e) { /* keep this value for the current page */ }
        memory.set(key, value);
      }
    };
  }

  function toDurations(settings) {
    return { focusMs: settings.focusMinutes * 60000, breakMs: settings.breakMinutes * 60000 };
  }

  var storage = getStorage();
  var savedSettings = PomodoroSettings.loadSettings(storage);
  var dailyGoal = PomodoroSettings.loadDailyGoal(storage);
  var durations = toDurations(savedSettings);
  var timer = PomodoroTimer.createTimer(durations);
  var els = {
    phase: document.getElementById('phase'),
    countdown: document.getElementById('countdown'),
    toggle: document.getElementById('toggle'),
    reset: document.getElementById('reset'),
    skipBreak: document.getElementById('skip-break'),
    status: document.getElementById('status'),
    dailyCount: document.getElementById('daily-count'),
    settings: document.getElementById('settings'),
    settingsForm: document.getElementById('settings-form'),
    focusMinutes: document.getElementById('focus-minutes'),
    breakMinutes: document.getElementById('break-minutes'),
    dailyGoal: document.getElementById('daily-goal'),
    focusError: document.getElementById('focus-error'),
    breakError: document.getElementById('break-error'),
    goalError: document.getElementById('goal-error'),
    shortcutsTrigger: document.getElementById('shortcuts-trigger'),
    shortcutsDialog: document.getElementById('shortcuts-dialog'),
    shortcutsClose: document.getElementById('shortcuts-close')
  };
  var LABELS = { focus: 'Focus', break: 'Break' };
  var GOAL_REACHED = 'Goal reached — nice work';
  var intervalId = null;
  var audioCtx = null;
  var midnightTimeoutId = null;
  var statusTimeoutId = null;
  var shortcutsPreviousFocus = null;

  function render() {
    var s = timer.getState();
    els.phase.textContent = LABELS[s.phase];
    els.phase.setAttribute('data-phase', s.phase);
    els.countdown.textContent = s.display;
    els.toggle.textContent = s.running ? 'Pause' : 'Start';
    els.skipBreak.hidden = s.phase !== 'break';
    var title = PomodoroTimer.formatTitle(s);
    if (document.title !== title) document.title = title;
  }

  function renderCount(now) {
    var count = PomodoroSettings.getTodayCount(storage, now);
    var text = 'Today: ' + count;
    text += dailyGoal === null ? ' focus session' + (count === 1 ? '' : 's') : ' of ' + dailyGoal;
    if (els.dailyCount.textContent !== text) els.dailyCount.textContent = text;
  }

  function refreshToday() {
    var now = Date.now();
    renderCount(now);
    var nextMidnight = new Date(now);
    nextMidnight.setHours(24, 0, 0, 0);
    clearTimeout(midnightTimeoutId);
    midnightTimeoutId = setTimeout(refreshToday, nextMidnight.getTime() - now);
  }

  function setStatus(text, show, hideAfterMs) {
    clearTimeout(statusTimeoutId);
    els.status.classList.toggle('visually-hidden', !show);
    els.status.textContent = text;
    if (hideAfterMs) {
      statusTimeoutId = setTimeout(function () { setStatus('', false); }, hideAfterMs);
    }
  }

  function setPhaseStatus(text) {
    // Keep the goal message visible across automatic transitions.
    if (els.status.textContent !== GOAL_REACHED) setStatus(text, false);
  }

  function dismissGoalStatus() {
    if (els.status.textContent === GOAL_REACHED) setStatus('', false);
  }

  function validateNumber(input, error, label, optional) {
    var value = input.valueAsNumber;
    var empty = optional && input.value === '' && !input.validity.badInput;
    var invalid = !empty && (!Number.isInteger(value) || value < Number(input.min) || value > Number(input.max));
    if (invalid) {
      input.setAttribute('aria-invalid', 'true');
      error.textContent = label + ' must be a whole number from ' + input.min + ' to ' + input.max + '.';
    } else {
      input.removeAttribute('aria-invalid');
      error.textContent = '';
    }
    return !invalid;
  }

  els.focusMinutes.value = savedSettings.focusMinutes;
  els.breakMinutes.value = savedSettings.breakMinutes;
  els.dailyGoal.value = dailyGoal === null ? '' : dailyGoal;
  els.settingsForm.addEventListener('submit', function (event) {
    event.preventDefault();
    var focusValid = validateNumber(els.focusMinutes, els.focusError, 'Focus minutes');
    var breakValid = validateNumber(els.breakMinutes, els.breakError, 'Break minutes');
    var goalValid = validateNumber(els.dailyGoal, els.goalError, 'Daily goal', true);
    if (!focusValid || !breakValid || !goalValid) {
      var firstInvalid = !focusValid ? els.focusMinutes : !breakValid ? els.breakMinutes : els.dailyGoal;
      firstInvalid.focus();
      return;
    }
    var settings = { focusMinutes: els.focusMinutes.valueAsNumber, breakMinutes: els.breakMinutes.valueAsNumber };
    var goal = els.dailyGoal.value === '' ? null : els.dailyGoal.valueAsNumber;
    PomodoroSettings.saveSettings(storage, settings);
    PomodoroSettings.saveDailyGoal(storage, goal);
    dailyGoal = goal;
    durations = toDurations(settings);
    timer.setDurations(durations);
    render();
    refreshToday();
    setStatus('Settings saved.', true, 3000);
  });

  function chime() {
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!audioCtx) audioCtx = new AC();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      var t0 = audioCtx.currentTime;
      [659.25, 880].forEach(function (freq, i) {
        var osc = audioCtx.createOscillator();
        var gain = audioCtx.createGain();
        var t = t0 + i * 0.25;
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.15, t + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(t);
        osc.stop(t + 1);
      });
    } catch (e) { /* sound is optional */ }
  }

  function notify(text) {
    try {
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        new Notification('Focus Timer', { body: text });
      }
    } catch (e) { /* notification is optional */ }
  }

  function requestNotifyPermission() {
    try {
      if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
        var p = Notification.requestPermission();
        if (p && p.catch) p.catch(function () {});
      }
    } catch (e) { /* ignore */ }
  }

  function onPhaseEnd(phase, goalReached) {
    var text = phase === 'break' ? 'Focus complete. Time for a break.' : 'Break over. Time to focus.';
    if (goalReached) setStatus(GOAL_REACHED, true);
    else setPhaseStatus(text);
    chime();
    notify(goalReached ? 'Focus complete. ' + GOAL_REACHED + '.' : text);
  }

  function advance(now) {
    var previousPhase = timer.getState().phase;
    var switches = timer.tick(now);
    if (switches === 0) return;

    var state = timer.getState();
    var completions = PomodoroTimer.countFocusCompletions(previousPhase, switches);
    var goalReached = false;
    if (completions > 0) {
      // Walk back from the most recent focus completion and stop at local midnight.
      var completedAt = now + state.remainingMs - durations.breakMs;
      if (state.phase === 'focus') completedAt -= durations.focusMs;
      var midnight = new Date(now).setHours(0, 0, 0, 0);
      var cycleMs = durations.focusMs + durations.breakMs;
      var previousCount = PomodoroSettings.getTodayCount(storage, now);
      var count = previousCount;
      for (var i = 0; i < completions && completedAt >= midnight; i++) {
        count = PomodoroSettings.recordFocusComplete(storage, completedAt);
        completedAt -= cycleMs;
      }
      renderCount(now);
      if (dailyGoal !== null && previousCount < dailyGoal && count >= dailyGoal &&
          !PomodoroSettings.hasShownGoalToday(storage, now)) {
        PomodoroSettings.recordGoalShown(storage, now);
        goalReached = true;
      }
    }
    onPhaseEnd(state.phase, goalReached);
  }

  function loop() {
    advance(Date.now());
    render();
  }

  function startLoop() {
    if (intervalId === null) intervalId = setInterval(loop, 250);
  }
  function stopLoop() {
    if (intervalId !== null) { clearInterval(intervalId); intervalId = null; }
  }

  function toggleTimer() {
    dismissGoalStatus();
    if (timer.getState().running) {
      var now = Date.now();
      advance(now);
      timer.pause(now);
      stopLoop();
    } else {
      // Permission and audio unlock both need a user gesture.
      requestNotifyPermission();
      try {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (AC && !audioCtx) audioCtx = new AC();
        if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
      } catch (e) { /* ignore */ }
      timer.start(Date.now());
      startLoop();
    }
    render();
  }

  function resetTimer() {
    timer.reset();
    stopLoop();
    setStatus('', false);
    render();
  }

  function skipBreak() {
    // Dismiss an earlier message before advance can reach a new goal.
    dismissGoalStatus();
    var now = Date.now();
    advance(now);
    if (timer.getState().phase === 'break') {
      timer.skipBreak(now);
      startLoop();
      setPhaseStatus('Break skipped. Time to focus.');
    }
    render();
    els.toggle.focus();
  }

  function openShortcuts() {
    if (els.shortcutsDialog.open) return;
    shortcutsPreviousFocus = document.activeElement;
    els.shortcutsDialog.showModal();
    els.shortcutsClose.focus();
  }

  els.toggle.addEventListener('click', toggleTimer);
  els.reset.addEventListener('click', resetTimer);
  els.skipBreak.addEventListener('click', skipBreak);
  els.shortcutsTrigger.addEventListener('click', openShortcuts);
  els.shortcutsClose.addEventListener('click', function () {
    els.shortcutsDialog.close();
  });
  els.shortcutsDialog.addEventListener('close', function () {
    if (els.shortcutsDialog.open || !shortcutsPreviousFocus) return;
    var previousFocus = shortcutsPreviousFocus;
    shortcutsPreviousFocus = null;
    previousFocus.focus();
  });

  document.addEventListener('keydown', function (event) {
    if (els.shortcutsDialog.open) return;
    var action = PomodoroShortcuts.actionFor(event);
    if (action === null) return;
    event.preventDefault();

    if (action === 'toggle') toggleTimer();
    else if (action === 'reset') resetTimer();
    else if (action === 'help') openShortcuts();
    else if (action === 'settings') {
      els.settings.open = true;
      els.focusMinutes.focus();
    }
  });

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) refreshToday();
  });
  refreshToday();
  render();
})();
