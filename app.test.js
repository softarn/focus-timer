'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { loadSettings } = require('./settings.js');

const scripts = ['timer.js', 'settings.js', 'shortcuts.js', 'app.js'].map(file => fs.readFileSync(__dirname + '/' + file, 'utf8'));
const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
const initialTitle = html.match(/<title>([^<]*)<\/title>/)[1];
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
  let title = initialTitle;
  let titleWrites = 0;
  Object.defineProperty(document, 'title', {
    get: () => title,
    set: value => { title = value; titleWrites++; }
  });
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
      if (['toggle', 'reset', 'shortcuts-trigger', 'shortcuts-close'].includes(id)) element.tagName = 'BUTTON';
      if (id === 'settings') element.open = false;
      if (id === 'shortcuts-dialog') {
        element.tagName = 'DIALOG';
        element.open = false;
        element.showModal = () => { element.open = true; };
        element.close = () => {
          if (!element.open) return;
          element.open = false;
          element.dispatchEvent(new Event('close'));
        };
      }
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
    get title() { return document.title; },
    get titleWrites() { return titleWrites; },
    activeElement: () => document.activeElement,
    keydown(key) {
      const event = Object.assign(new Event('keydown', { cancelable: true }), { key });
      Object.defineProperty(event, 'target', { value: document.activeElement || document });
      document.dispatchEvent(event);
      if (key === 'Escape' && !event.defaultPrevented) {
        // Simulate the browser's default Escape action for a modal dialog.
        get('shortcuts-dialog').close();
      }
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

test('the tab title is Focus Timer before scripts run, on load and after saving idle durations', () => {
  const page = openPage(new Date(2026, 10, 27, 12).getTime(), memoryStorage);
  assert.equal(initialTitle, 'Focus Timer');
  assert.equal(page.title, 'Focus Timer');
  assert.equal(page.titleWrites, 0);

  page.submit('7', '3');
  assert.equal(page.get('countdown').textContent, '07:00');
  assert.equal(page.title, 'Focus Timer');
  assert.equal(page.titleWrites, 0);
});

test('the tab title follows the countdown through focus, break, pause and button reset', () => {
  const start = new Date(2026, 10, 27, 12).getTime();
  const page = openPage(start, memoryStorage);
  page.toggle();
  assert.equal(page.title, '25:00 · Focus');
  const writesAfterStart = page.titleWrites;
  page.tick(start + 250);
  assert.equal(page.titleWrites, writesAfterStart);
  page.tick(start + 1000);
  assert.equal(page.title, '24:59 · Focus');

  const breakStart = start + 25 * minute;
  page.tick(breakStart);
  assert.equal(page.title, '5:00 · Break');
  assert.equal(page.get('countdown').textContent, '05:00');
  page.tick(breakStart + 1000);
  assert.equal(page.title, '4:59 · Break');
  assert.equal(page.get('countdown').textContent, '04:59');

  const writesBeforePause = page.titleWrites;
  page.toggle();
  assert.equal(page.get('toggle').textContent, 'Start');
  assert.equal(page.title, '4:59 · Break');
  assert.equal(page.titleWrites, writesBeforePause);
  page.submit('8', '3');
  assert.equal(page.title, '4:59 · Break');
  assert.equal(page.titleWrites, writesBeforePause);

  page.get('reset').dispatchEvent(new Event('click'));
  assert.equal(page.title, 'Focus Timer');
  assert.equal(page.get('countdown').textContent, '08:00');
});

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
  assert.equal(page.title, '24:59 · Focus');

  assert.equal(page.keydown('R'), true);
  assert.equal(page.get('toggle').textContent, 'Start');
  assert.equal(page.get('countdown').textContent, '25:00');
  assert.equal(page.title, 'Focus Timer');
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

test('? opens shortcut help, suppresses app shortcuts and lets Escape restore focus', () => {
  const start = new Date(2026, 10, 27, 12).getTime();
  const page = openPage(start, memoryStorage);
  const dialog = page.get('shortcuts-dialog');
  const reset = page.get('reset');
  reset.focus();
  page.toggle();
  page.tick(start + 1000);

  assert.equal(page.keydown('?'), true);
  assert.equal(dialog.open, true);
  assert.equal(page.activeElement(), page.get('shortcuts-close'));
  assert.equal(page.keydown(' '), false);

  dialog.focus();
  for (const key of [' ', 'R', 'S', '?']) {
    assert.equal(page.keydown(key), false, key);
    assert.equal(page.get('toggle').textContent, 'Pause');
    assert.equal(page.get('countdown').textContent, '24:59');
    assert.equal(page.get('settings').open, false);
    assert.equal(page.activeElement(), dialog);
  }

  assert.equal(page.keydown('Escape'), false);
  assert.equal(dialog.open, false);
  assert.equal(page.activeElement(), reset);
  assert.equal(page.keydown('R'), true);
  assert.equal(page.get('countdown').textContent, '25:00');
});

test('the Keyboard shortcuts button opens help and Close returns focus to the button', () => {
  const page = openPage(new Date(2026, 10, 27, 12).getTime(), memoryStorage);
  const trigger = page.get('shortcuts-trigger');
  const dialog = page.get('shortcuts-dialog');
  const close = page.get('shortcuts-close');
  trigger.focus();
  trigger.dispatchEvent(new Event('click'));

  assert.equal(dialog.open, true);
  assert.equal(page.activeElement(), close);

  close.dispatchEvent(new Event('click'));
  assert.equal(dialog.open, false);
  assert.equal(page.activeElement(), trigger);
});
