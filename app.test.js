'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { loadSettings } = require('./settings.js');

const scripts = ['timer.js', 'settings.js', 'shortcuts.js', 'app.js'].map(file => fs.readFileSync(__dirname + '/' + file, 'utf8'));
const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
const initialTitle = html.match(/<title>([^<]*)<\/title>/)[1];
const skipBreakMarkup = html.match(/<button\b[^>]*\bid="skip-break"[^>]*>Skip break<\/button>/)?.[0];
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
  const notifications = [];
  let notesPlayed = 0;
  const document = new EventTarget();
  document.hidden = false;
  let title = initialTitle;
  const writtenTitles = [];
  Object.defineProperty(document, 'title', {
    get: () => title,
    set: value => {
      title = value;
      writtenTitles.push(value);
    }
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
      if (['toggle', 'reset', 'skip-break', 'shortcuts-trigger', 'shortcuts-close'].includes(id)) element.tagName = 'BUTTON';
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
    window: {
      get localStorage() { return getStorage(); },
      AudioContext: class {
        currentTime = 0;
        createOscillator() {
          return { frequency: {}, connect() {}, start() { notesPlayed++; }, stop() {} };
        }
        createGain() {
          return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} };
        }
      }
    },
    Notification: class {
      static permission = 'granted';
      constructor(title, { body }) { notifications.push(body); }
    },
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
    get titleWrites() { return writtenTitles.length; },
    get notesPlayed() { return notesPlayed; },
    notifications,
    writtenTitles,
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
    skipBreak(at = now) {
      now = at;
      get('skip-break').dispatchEvent(new Event('click'));
    },
    tick(at) {
      now = at;
      interval();
    },
    setHidden(hidden, at = now) {
      now = at;
      document.hidden = hidden;
      document.dispatchEvent(new Event('visibilitychange'));
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

function assertTitle(page, expected) {
  assert.equal(page.title, expected);
  for (const title of page.writtenTitles) {
    assert.match(title, /^(?:Focus Timer|(?:0|[1-9]\d*):[0-5]\d · (?:Focus|Break))$/);
  }
}

test('the tab title is Focus Timer before scripts run, on load and after saving idle durations', () => {
  const page = openPage(new Date(2026, 10, 27, 12).getTime(), memoryStorage);
  assert.equal(initialTitle, 'Focus Timer');
  assertTitle(page, 'Focus Timer');
  assert.equal(page.titleWrites, 0);

  page.submit('7', '3');
  assert.equal(page.get('countdown').textContent, '07:00');
  assertTitle(page, 'Focus Timer');
  assert.equal(page.titleWrites, 0);
});

test('the tab title shows the final focus second and switches to Break at the deadline', () => {
  const start = new Date(2026, 10, 27, 12).getTime();
  const page = openPage(start, memoryStorage);
  page.toggle();
  assertTitle(page, '25:00 · Focus');
  const writesAfterStart = page.titleWrites;
  page.tick(start + 250);
  assert.equal(page.titleWrites, writesAfterStart);
  page.tick(start + 1000);
  assertTitle(page, '24:59 · Focus');

  const breakStart = start + 25 * minute;
  page.tick(breakStart - 1000);
  assertTitle(page, '0:01 · Focus');
  page.tick(breakStart - 1);
  assertTitle(page, '0:01 · Focus');
  page.tick(breakStart);
  assertTitle(page, '5:00 · Break');
  assert.equal(page.get('countdown').textContent, '05:00');
  page.tick(breakStart + 1000);
  assertTitle(page, '4:59 · Break');
  assert.equal(page.get('countdown').textContent, '04:59');
});

test('the tab title stays on Focus when paused before the first tick', () => {
  const start = new Date(2026, 10, 27, 12).getTime();
  const page = openPage(start, memoryStorage);
  page.toggle();
  assertTitle(page, '25:00 · Focus');
  page.toggle();
  assert.equal(page.get('toggle').textContent, 'Start');
  assertTitle(page, '25:00 · Focus');
});

test('resetting during a running break restores the default tab title', () => {
  const start = new Date(2026, 10, 27, 12).getTime();
  const page = openPage(start, memoryStorage);
  page.toggle();
  page.tick(start + 25 * minute + 1000);
  assert.equal(page.get('toggle').textContent, 'Pause');
  assertTitle(page, '4:59 · Break');

  page.get('reset').dispatchEvent(new Event('click'));
  assertTitle(page, 'Focus Timer');
});

test('Skip break is hidden before scripts run and only appears during a break', () => {
  const start = new Date(2026, 10, 27, 12).getTime();
  const page = openPage(start, memoryStorage);
  const skipBreak = page.get('skip-break');
  assert.match(skipBreakMarkup, /\shidden>/);
  assert.equal(skipBreak.hidden, true);

  page.toggle();
  assert.equal(skipBreak.hidden, true);
  page.tick(start + 25 * minute);
  assert.equal(skipBreak.hidden, false);
  page.toggle();
  assert.equal(page.get('toggle').textContent, 'Start');
  assert.equal(skipBreak.hidden, false);

  page.get('reset').dispatchEvent(new Event('click'));
  assert.equal(skipBreak.hidden, true);
});

for (const paused of [false, true]) {
  test(`skipping a ${paused ? 'paused' : 'running'} break starts a full focus session without alerts`, () => {
    const start = new Date(2026, 10, 27, 12).getTime();
    const page = openPage(start, memoryStorage);
    const skipBreak = page.get('skip-break');
    const breakStart = start + 7 * minute;
    page.submit('7', '3');
    page.toggle();
    page.tick(breakStart);
    if (paused) page.toggle();
    skipBreak.focus();
    assert.equal(page.keydown(' '), false);
    assert.equal(page.get('daily-count').textContent, 'Today: 1 focus session');

    const clickTime = breakStart + 10000;
    page.skipBreak(clickTime);
    assert.equal(skipBreak.hidden, true);
    assert.equal(page.get('phase').textContent, 'Focus');
    assert.equal(page.get('countdown').textContent, '07:00');
    assert.equal(page.get('toggle').textContent, 'Pause');
    assertTitle(page, '7:00 · Focus');
    assert.equal(page.get('daily-count').textContent, 'Today: 1 focus session');
    assert.equal(page.get('status').textContent, 'Break skipped. Time to focus.');
    assert.equal(page.activeElement(), page.get('toggle'));
    assert.equal(page.notesPlayed, 2);
    assert.deepEqual(page.notifications, ['Focus complete. Time for a break.']);

    page.tick(clickTime + 1000);
    assert.equal(page.get('countdown').textContent, '06:59');
  });
}

test('clicking Skip break after the break expires handles the normal transition', () => {
  const start = new Date(2026, 10, 27, 12).getTime();
  const page = openPage(start, memoryStorage);
  page.submit('1', '1');
  page.toggle();
  page.tick(start + minute);
  assert.equal(page.get('skip-break').hidden, false);

  // The button is still on screen because the interval has not fired again.
  page.skipBreak(start + 2 * minute + 1000);
  assert.equal(page.get('skip-break').hidden, true);
  assertTitle(page, '0:59 · Focus');
  assert.equal(page.get('status').textContent, 'Break over. Time to focus.');
  assert.equal(page.get('daily-count').textContent, 'Today: 1 focus session');
  assert.equal(page.notesPlayed, 4);
  assert.deepEqual(page.notifications, ['Focus complete. Time for a break.', 'Break over. Time to focus.']);
  assert.equal(page.activeElement(), page.get('toggle'));
});

test('a late Skip break press keeps the running focus session and later presses change nothing', () => {
  const start = new Date(2026, 10, 27, 12).getTime();
  const page = openPage(start, memoryStorage);
  page.submit('1', '1');
  page.toggle();
  page.tick(start + minute);
  assert.equal(page.get('daily-count').textContent, 'Today: 1 focus session');

  // The break ended at start + 2 min; the interval has not fired since.
  page.skipBreak(start + 2 * minute + 1000);
  assert.equal(page.get('phase').textContent, 'Focus');
  assert.equal(page.get('countdown').textContent, '00:59');
  assert.equal(page.get('daily-count').textContent, 'Today: 1 focus session');

  // A second press (for example a double click) must not restart focus.
  page.skipBreak(start + 2 * minute + 2000);
  assert.equal(page.get('skip-break').hidden, true);
  assert.equal(page.get('countdown').textContent, '00:58');
  assert.equal(page.get('status').textContent, 'Break over. Time to focus.');
  assert.equal(page.get('daily-count').textContent, 'Today: 1 focus session');
  assert.equal(page.notifications.length, 2);

  page.tick(start + 3 * minute);
  assert.equal(page.get('phase').textContent, 'Break');
  assert.equal(page.get('daily-count').textContent, 'Today: 2 focus sessions');
  page.tick(start + 3 * minute + 250);
  assert.equal(page.get('daily-count').textContent, 'Today: 2 focus sessions');
  assert.equal(page.notifications.length, 3);
});

test('a press long after the break counts the unattended focus session once', () => {
  const start = new Date(2026, 10, 27, 12).getTime();
  const page = openPage(start, memoryStorage);
  page.submit('1', '1');
  page.toggle();
  page.tick(start + minute);

  // Break ended at +2 min, the next focus at +3 min; now 30 s into a new break.
  const pressTime = start + 3 * minute + 30000;
  page.skipBreak(pressTime);
  assert.equal(page.get('daily-count').textContent, 'Today: 2 focus sessions');
  assert.equal(page.get('phase').textContent, 'Focus');
  assert.equal(page.get('countdown').textContent, '01:00');
  assert.equal(page.get('status').textContent, 'Break skipped. Time to focus.');

  page.tick(pressTime + minute - 1);
  assert.equal(page.get('daily-count').textContent, 'Today: 2 focus sessions');
  page.tick(pressTime + minute);
  assert.equal(page.get('daily-count').textContent, 'Today: 3 focus sessions');
});

test('Skip break at the exact break deadline is the normal transition, one ms earlier is a skip', () => {
  const start = new Date(2026, 10, 27, 12).getTime();
  const breakEnd = start + 2 * minute;
  for (const [pressTime, status, alerts] of [
    [breakEnd, 'Break over. Time to focus.', 2],
    [breakEnd - 1, 'Break skipped. Time to focus.', 1]
  ]) {
    const page = openPage(start, memoryStorage);
    page.submit('1', '1');
    page.toggle();
    page.tick(start + minute);

    page.skipBreak(pressTime);
    assert.equal(page.get('phase').textContent, 'Focus');
    assert.equal(page.get('countdown').textContent, '01:00');
    assertTitle(page, '1:00 · Focus');
    assert.equal(page.get('status').textContent, status);
    assert.equal(page.notifications.length, alerts);
    assert.equal(page.get('daily-count').textContent, 'Today: 1 focus session');

    page.tick(pressTime + minute - 1);
    assert.equal(page.get('phase').textContent, 'Focus');
    assert.equal(page.get('daily-count').textContent, 'Today: 1 focus session');
    page.tick(pressTime + minute);
    assert.equal(page.get('phase').textContent, 'Break');
    assert.equal(page.get('daily-count').textContent, 'Today: 2 focus sessions');
  }
});

test('skipping a break that stayed paused past its deadline starts a full focus session', () => {
  const start = new Date(2026, 10, 27, 12).getTime();
  const page = openPage(start, memoryStorage);
  page.submit('1', '1');
  page.toggle();
  page.tick(start + minute);
  page.toggle(start + minute + 20000);
  assert.equal(page.get('countdown').textContent, '00:40');

  // Far more wall-clock time than the break and a whole cycle have passed.
  const pressTime = start + 15 * minute;
  page.skipBreak(pressTime);
  assert.equal(page.get('phase').textContent, 'Focus');
  assert.equal(page.get('countdown').textContent, '01:00');
  assert.equal(page.get('toggle').textContent, 'Pause');
  assert.equal(page.get('status').textContent, 'Break skipped. Time to focus.');
  assert.equal(page.get('daily-count').textContent, 'Today: 1 focus session');
  assert.deepEqual(page.notifications, ['Focus complete. Time for a break.']);

  page.tick(pressTime + minute);
  assert.equal(page.get('daily-count').textContent, 'Today: 2 focus sessions');
  assertTitle(page, '1:00 · Break');
});

for (const paused of [false, true]) {
  test(`Reset after skipping a ${paused ? 'paused' : 'running'} break hides the button and restores the title`, () => {
    const start = new Date(2026, 10, 27, 12).getTime();
    const page = openPage(start, memoryStorage);
    const skipBreak = page.get('skip-break');
    page.submit('1', '1');
    page.toggle();
    page.tick(start + minute);
    if (paused) page.toggle(start + minute + 5000);
    page.skipBreak(start + minute + 10000);
    page.tick(start + minute + 20000);
    assertTitle(page, '0:50 · Focus');

    page.get('reset').dispatchEvent(new Event('click'));
    assert.equal(skipBreak.hidden, true);
    assertTitle(page, 'Focus Timer');
    assert.equal(page.get('phase').textContent, 'Focus');
    assert.equal(page.get('countdown').textContent, '01:00');
    assert.equal(page.get('toggle').textContent, 'Start');
    assert.equal(page.get('status').textContent, '');
    assert.equal(page.get('daily-count').textContent, 'Today: 1 focus session');

    // A stray press after Reset does nothing, and a new session starts cleanly.
    page.skipBreak(start + 5 * minute);
    assert.equal(page.get('toggle').textContent, 'Start');
    assertTitle(page, 'Focus Timer');
    page.toggle(start + 10 * minute);
    page.tick(start + 11 * minute);
    assert.equal(page.get('daily-count').textContent, 'Today: 2 focus sessions');
    assert.equal(skipBreak.hidden, false);
  });
}

for (const paused of [false, true]) {
  test(`durations saved during a ${paused ? 'paused' : 'running'} break apply to the skipped-into focus session`, () => {
    const start = new Date(2026, 10, 27, 12).getTime();
    const page = openPage(start, memoryStorage);
    page.submit('1', '1');
    page.toggle();
    page.tick(start + minute);
    if (paused) page.toggle(start + minute + 5000);
    page.submit('3', '2');
    // The current break keeps its remaining time until skipped.
    assert.equal(page.get('phase').textContent, 'Break');
    assert.equal(page.get('countdown').textContent, paused ? '00:55' : '01:00');

    const skipTime = start + minute + 10000;
    page.skipBreak(skipTime);
    assert.equal(page.get('countdown').textContent, '03:00');
    assertTitle(page, '3:00 · Focus');
    assert.equal(page.get('daily-count').textContent, 'Today: 1 focus session');

    page.tick(skipTime + 3 * minute - 1);
    assertTitle(page, '0:01 · Focus');
    assert.equal(page.get('daily-count').textContent, 'Today: 1 focus session');
    page.tick(skipTime + 3 * minute);
    assertTitle(page, '2:00 · Break');
    assert.equal(page.get('daily-count').textContent, 'Today: 2 focus sessions');

    // A late tick across two more 3 + 2 minute cycles counts each focus once.
    page.tick(skipTime + 13 * minute + 10000);
    assertTitle(page, '1:50 · Break');
    assert.equal(page.get('daily-count').textContent, 'Today: 4 focus sessions');
  });
}

test('a focus session skipped into before midnight counts on the day it completes', () => {
  const midnight = new Date(2026, 10, 28).getTime();
  const countEntry = storage => JSON.parse(storage.getItem('focus-timer.daily-count'));

  for (const [skipTime, completedBeforeMidnight] of [[midnight - 70000, true], [midnight - 10000, false]]) {
    const storage = memoryStorage();
    // The first focus session ends 10 seconds before the skip.
    const breakStart = skipTime - 10000;
    const page = openPage(breakStart - minute, () => storage);
    page.submit('1', '1');
    page.toggle();
    page.tick(breakStart);
    assert.equal(page.get('phase').textContent, 'Break');
    assert.deepEqual(countEntry(storage), { date: '2026-11-27', count: 1 });
    assert.equal(page.get('daily-count').textContent, 'Today: 1 focus session');

    page.skipBreak(skipTime);
    assert.equal(page.get('daily-count').textContent, 'Today: 1 focus session');
    assert.deepEqual(countEntry(storage), { date: '2026-11-27', count: 1 });

    if (completedBeforeMidnight) {
      page.tick(skipTime + minute);
      assert.equal(page.get('daily-count').textContent, 'Today: 2 focus sessions');
      assert.deepEqual(countEntry(storage), { date: '2026-11-27', count: 2 });
      page.runTimeouts(midnight);
      assert.equal(page.get('daily-count').textContent, 'Today: 0 focus sessions');
    } else {
      page.runTimeouts(midnight);
      assert.equal(page.get('daily-count').textContent, 'Today: 0 focus sessions');
      page.tick(skipTime + minute - 1);
      assert.equal(page.get('daily-count').textContent, 'Today: 0 focus sessions');
      page.tick(skipTime + minute);
      assert.equal(page.get('daily-count').textContent, 'Today: 1 focus session');
      assert.deepEqual(countEntry(storage), { date: '2026-11-28', count: 1 });
    }
  }
});

test('a late tick spanning midnight after a skip counts only the sessions that ended after midnight', () => {
  const midnight = new Date(2026, 10, 28).getTime();
  // Skipped focus ends at 23:59:50 (first case) or 00:00:50 (second case).
  for (const [skipTime, tickTime, title, todayCount] of [
    [midnight - 70000, midnight + 165000, '0:05 · Break', 1],
    [midnight - 10000, midnight + 175000, '0:55 · Break', 2]
  ]) {
    const storage = memoryStorage();
    // The first focus session ends 10 seconds before the skip.
    const breakStart = skipTime - 10000;
    const page = openPage(breakStart - minute, () => storage);
    page.submit('1', '1');
    page.toggle();
    page.tick(breakStart);
    assert.equal(page.get('phase').textContent, 'Break');
    page.skipBreak(skipTime);
    assertTitle(page, '1:00 · Focus');

    page.tick(tickTime);
    assertTitle(page, title);
    const text = 'Today: ' + todayCount + ' focus session' + (todayCount === 1 ? '' : 's');
    assert.equal(page.get('daily-count').textContent, text);
    assert.deepEqual(JSON.parse(storage.getItem('focus-timer.daily-count')), { date: '2026-11-28', count: todayCount });
  }
});

test('the tab title survives saving durations while paused and returns to default on reset', () => {
  const start = new Date(2026, 10, 27, 12).getTime();
  const page = openPage(start, memoryStorage);
  page.toggle();
  page.tick(start + 25 * minute + 1000);
  assertTitle(page, '4:59 · Break');

  const writesBeforePause = page.titleWrites;
  page.toggle();
  assert.equal(page.get('toggle').textContent, 'Start');
  assertTitle(page, '4:59 · Break');
  assert.equal(page.titleWrites, writesBeforePause);
  page.submit('8', '3');
  assertTitle(page, '4:59 · Break');
  assert.equal(page.titleWrites, writesBeforePause);

  page.get('reset').dispatchEvent(new Event('click'));
  assertTitle(page, 'Focus Timer');
  assert.equal(page.get('countdown').textContent, '08:00');

  page.submit('90', '1');
  assertTitle(page, 'Focus Timer');
  assert.equal(page.get('countdown').textContent, '90:00');
  page.toggle();
  assertTitle(page, '90:00 · Focus');
});

test('valid and invalid duration edits preserve the title of a paused focus session', () => {
  const start = new Date(2026, 10, 27, 12).getTime();
  const page = openPage(start, memoryStorage);
  page.toggle();
  page.toggle(start + 12 * minute + 26000);
  assertTitle(page, '12:34 · Focus');
  const writesBeforeEdits = page.titleWrites;

  page.submit('0', '3');
  assertTitle(page, '12:34 · Focus');
  page.submit('7', '3');
  assertTitle(page, '12:34 · Focus');
  assert.equal(page.titleWrites, writesBeforeEdits);
});

test('a late refresh shows the phase and remaining time after several phase changes', () => {
  const start = new Date(2026, 10, 27, 12).getTime();
  const page = openPage(start, memoryStorage);
  page.submit('2', '1');
  page.toggle();
  assertTitle(page, '2:00 · Focus');

  // Three full cycles, then 17 seconds into focus (six phase changes).
  page.tick(start + 9 * minute + 17000);
  assertTitle(page, '1:43 · Focus');
  // Three more phase changes land 11 seconds into a break.
  page.tick(start + 14 * minute + 11000);
  assertTitle(page, '0:49 · Break');
});

test('the tab title matches the countdown on the next refresh after the page becomes visible', () => {
  const start = new Date(2026, 10, 27, 12).getTime();
  const page = openPage(start, memoryStorage);
  page.submit('1', '1');
  page.toggle();
  assertTitle(page, '1:00 · Focus');

  page.setHidden(true, start + 1000);
  page.tick(start + 15000);
  assertTitle(page, '0:45 · Focus');
  assert.equal(page.get('countdown').textContent, '00:45');

  // No interval callbacks while the focus session expires in the background.
  page.setHidden(false, start + 65000);
  page.tick(start + 65250);
  assertTitle(page, '0:55 · Break');
  assert.equal(page.get('countdown').textContent, '00:55');
  assert.equal(page.get('phase').textContent, 'Break');
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
  assertTitle(page, '25:00 · Focus');
  page.tick(start + 1000);
  assertTitle(page, '24:59 · Focus');
  assert.equal(page.keydown(' '), true);
  assert.equal(page.get('toggle').textContent, 'Start');
  assert.equal(page.get('countdown').textContent, '24:59');
  assertTitle(page, '24:59 · Focus');
});

test('R resets the timer and prevents the default action', () => {
  const start = new Date(2026, 10, 27, 12).getTime();
  const page = openPage(start, memoryStorage);
  page.toggle();
  page.tick(start + 1000);
  assertTitle(page, '24:59 · Focus');

  assert.equal(page.keydown('R'), true);
  assert.equal(page.get('toggle').textContent, 'Start');
  assert.equal(page.get('countdown').textContent, '25:00');
  assertTitle(page, 'Focus Timer');
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
