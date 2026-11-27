'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { createTimer, countFocusCompletions } = require('./timer.js');
const { normalizeMinutes, loadSettings, saveSettings, getTodayCount, recordFocusComplete } = require('./settings.js');

const defaults = { focusMinutes: 25, breakMinutes: 5 };

function memoryStorage() {
  const values = new Map();
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value)
  };
}

test('minutes clamp to 1–90, round to whole numbers and reject non-numeric input', () => {
  assert.deepStrictEqual([0, 1, 90, 91, 4.49, 4.5].map(normalizeMinutes), [1, 1, 90, 90, 4, 5]);
  for (const value of ['abc', '15', '', null, undefined, true, NaN, Infinity]) {
    assert.strictEqual(normalizeMinutes(value), null);
  }
});

test('settings start at defaults and save whole minutes within the limits', () => {
  const storage = memoryStorage();
  assert.deepStrictEqual(loadSettings(storage), defaults);

  let stored;
  const capturingStorage = {
    getItem: storage.getItem,
    setItem(key, value) {
      stored = JSON.parse(value);
      storage.setItem(key, value);
    }
  };
  saveSettings(capturingStorage, { focusMinutes: 91, breakMinutes: 4.5 });
  assert.deepStrictEqual(stored, { focusMinutes: 90, breakMinutes: 5 });
  assert.deepStrictEqual(loadSettings(storage), stored);

  saveSettings(storage, { focusMinutes: 10, breakMinutes: 'bad' });
  assert.deepStrictEqual(loadSettings(storage), defaults);
});

test('saved numeric minutes are normalized and corrupt settings return both defaults', () => {
  const storage = { getItem: () => '{"focusMinutes":0,"breakMinutes":8.7}' };
  assert.deepStrictEqual(loadSettings(storage), { focusMinutes: 1, breakMinutes: 9 });
  for (const saved of ['{', 'null', '[]', '{"focusMinutes":15}', '{"focusMinutes":"15","breakMinutes":2}']) {
    assert.deepStrictEqual(loadSettings({ getItem: () => saved }), defaults);
  }
});

test('missing storage and read or write exceptions are handled', () => {
  const now = new Date(2026, 10, 27);
  function fail() { throw new Error('Storage unavailable'); }

  for (const storage of [undefined, { getItem: fail, setItem: fail }]) {
    assert.deepStrictEqual(loadSettings(storage), defaults);
    assert.doesNotThrow(() => saveSettings(storage, defaults));
    assert.strictEqual(getTodayCount(storage, now), 0);
    assert.strictEqual(recordFocusComplete(storage, now), 0);
  }

  const readOnlyStorage = { getItem: () => null, setItem: fail };
  assert.doesNotThrow(() => saveSettings(readOnlyStorage, defaults));
  assert.strictEqual(recordFocusComplete(readOnlyStorage, now), 0);
});

test('the daily count rolls over at local midnight', () => {
  const storage = memoryStorage();
  const morning = new Date(2026, 11, 31, 0, 1);
  const beforeMidnight = new Date(2026, 11, 31, 23, 59);
  const afterMidnight = new Date(2027, 0, 1, 0, 1);

  assert.strictEqual(getTodayCount(storage, morning), 0);
  assert.strictEqual(recordFocusComplete(storage, morning), 1);
  assert.strictEqual(getTodayCount(storage, beforeMidnight), 1);
  assert.strictEqual(recordFocusComplete(storage, beforeMidnight), 2);
  assert.strictEqual(getTodayCount(storage, afterMidnight), 0);
  assert.strictEqual(recordFocusComplete(storage, afterMidnight), 1);
  assert.strictEqual(getTodayCount(storage, afterMidnight), 1);
});

test('corrupt daily counts read as zero and a completion replaces them', () => {
  const now = new Date(2026, 10, 27);
  let saved;
  const storage = {
    getItem: () => saved,
    setItem: (key, value) => { saved = value; }
  };

  assert.strictEqual(recordFocusComplete(storage, now), 1);
  const { date } = JSON.parse(saved);
  for (const corrupt of ['{', JSON.stringify({ date, count: -1 }), JSON.stringify({ date, count: '2' })]) {
    saved = corrupt;
    assert.strictEqual(getTodayCount(storage, now), 0);
    assert.strictEqual(recordFocusComplete(storage, now), 1);
    assert.strictEqual(getTodayCount(storage, now), 1);
  }
});

test('the daily count records only focus completions across late ticks', () => {
  const storage = memoryStorage();
  const timer = createTimer({ focusMs: 60000, breakMs: 60000 });
  const start = new Date(2026, 10, 27, 12).getTime();
  timer.start(start);

  function tickAndRecord(now) {
    const phase = timer.getState().phase;
    const completions = countFocusCompletions(phase, timer.tick(now));
    for (let i = 0; i < completions; i++) recordFocusComplete(storage, now);
    return getTodayCount(storage, now);
  }

  assert.strictEqual(tickAndRecord(start + 60000), 1);
  assert.strictEqual(tickAndRecord(start + 120000), 1);
  assert.strictEqual(tickAndRecord(start + 420000), 4);
  assert.strictEqual(tickAndRecord(start + 600000), 5);
});

test('loads as a plain script without module/DOM', () => {
  const vm = require('node:vm');
  const fs = require('node:fs');
  const ctx = {};
  ctx.self = ctx;
  vm.runInNewContext(fs.readFileSync(__dirname + '/settings.js', 'utf8'), ctx);
  assert.strictEqual(ctx.PomodoroSettings.normalizeMinutes(91), 90);
  assert.strictEqual(ctx.PomodoroSettings.loadSettings().focusMinutes, 25);
});
