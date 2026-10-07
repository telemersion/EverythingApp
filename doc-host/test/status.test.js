'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { emptyStatus, BADGE_ORDER, describeStatus } = require('../src/status');

const NAMES = { name: 'Plan-7.ev.html', filePath: '/Users/ada/Docs/Plan-7.ev.html' };

function banner(patch) {
  const d = describeStatus({ ...emptyStatus(), ...patch }, NAMES);
  assert.equal(d.banners.length, 1);
  return d.banners[0];
}

test('emptyStatus has the documented shape', () => {
  assert.deepEqual(emptyStatus(), {
    dirty: false, missing: false, nonConforming: null, dataConflict: false,
    updatedWhileDirty: false, checkError: null, kitUpdate: null, kitUpdated: null,
    updatedFromDisk: 0, dismissed: [],
  });
  assert.notEqual(emptyStatus().dismissed, emptyStatus().dismissed);
});

test('BADGE_ORDER is the priority order', () => {
  assert.deepEqual(BADGE_ORDER, ['missing', 'non-conforming', 'data-conflict', 'updated-while-dirty', 'check-error', 'kit-update']);
});

test('the tab badge is the most urgent condition', () => {
  const s = { ...emptyStatus(), kitUpdate: { from: '1.0.0', to: '1.1.0' }, dataConflict: true, missing: true };
  const d = describeStatus(s, { name: 'a.ev.html', filePath: '/x/a.ev.html' });
  assert.deepEqual(d.badges, ['missing', 'data-conflict', 'kit-update']);
  assert.equal(d.badge, 'missing');
  assert.deepEqual(d.banners.map((b) => b.kind), ['missing', 'data-conflict', 'kit-update']);
});

test('a dismissed banner is hidden, its badge stays', () => {
  const d = describeStatus({ ...emptyStatus(), kitUpdate: { from: '1.0.0', to: '1.1.0' }, dismissed: ['kit-update'] }, NAMES);
  assert.deepEqual([d.badge, d.banners.length], ['kit-update', 0]);
});

test('banner copy', () => {
  assert.deepEqual(banner({ missing: true }), {
    kind: 'missing',
    message: 'Plan-7.ev.html was moved or deleted. Your changes exist only in this window. Put the file back at /Users/ada/Docs/Plan-7.ev.html and save again. The last saved version is in the version store.',
    actions: [],
    dismissLabel: 'OK',
  });
  assert.deepEqual(banner({ nonConforming: 'report text' }), {
    kind: 'non-conforming',
    message: 'The file on disk no longer follows the document specification. This version keeps running; saving is refused until the file is fixed.',
    actions: [{ id: 'copy-report', label: 'Copy report' }],
    dismissLabel: 'OK',
  });
  assert.deepEqual(banner({ dataConflict: true }), {
    kind: 'data-conflict',
    message: 'The data in Plan-7.ev.html was changed on disk, and you have unsaved changes.',
    actions: [{ id: 'keep-mine', label: 'Keep mine' }, { id: 'take-disk', label: 'Take the version on disk' }],
    dismissLabel: 'Later',
  });
  assert.deepEqual(banner({ updatedWhileDirty: true }), {
    kind: 'updated-while-dirty',
    message: 'This document was updated on disk. Your data is unsaved.',
    actions: [{ id: 'save-reload', label: 'Save my data and reload' }, { id: 'discard-reload', label: 'Reload and discard my changes' }],
    dismissLabel: 'Later',
  });
  assert.deepEqual(banner({ checkError: 'boom' }), {
    kind: 'check-error',
    message: 'EverythingApp could not check Plan-7.ev.html for changes on disk.',
    actions: [{ id: 'copy-report', label: 'Copy report' }],
    dismissLabel: 'OK',
  });
  assert.deepEqual(banner({ kitUpdate: { from: '1.2.3', to: '4.5.6' } }), {
    kind: 'kit-update',
    message: 'This document uses kit 1.2.3; 4.5.6 is available.',
    actions: [{ id: 'update-kit', label: 'Update kit' }],
    dismissLabel: 'Not now',
  });
  assert.deepEqual(banner({ kitUpdated: { from: '1.2.3', to: '4.5.6' } }), {
    kind: 'kit-updated',
    message: 'Kit updated to 4.5.6.',
    actions: [{ id: 'undo-kit', label: 'Undo' }],
    dismissLabel: 'OK',
  });
  assert.deepEqual(banner({ updatedFromDisk: 7 }), {
    kind: 'updated-from-disk',
    message: 'Updated from disk.',
    actions: [],
    dismissLabel: null,
    fadeMs: 4000,
    fadeKey: 7,
  });
});

