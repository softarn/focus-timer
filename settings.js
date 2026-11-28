/* Pomodoro settings, daily focus count and goal. Callers supply storage and time. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.PomodoroSettings = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SETTINGS_KEY = 'focus-timer.settings';
  var COUNT_KEY = 'focus-timer.daily-count';
  var GOAL_KEY = 'focus-timer.daily-goal';
  var GOAL_SHOWN_KEY = 'focus-timer.goal-shown';

  function normalizeMinutes(minutes) {
    if (!Number.isFinite(minutes)) return null;
    return Math.min(90, Math.max(1, Math.round(minutes)));
  }

  function normalizeSettings(settings) {
    var focusMinutes = normalizeMinutes(settings && settings.focusMinutes);
    var breakMinutes = normalizeMinutes(settings && settings.breakMinutes);
    if (focusMinutes === null || breakMinutes === null) {
      return { focusMinutes: 25, breakMinutes: 5 };
    }
    return { focusMinutes: focusMinutes, breakMinutes: breakMinutes };
  }

  function loadSettings(storage) {
    try {
      return normalizeSettings(JSON.parse(storage.getItem(SETTINGS_KEY)));
    } catch (e) {
      return normalizeSettings(null);
    }
  }

  function saveSettings(storage, settings) {
    try {
      storage.setItem(SETTINGS_KEY, JSON.stringify(normalizeSettings(settings)));
    } catch (e) { /* storage is optional */ }
  }

  function normalizeDailyGoal(goal) {
    return Number.isInteger(goal) && goal >= 1 && goal <= 24 ? goal : null;
  }

  function loadDailyGoal(storage) {
    try {
      return normalizeDailyGoal(JSON.parse(storage.getItem(GOAL_KEY)));
    } catch (e) {
      return null;
    }
  }

  function saveDailyGoal(storage, goal) {
    try {
      storage.setItem(GOAL_KEY, JSON.stringify(normalizeDailyGoal(goal)));
    } catch (e) { /* storage is optional */ }
  }

  function localDateKey(now) {
    var date = new Date(now);
    if (!Number.isFinite(date.getTime())) return null;
    return [date.getFullYear(), date.getMonth() + 1, date.getDate()].join('-');
  }

  function readCount(storage, date) {
    var entry;
    // Corrupt JSON is equivalent to a missing entry, including on the next write.
    var saved = storage.getItem(COUNT_KEY);
    try {
      entry = JSON.parse(saved);
    } catch (e) {
      return 0;
    }
    if (!entry || entry.date !== date || !Number.isSafeInteger(entry.count) || entry.count < 0) {
      return 0;
    }
    return entry.count;
  }

  function getTodayCount(storage, now) {
    try {
      var date = localDateKey(now);
      return date === null ? 0 : readCount(storage, date);
    } catch (e) {
      return 0;
    }
  }

  function recordFocusComplete(storage, now) {
    try {
      var date = localDateKey(now);
      if (date === null) return 0;
      var count = Math.min(Number.MAX_SAFE_INTEGER, readCount(storage, date) + 1);
      storage.setItem(COUNT_KEY, JSON.stringify({ date: date, count: count }));
      return count;
    } catch (e) {
      return 0;
    }
  }

  function hasShownGoalToday(storage, now) {
    try {
      var date = localDateKey(now);
      return date !== null && storage.getItem(GOAL_SHOWN_KEY) === date;
    } catch (e) {
      return false;
    }
  }

  function recordGoalShown(storage, now) {
    try {
      var date = localDateKey(now);
      if (date !== null) storage.setItem(GOAL_SHOWN_KEY, date);
    } catch (e) { /* storage is optional */ }
  }

  return {
    normalizeMinutes: normalizeMinutes,
    loadSettings: loadSettings,
    saveSettings: saveSettings,
    loadDailyGoal: loadDailyGoal,
    saveDailyGoal: saveDailyGoal,
    getTodayCount: getTodayCount,
    recordFocusComplete: recordFocusComplete,
    hasShownGoalToday: hasShownGoalToday,
    recordGoalShown: recordGoalShown
  };
});
