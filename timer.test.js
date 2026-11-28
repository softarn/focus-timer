'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { createTimer, formatTime, formatTitle, countFocusCompletions, FOCUS_MS, BREAK_MS } = require('./timer.js');

test('initial state is idle focus with 25:00', () => {
  const s = createTimer().getState();
  assert.strictEqual(s.phase, 'focus');
  assert.strictEqual(s.running, false);
  assert.strictEqual(s.remainingMs, FOCUS_MS);
  assert.strictEqual(s.display, '25:00');
});

test('tick does nothing until started', () => {
  const t = createTimer();
  t.tick(5000);
  assert.strictEqual(t.getState().remainingMs, FOCUS_MS);
});

test('start counts down', () => {
  const t = createTimer();
  t.start(1000);
  t.tick(11000);
  const s = t.getState();
  assert.strictEqual(s.running, true);
  assert.strictEqual(s.remainingMs, FOCUS_MS - 10000);
  assert.strictEqual(s.display, '24:50');
});

test('pause stops countdown and no drift across pauses', () => {
  const t = createTimer();
  t.start(0);
  t.pause(10000);
  t.tick(500000); // ignored while paused
  assert.strictEqual(t.getState().remainingMs, FOCUS_MS - 10000);
  t.start(600000);
  t.pause(605000);
  assert.strictEqual(t.getState().remainingMs, FOCUS_MS - 15000);
  assert.strictEqual(t.getState().running, false);
});

test('reset returns to idle focus', () => {
  const t = createTimer();
  t.start(0);
  t.tick(FOCUS_MS + 1000); // now in break
  t.reset();
  const s = t.getState();
  assert.strictEqual(s.phase, 'focus');
  assert.strictEqual(s.running, false);
  assert.strictEqual(s.remainingMs, FOCUS_MS);
});

test('focus switches to break at zero, carrying overshoot, and back', () => {
  const t = createTimer();
  t.start(0);
  assert.strictEqual(t.tick(FOCUS_MS - 1), 0);
  assert.strictEqual(t.getState().phase, 'focus');
  assert.strictEqual(t.tick(FOCUS_MS + 2000), 1);
  let s = t.getState();
  assert.strictEqual(s.phase, 'break');
  assert.strictEqual(s.running, true);
  assert.strictEqual(s.remainingMs, BREAK_MS - 2000);
  assert.strictEqual(t.tick(FOCUS_MS + BREAK_MS), 1);
  s = t.getState();
  assert.strictEqual(s.phase, 'focus');
  assert.strictEqual(s.remainingMs, FOCUS_MS);
});

test('skipping a running break starts a full focus countdown from the skip time', () => {
  const t = createTimer({ focusMs: 1000, breakMs: 500 });
  t.start(0);
  assert.strictEqual(t.tick(1100), 1);
  assert.strictEqual(t.getState().phase, 'break');

  const skipTime = 1300;
  assert.strictEqual(t.skipBreak(skipTime), undefined);
  assert.strictEqual(t.getState().phase, 'focus');
  assert.strictEqual(t.getState().running, true);
  assert.strictEqual(t.getState().remainingMs, 1000);

  assert.strictEqual(t.tick(skipTime + 999), 0);
  assert.strictEqual(t.getState().phase, 'focus');
  assert.strictEqual(t.getState().remainingMs, 1);
  assert.strictEqual(t.tick(skipTime + 1000), 1);
  assert.strictEqual(t.getState().phase, 'break');
  assert.strictEqual(t.getState().remainingMs, 500);
});

test('skipping a paused break starts focus at the updated duration', () => {
  const t = createTimer({ focusMs: 1000, breakMs: 500 });
  t.start(0);
  t.pause(1100);
  assert.strictEqual(t.getState().phase, 'break');
  assert.strictEqual(t.getState().running, false);
  t.setDurations({ focusMs: 2000, breakMs: 750 });

  assert.strictEqual(t.skipBreak(5000), undefined);
  assert.strictEqual(t.getState().phase, 'focus');
  assert.strictEqual(t.getState().running, true);
  assert.strictEqual(t.getState().hasStarted, true);
  assert.strictEqual(t.getState().remainingMs, 2000);

  assert.strictEqual(t.tick(5250), 0);
  assert.strictEqual(t.getState().remainingMs, 1750);
});

test('skipping outside a break leaves idle, running, and paused focus unchanged', () => {
  const t = createTimer();
  const idle = t.getState();
  assert.strictEqual(t.skipBreak(100), undefined);
  assert.deepStrictEqual(t.getState(), idle);

  t.start(200);
  t.tick(500);
  const running = t.getState();
  assert.strictEqual(t.skipBreak(700), undefined);
  assert.deepStrictEqual(t.getState(), running);
  assert.strictEqual(t.tick(1000), 0);
  assert.strictEqual(t.getState().remainingMs, FOCUS_MS - 800);

  t.pause(1000);
  const paused = t.getState();
  assert.strictEqual(t.skipBreak(1500), undefined);
  assert.deepStrictEqual(t.getState(), paused);
});

test('a very late tick crosses several phases', () => {
  const t = createTimer({ focusMs: 1000, breakMs: 500 });
  t.start(0);
  // focus(1000) break(500) focus(1000) break(500) = 3000, then 200 into focus
  assert.strictEqual(t.tick(3200), 4);
  const s = t.getState();
  assert.strictEqual(s.phase, 'focus');
  assert.strictEqual(s.remainingMs, 800);
});

