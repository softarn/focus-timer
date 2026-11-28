/* Pomodoro timer state machine. Pure and dependency-free: no DOM, no real
 * timers. Callers pass the current time (ms) into start/pause/tick. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.PomodoroTimer = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var FOCUS_MS = 25 * 60 * 1000;
  var BREAK_MS = 5 * 60 * 1000;

  function formatTime(ms) {
    var totalSeconds = Math.ceil(Math.max(0, ms) / 1000);
    var m = Math.floor(totalSeconds / 60);
    var s = totalSeconds % 60;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }

  function formatTitle(state) {
    if (!state.hasStarted) return 'Focus Timer';
    var time = formatTime(state.remainingMs).replace(/^0/, '');
    return time + ' · ' + (state.phase === 'focus' ? 'Focus' : 'Break');
  }

  function countFocusCompletions(phaseBeforeTick, switches) {
    return phaseBeforeTick === 'focus' ? Math.ceil(switches / 2) : Math.floor(switches / 2);
  }

  function createTimer(options) {
    options = options || {};
    var durations = {
      focus: options.focusMs || FOCUS_MS,
      break: options.breakMs || BREAK_MS
    };
    var phase = 'focus';
    var remaining = durations.focus;
    var running = false;
    var hasStarted = false;
    var lastTs = 0;

    // Advance by the time elapsed since the last timestamp. Elapsed time is
    // measured from timestamps, so late ticks never lose time; overshoot
    // carries into the next phase. Returns the number of phase switches.
    function tick(now) {
      if (!running) return 0;
      var elapsed = Math.max(0, now - lastTs);
      lastTs = now;
      remaining -= elapsed;
      var switches = 0;
      while (remaining <= 0) {
        phase = phase === 'focus' ? 'break' : 'focus';
        remaining += durations[phase];
        switches++;
      }
      return switches;
    }

    return {
      start: function (now) {
        if (running) return;
        running = true;
        hasStarted = true;
        lastTs = now;
      },
      pause: function (now) {
        if (!running) return;
        tick(now);
        running = false;
      },
      reset: function () {
        phase = 'focus';
        remaining = durations.focus;
        running = false;
        hasStarted = false;
      },
      setDurations: function (options) {
        var focusMs = options.focusMs;
        var breakMs = options.breakMs;
        if (!Number.isFinite(focusMs) || focusMs <= 0 ||
            !Number.isFinite(breakMs) || breakMs <= 0) return;
        durations.focus = focusMs;
        durations.break = breakMs;
        if (!hasStarted) remaining = durations.focus;
      },
      tick: tick,
      getState: function () {
        return {
          phase: phase,
          running: running,
          hasStarted: hasStarted,
          remainingMs: remaining,
          display: formatTime(remaining)
        };
      }
    };
  }

  return {
    FOCUS_MS: FOCUS_MS,
    BREAK_MS: BREAK_MS,
    createTimer: createTimer,
    formatTime: formatTime,
    formatTitle: formatTitle,
    countFocusCompletions: countFocusCompletions
  };
});
