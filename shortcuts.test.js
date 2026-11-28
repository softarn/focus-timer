'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { actionFor } = require('./shortcuts.js');

test('maps Space, either case of R and S, and a shifted question mark', () => {
  assert.equal(actionFor({ key: ' ' }), 'toggle');
  assert.equal(actionFor({ key: 'r' }), 'reset');
  assert.equal(actionFor({ key: 'R', shiftKey: true }), 'reset');
  assert.equal(actionFor({ key: 's' }), 'settings');
  assert.equal(actionFor({ key: 'S', shiftKey: true }), 'settings');
  assert.equal(actionFor({ key: '?', shiftKey: true }), 'help');
  assert.equal(actionFor({ key: 'Enter' }), null);
});

test('ignores keys with Ctrl, Cmd or Alt held or on repeat', () => {
  for (const flag of ['ctrlKey', 'metaKey', 'altKey', 'repeat']) {
    for (const key of [' ', 'r', 's', '?']) {
      assert.equal(actionFor({ key, [flag]: true }), null, flag);
    }
  }
});

test('ignores shortcut keys in text entry elements', () => {
  const targets = [
    { tagName: 'INPUT' },
    { tagName: 'textarea' },
    { tagName: 'SELECT' },
    { tagName: 'SPAN', isContentEditable: true }
  ];
  for (const target of targets) {
    for (const key of [' ', 'r', 's', '?']) {
      assert.equal(actionFor({ key, target }), null, target.tagName);
    }
  }
});

test('reserves Space for native activation on buttons and summaries', () => {
  for (const tagName of ['BUTTON', 'SUMMARY']) {
    const target = { tagName };
    assert.equal(actionFor({ key: ' ', target }), null);
    assert.equal(actionFor({ key: 'r', target }), 'reset');
  }
  assert.equal(actionFor({ key: ' ', target: { tagName: 'MAIN', isContentEditable: false } }), 'toggle');
});