test('updated-from-disk and kit-updated are banners, not badges', () => {
  const s = { ...emptyStatus(), updatedFromDisk: 3, kitUpdated: { from: '1.0.0', to: '1.1.0' } };
  const d = describeStatus(s, NAMES);
  assert.deepEqual(d.badges, []);
  assert.equal(d.badge, null);
  assert.deepEqual(d.banners.map((b) => b.kind), ['kit-updated', 'updated-from-disk']);
  assert.equal(d.banners.find((b) => b.kind === 'updated-from-disk').fadeMs, 4000);
  assert.equal('fadeMs' in d.banners.find((b) => b.kind === 'kit-updated'), false);
});

test('banner order puts the badge kinds first, then kit-updated, then updated-from-disk', () => {
  const s = {
    ...emptyStatus(), updatedFromDisk: 3, kitUpdated: { from: '1', to: '2' }, checkError: 'e',
    updatedWhileDirty: true, nonConforming: 'r',
  };
  assert.deepEqual(describeStatus(s, NAMES).banners.map((b) => b.kind),
    ['non-conforming', 'updated-while-dirty', 'check-error', 'kit-updated', 'updated-from-disk']);
});

test('dirty alone is neither badge nor banner', () => {
  assert.deepEqual(describeStatus({ ...emptyStatus(), dirty: true }, NAMES), { badges: [], badge: null, banners: [] });
});

test('dismissal hides banners of kit-updated and updated-from-disk too', () => {
  const s = { ...emptyStatus(), kitUpdated: { from: '1', to: '2' }, updatedFromDisk: 3, dismissed: ['kit-updated', 'updated-from-disk'] };
  assert.deepEqual(describeStatus(s, NAMES).banners, []);
});

test('a clean status has no badge and no banner', () => {
  assert.deepEqual(describeStatus(emptyStatus(), NAMES), { badges: [], badge: null, banners: [] });
});

test('describeStatus does not mutate the status', () => {
  const s = { ...emptyStatus(), missing: true, kitUpdate: { from: '1', to: '2' }, dismissed: ['kit-update'] };
  const copy = structuredClone(s);
  describeStatus(s, NAMES);
  assert.deepEqual(s, copy);
});

test('every start of "Updated from disk" changes the status and pushes a state; the end clears it', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { Document } = require('../src/document');
  const pushes = [];
  const doc = Object.create(Document.prototype);
  Object.assign(doc, {
    status: emptyStatus(), disposed: false, fromDiskTimer: null, name: 'a.ev.html', filePath: '/d/a.ev.html',
    pending: new Map(), latestChange: 0, savedChange: 0,
    ui: { update: () => pushes.push(doc.status.updatedFromDisk) },
  });
  doc.showUpdatedFromDisk();
  doc.showUpdatedFromDisk(); // a second reload within the period
  assert.equal(pushes.length, 2, 'the restart pushed a state too');
  assert.notEqual(pushes[0], pushes[1]);
  assert.ok(pushes[0] && pushes[1]);
  t.mock.timers.tick(4000);
  assert.deepEqual(pushes.slice(2), [0]);
});