test('formatTime formats mm:ss', () => {
  assert.strictEqual(formatTime(FOCUS_MS), '25:00');
  assert.strictEqual(formatTime(BREAK_MS), '05:00');
  assert.strictEqual(formatTime(61000), '01:01');
  assert.strictEqual(formatTime(0), '00:00');
  assert.strictEqual(formatTime(-50), '00:00');
  assert.strictEqual(formatTime(59001), '01:00'); // rounds up partial seconds
  assert.strictEqual(formatTime(999), '00:01');
});

test('loads as a plain script without module/DOM', () => {
  const vm = require('node:vm');
  const fs = require('node:fs');
  const ctx = {};
  ctx.self = ctx;
  vm.runInNewContext(fs.readFileSync(__dirname + '/timer.js', 'utf8'), ctx);
  assert.strictEqual(typeof ctx.PomodoroTimer.createTimer, 'function');
});

test('changing durations updates an untouched focus phase on creation and after reset', () => {
  const t = createTimer();
  t.setDurations({ focusMs: 60000, breakMs: 120000 });
  assert.strictEqual(t.getState().display, '01:00');

  t.start(0);
  assert.strictEqual(t.tick(60000), 1);
  assert.strictEqual(t.getState().display, '02:00');
  t.reset();
  assert.strictEqual(t.getState().display, '01:00');

  t.setDurations({ focusMs: 5400000, breakMs: 60000 });
  assert.strictEqual(t.getState().display, '90:00');
});

test('changing durations preserves running focus and paused break time', () => {
  const t = createTimer({ focusMs: 120000, breakMs: 120000 });
  t.start(0);
  t.tick(30000);
  t.setDurations({ focusMs: 60000, breakMs: 60000 });
  assert.strictEqual(t.getState().remainingMs, 90000);

  assert.strictEqual(t.tick(120000), 1);
  t.pause(135000);
  assert.strictEqual(t.getState().phase, 'break');
  assert.strictEqual(t.getState().remainingMs, 45000);

  t.setDurations({ focusMs: 180000, breakMs: 240000 });
  assert.strictEqual(t.getState().remainingMs, 45000);
  t.start(200000);
  assert.strictEqual(t.tick(245000), 1);
  assert.strictEqual(t.getState().remainingMs, 180000);
  assert.strictEqual(t.tick(425000), 1);
  assert.strictEqual(t.getState().remainingMs, 240000);
  t.reset();
  assert.strictEqual(t.getState().remainingMs, 180000);
});

test('starting then immediately pausing still preserves the current duration', () => {
  const t = createTimer();
  t.start(0);
  t.pause(0);
  t.setDurations({ focusMs: 60000, breakMs: 60000 });
  assert.strictEqual(t.getState().remainingMs, FOCUS_MS);
});

test('hasStarted stays set through pause and duration changes until reset', () => {
  const t = createTimer();
  assert.strictEqual(t.getState().hasStarted, false);
  t.setDurations({ focusMs: 60000, breakMs: 120000 });
  assert.strictEqual(t.getState().hasStarted, false);
  t.pause(0);
  assert.strictEqual(t.getState().hasStarted, false);

  t.start(0);
  assert.strictEqual(t.getState().hasStarted, true);
  t.setDurations({ focusMs: 120000, breakMs: 60000 });
  assert.strictEqual(t.getState().hasStarted, true);
  t.pause(0);
  assert.strictEqual(t.getState().hasStarted, true);
  t.setDurations({ focusMs: 180000, breakMs: 120000 });
  assert.strictEqual(t.getState().hasStarted, true);

  t.reset();
  assert.strictEqual(t.getState().hasStarted, false);
  t.setDurations({ focusMs: 240000, breakMs: 180000 });
  assert.strictEqual(t.getState().hasStarted, false);
  t.start(1000);
  assert.strictEqual(t.getState().hasStarted, true);
});

test('formatTitle shows the rounded countdown and phase once started', () => {
  assert.strictEqual(formatTitle({ hasStarted: false, remainingMs: FOCUS_MS, phase: 'focus' }), 'Focus Timer');

  const state = { hasStarted: true, running: false };
  for (const [phase, remainingMs, title] of [
    ['focus', FOCUS_MS, '25:00 · Focus'],
    ['focus', 753001, '12:34 · Focus'],
    ['break', BREAK_MS - 1000, '4:59 · Break'],
    ['break', 59001, '1:00 · Break'],
    ['break', 1, '0:01 · Break'],
    ['break', 0, '0:00 · Break'],
    ['break', -50, '0:00 · Break']
  ]) {
    assert.strictEqual(formatTitle({ ...state, phase, remainingMs }), title);
  }
});

test('setting a nonpositive duration leaves the duration pair intact', () => {
  const t = createTimer();
  t.setDurations({ focusMs: 60000, breakMs: 0 });
  assert.strictEqual(t.getState().remainingMs, FOCUS_MS);
  t.start(0);
  assert.strictEqual(t.tick(FOCUS_MS), 1);
  assert.strictEqual(t.getState().remainingMs, BREAK_MS);
});

test('counts focus completions for no switches and odd or even switches from either phase', () => {
  assert.deepStrictEqual([0, 1, 2, 3, 4].map(n => countFocusCompletions('focus', n)), [0, 1, 1, 2, 2]);
  assert.deepStrictEqual([0, 1, 2, 3, 4].map(n => countFocusCompletions('break', n)), [0, 0, 1, 1, 2]);
});
