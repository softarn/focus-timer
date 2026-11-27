'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { loadSettings } = require('./settings.js');

const scripts = ['timer.js', 'settings.js', 'shortcuts.js', 'app.js'].map(file => fs.readFileSync(__dirname + '/' + file, 'utf8'));
const minute = 60000;

function memoryStorage() {
  const values = new Map();
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value)
  };
}

function openPage(startTime, getStorage) {
  let now = startTime;
  let interval;
  let nextId = 0;
  const timeouts = new Map();
  const elements = new Map();
  const document = new EventTarget();
  document.getElementById = id => {
    if (!elements.has(id)) {
      const element = new EventTarget();
      const attributes = new Map();
      Object.assign(element, {
        min: '1',
        max: '90',
        classList: { toggle() {} },
        setAttribute: (name, value) => attributes.set(name, value),
        getAttribute: name => attributes.get(name),
        removeAttribute: name => attributes.delete(name),
        focus: () => { document.activeElement = element; }
      });
      Object.defineProperty(element, 'valueAsNumber', {
        get: () => element.value === '' ? NaN : Number(element.value)
      });
      if (id === 'focus-minutes' || id === 'break-minutes') element.tagName = 'INPUT';
      if (id === 'settings') element.open = false;
      elements.set(id, element);
    }
    return elements.get(id);
  };

  const page = vm.createContext({
    document,
    Date: class extends Date { static now() { return now; } },
    window: { get localStorage() { return getStorage(); } },
    setInterval: callback => { interval = callback; return 1; },
    clearInterval: () => { interval = undefined; },
    setTimeout(callback, delay) {
      timeouts.set(++nextId, { callback, due: now + delay });
      return nextId;
    },
    clearTimeout: id => timeouts.delete(id)
  });
  for (const script of scripts) vm.runInContext(script, page);

  const get = document.getElementById;
  return {
    get,
    activeElement: () => document.activeElement,
    keydown(key) {
      const event = Object.assign(new Event('keydown', { cancelable: true }), { key });
      Object.defineProperty(event, 'target', { value: document.activeElement || document });
      document.dispatchEvent(event);
      return event.defaultPrevented;
    },
    submit(focus, rest) {
      get('focus-minutes').value = focus;
      get('break-minutes').value = rest;
      assert.equal(get('settings-form').dispatchEvent(new Event('submit', { cancelable: true })), false);
    },
    toggle(at = now) {
      now = at;
      get('toggle').dispatchEvent(new Event('click'));
    },
    tick(at) {
      now = at;
      interval();
    },
    runTimeouts(at) {
      now = at;
      for (const [id, { callback, due }] of timeouts) {
        if (due > now) continue;
        timeouts.delete(id);
        callback();
      }
    }
  };
}

test('only a valid settings pair changes the timer and survives reload', () => {
  const storage = memoryStorage();
  const now = new Date(2026, 10, 27, 12).getTime();
  const page = openPage(now, () => storage);
  page.submit('90', '1');
  assert.equal(page.get('countdown').textContent, '90:00');
  assert.equal(page.get('status').textContent, 'Durations updated.');
  page.runTimeouts(now + 3000);
  assert.equal(page.get('status').textContent, '');

  for (const invalid of ['', '0', '91', '1.5']) {
    page.submit(invalid, '60');
    assert.equal(page.get('focus-minutes').getAttribute('aria-invalid'), 'true');
    assert.match(page.get('focus-error').textContent, /whole number from 1 to 90/);
    assert.equal(page.activeElement(), page.get('focus-minutes'));
    assert.equal(page.get('countdown').textContent, '90:00');
    assert.deepEqual(loadSettings(storage), { focusMinutes: 90, breakMinutes: 1 });
  }

  page.submit('1', '91');
  assert.equal(page.get('focus-minutes').getAttribute('aria-invalid'), undefined);
  assert.equal(page.get('focus-error').textContent, '');
  assert.equal(page.get('break-minutes').getAttribute('aria-invalid'), 'true');
  assert.equal(page.activeElement(), page.get('break-minutes'));

  const reloaded = openPage(now, () => storage);
  assert.equal(reloaded.get('focus-minutes').value, 90);
  assert.equal(reloaded.get('break-minutes').value, 1);
  assert.equal(reloaded.get('countdown').textContent, '90:00');
});

