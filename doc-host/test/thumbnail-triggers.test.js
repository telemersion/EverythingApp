'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createThumbnailTriggers } = require('../src/thumbnail-triggers');

// Triggers on the mocked setTimeout; captures records [docId, reason].
function make(t, options = {}) {
  t.mock.timers.reset();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const captures = [];
  const triggers = createThumbnailTriggers({
    capture: (docId, reason) => captures.push([docId, reason]),
    ...options,
  });
  return { triggers, captures };
}

test('a change while visible captures after 2 s of quiet', (t) => {
  const { triggers, captures } = make(t);
  triggers.changed('d1', true);
  t.mock.timers.tick(1500);
  triggers.changed('d1', true);
  t.mock.timers.tick(1999);
  assert.deepEqual(captures, []);
  t.mock.timers.tick(1);
  assert.deepEqual(captures, [['d1', 'changed']]);
  t.mock.timers.tick(5000);
  assert.equal(captures.length, 1);
});

test('a change while hidden captures nothing', (t) => {
  const { triggers, captures } = make(t);
  triggers.changed('d1', false);
  t.mock.timers.tick(5000);
  assert.deepEqual(captures, []);
});

test('hiding, saving and reloading capture at once and cancel a pending change capture', (t) => {
  for (const [trigger, reason] of [['hidden', 'hidden'], ['saved', 'saved'], ['reloaded', 'reloaded']]) {
    const { triggers, captures } = make(t);
    triggers.changed('d1', true);
    t.mock.timers.tick(500);
    triggers[trigger]('d1');
    assert.deepEqual(captures, [['d1', reason]], trigger);
    t.mock.timers.tick(2000);
    assert.equal(captures.length, 1, `${trigger}: still exactly one capture`);
    t.mock.timers.reset();
  }
});

test('a hidden first load is captured only when captureHidden', (t) => {
  const on = make(t, { captureHidden: true });
  on.triggers.loaded('d1', false);
  assert.deepEqual(on.captures, [['d1', 'load']]);
  on.triggers.loaded('d2', true);
  assert.deepEqual(on.captures, [['d1', 'load'], ['d2', 'load']]);
  const off = make(t, { captureHidden: false });
  off.triggers.loaded('d1', false);
  assert.deepEqual(off.captures, []);
  off.triggers.loaded('d2', true);
  assert.deepEqual(off.captures, [['d2', 'load']]);
});

test('forget cancels a pending capture', (t) => {
  const { triggers, captures } = make(t);
  triggers.changed('d1', true);
  triggers.forget('d1');
  t.mock.timers.tick(3000);
  assert.deepEqual(captures, []);
});

test('documents are independent and delayMs is configurable', (t) => {
  const { triggers, captures } = make(t, { delayMs: 100 });
  triggers.changed('a', true);
  triggers.changed('b', true);
  triggers.saved('a');
  t.mock.timers.tick(100);
  assert.deepEqual(captures, [['a', 'saved'], ['b', 'changed']]);
});

test('a first show captures its load after the paint delay, if still shown', (t) => {
  let shown = true;
  const { triggers, captures } = make(t, { paintMs: 200, shown: () => shown });
  triggers.firstShown('d1');
  t.mock.timers.tick(199);
  assert.deepEqual(captures, []);
  t.mock.timers.tick(1);
  assert.deepEqual(captures, [['d1', 'load']]);
  shown = false;
  triggers.firstShown('d2');
  t.mock.timers.tick(300);
  assert.equal(captures.length, 1, 'no longer shown: nothing');
});

test('a hidden, saved or forgotten document drops its pending first-show capture', (t) => {
  const { triggers, captures } = make(t);
  triggers.firstShown('a');
  triggers.hidden('a');
  triggers.firstShown('b');
  triggers.saved('b');
  triggers.firstShown('c');
  triggers.forget('c');
  t.mock.timers.tick(1000);
  assert.deepEqual(captures, [['a', 'hidden'], ['b', 'saved']]);
});
