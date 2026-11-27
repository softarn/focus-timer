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
  var durations = toDurations(savedSettings);
  var timer = PomodoroTimer.createTimer(durations);
  var els = {
    phase: document.getElementById('phase'),
    countdown: document.getElementById('countdown'),
    toggle: document.getElementById('toggle'),
    reset: document.getElementById('reset'),
    status: document.getElementById('status'),
    dailyCount: document.getElementById('daily-count'),
    settingsForm: document.getElementById('settings-form'),
    focusMinutes: document.getElementById('focus-minutes'),
    breakMinutes: document.getElementById('break-minutes'),
    focusError: document.getElementById('focus-error'),
    breakError: document.getElementById('break-error')
  };
  var LABELS = { focus: 'Focus', break: 'Break' };
  var intervalId = null;
  var audioCtx = null;
  var midnightTimeoutId = null;
  var statusTimeoutId = null;

  function render() {
    var s = timer.getState();
    els.phase.textContent = LABELS[s.phase];
    els.phase.setAttribute('data-phase', s.phase);
    els.countdown.textContent = s.display;
    els.toggle.textContent = s.running ? 'Pause' : 'Start';
    document.title = s.display + ' – ' + LABELS[s.phase];
  }

  function renderCount(now) {
    var count = PomodoroSettings.getTodayCount(storage, now);
    var text = 'Today: ' + count + ' focus session' + (count === 1 ? '' : 's');
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

  function setStatus(text, show) {
    clearTimeout(statusTimeoutId);
    els.status.classList.toggle('visually-hidden', !show);
    els.status.textContent = text;
    if (show) {
      statusTimeoutId = setTimeout(function () { setStatus('', false); }, 3000);
    }
  }

  function validateMinutes(input, error, label) {
    var minutes = input.valueAsNumber;
    var invalid = !Number.isInteger(minutes) || minutes < Number(input.min) || minutes > Number(input.max);
    if (invalid) {
      input.setAttribute('aria-invalid', 'true');
      error.textContent = label + ' must be a whole number from 1 to 90.';
    } else {
      input.removeAttribute('aria-invalid');
      error.textContent = '';
    }
    return !invalid;
  }

  els.focusMinutes.value = savedSettings.focusMinutes;
  els.breakMinutes.value = savedSettings.breakMinutes;
  els.settingsForm.addEventListener('submit', function (event) {
    event.preventDefault();
    var focusValid = validateMinutes(els.focusMinutes, els.focusError, 'Focus minutes');
    var breakValid = validateMinutes(els.breakMinutes, els.breakError, 'Break minutes');
    if (!focusValid || !breakValid) {
      (focusValid ? els.breakMinutes : els.focusMinutes).focus();
      return;
    }
    var settings = { focusMinutes: els.focusMinutes.valueAsNumber, breakMinutes: els.breakMinutes.valueAsNumber };
    PomodoroSettings.saveSettings(storage, settings);
    durations = toDurations(settings);
    timer.setDurations(durations);
    render();
    setStatus('Durations updated.', true);
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

  function onPhaseEnd(phase) {
    var text = phase === 'break' ? 'Focus complete. Time for a break.' : 'Break over. Time to focus.';
    setStatus(text, false);
    chime();
    notify(text);
  }

  function advance(now) {
    var previousPhase = timer.getState().phase;
    var switches = timer.tick(now);
    if (switches === 0) return;

    var state = timer.getState();
    var completions = PomodoroTimer.countFocusCompletions(previousPhase, switches);
    if (completions > 0) {
      // Walk back from the most recent focus completion and stop at local midnight.
      var completedAt = now + state.remainingMs - durations.breakMs;
      if (state.phase === 'focus') completedAt -= durations.focusMs;
      var midnight = new Date(now).setHours(0, 0, 0, 0);
      var cycleMs = durations.focusMs + durations.breakMs;
      for (var i = 0; i < completions && completedAt >= midnight; i++) {
        PomodoroSettings.recordFocusComplete(storage, completedAt);
        completedAt -= cycleMs;
      }
      renderCount(now);
    }
    onPhaseEnd(state.phase);
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

  els.toggle.addEventListener('click', function () {
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
  });

  els.reset.addEventListener('click', function () {
    timer.reset();
    stopLoop();
    setStatus('', false);
    render();
  });

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) refreshToday();
  });
  refreshToday();
  render();
})();