test('a completion on pause counts once and the counter resets at midnight while idle', () => {
  const storage = memoryStorage();
  const start = new Date(2026, 10, 27, 23, 58).getTime();
  const page = openPage(start, () => storage);
  page.submit('1', '1');
  page.runTimeouts(start + 3000);
  page.toggle(start);
  page.tick(start + 1000);
  assert.equal(page.get('status').textContent, '');
  page.toggle(start + minute);
  assert.equal(page.get('daily-count').textContent, 'Today: 1 focus session');
  assert.match(page.get('status').textContent, /Focus complete/);
  assert.equal(openPage(start + minute, () => storage).get('daily-count').textContent, 'Today: 1 focus session');
  page.runTimeouts(start + 2 * minute);
  assert.equal(page.get('daily-count').textContent, 'Today: 0 focus sessions');
});

test('late ticks count focus completions on their local day', () => {
  const storage = memoryStorage();
  const midnight = new Date(2026, 10, 28).getTime();
  const start = midnight - 3 * minute;
  const page = openPage(start, () => storage);
  page.submit('1', '1');
  page.toggle();
  // Focus ends at 23:58 and 00:00. At 00:01 the timer is back in focus.
  page.tick(midnight + minute);
  assert.equal(page.get('daily-count').textContent, 'Today: 1 focus session');
  page.tick(midnight + 2 * minute);
  assert.equal(page.get('daily-count').textContent, 'Today: 2 focus sessions');
  page.tick(midnight + 3 * minute);
  assert.equal(page.get('daily-count').textContent, 'Today: 2 focus sessions');
});

test('durations and the counter work while storage access or writes are blocked', () => {
  function fail() { throw new Error('Storage unavailable'); }
  const start = new Date(2026, 10, 27, 12).getTime();

  for (const getStorage of [fail, () => ({ getItem: () => null, setItem: fail })]) {
    const page = openPage(start, getStorage);
    page.submit('1', '2');
    assert.equal(page.get('countdown').textContent, '01:00');
    page.toggle();
    page.tick(start + minute);
    assert.equal(page.get('countdown').textContent, '02:00');
    assert.equal(page.get('daily-count').textContent, 'Today: 1 focus session');
    page.tick(start + 4 * minute);
    assert.equal(page.get('daily-count').textContent, 'Today: 2 focus sessions');
  }
});

test('Space starts and pauses the timer and prevents the default action', () => {
  const start = new Date(2026, 10, 27, 12).getTime();
  const page = openPage(start, memoryStorage);

  assert.equal(page.keydown(' '), true);
  assert.equal(page.get('toggle').textContent, 'Pause');
  page.tick(start + 1000);
  assert.equal(page.keydown(' '), true);
  assert.equal(page.get('toggle').textContent, 'Start');
  assert.equal(page.get('countdown').textContent, '24:59');
});

test('R resets the timer and prevents the default action', () => {
  const start = new Date(2026, 10, 27, 12).getTime();
  const page = openPage(start, memoryStorage);
  page.toggle();
  page.tick(start + 1000);

  assert.equal(page.keydown('R'), true);
  assert.equal(page.get('toggle').textContent, 'Start');
  assert.equal(page.get('countdown').textContent, '25:00');
});

test('S opens Settings, focuses Focus minutes and prevents the default action', () => {
  const page = openPage(new Date(2026, 10, 27, 12).getTime(), memoryStorage);
  assert.equal(page.get('settings').open, false);

  assert.equal(page.keydown('S'), true);
  assert.equal(page.get('settings').open, true);
  assert.equal(page.activeElement(), page.get('focus-minutes'));
});

test('shortcut keys leave the timer and focus alone while typing in an input', () => {
  const start = new Date(2026, 10, 27, 12).getTime();
  const page = openPage(start, memoryStorage);
  page.toggle();
  page.tick(start + 1000);
  page.keydown('s');
  const input = page.get('break-minutes');
  input.focus();

  for (const key of [' ', 'r', 's', '?']) {
    assert.equal(page.keydown(key), false, key);
    assert.equal(page.get('toggle').textContent, 'Pause');
    assert.equal(page.get('countdown').textContent, '24:59');
    assert.equal(page.activeElement(), input);
  }
});
