'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { createTimer, formatTime, FOCUS_MS, BREAK_MS } = require('./timer.js');

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
