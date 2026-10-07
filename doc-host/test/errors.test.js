'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { formatErrorReport, errorBox, showErrorSheet } = require('../src/errors');
const { version } = require('../package.json');

test('the error report names action, file, message, stack and versions', () => {
  const err = new Error('disk on fire');
  const report = formatErrorReport({ action: 'reload', filePath: '/tmp/hours.ev.html', err });
  const lines = report.split('\n');
  assert.equal(lines[0], 'EverythingApp could not reload hours.ev.html.');
  assert.equal(lines[1], 'File: /tmp/hours.ev.html');
  assert.ok(lines.includes('Error: disk on fire'));
  assert.ok(report.includes(err.stack));
  assert.match(lines.at(-1), new RegExp(`^EverythingApp ${version.replace(/\./g, '\\.')}, Electron \\S+, ${process.platform} `));
});

test('the error report works without a file or an Error object', () => {
  const report = formatErrorReport({ action: 'show the open dialog', err: 'plain text' });
  assert.match(report, /^EverythingApp could not show the open dialog\.\nFile: \(none\)\n\nError: plain text\n/);
});

test('the error sheet shows the headline and the report, with Copy report first', () => {
  const err = new Error('disk on fire');
  const { report, options } = errorBox({ action: 'load', filePath: '/tmp/hours.ev.html', err });
  assert.equal(report, formatErrorReport({ action: 'load', filePath: '/tmp/hours.ev.html', err }));
  assert.deepEqual(options, {
    type: 'error',
    message: 'EverythingApp could not load hours.ev.html.',
    detail: report,
    buttons: ['Copy report', 'OK'],
    defaultId: 1,
    cancelId: 1,
  });
});

async function runSheet(result) {
  const copied = [];
  const logged = [];
  const shown = [];
  const sheet = async (options) => {
    shown.push(options);
    if (result instanceof Error) throw result;
    return result;
  };
  const err = new Error('disk on fire');
  await showErrorSheet(sheet, { action: 'load', filePath: '/tmp/a.ev.html', err },
    { copy: (t) => copied.push(t), log: (...a) => logged.push(a) });
  return { copied, logged, shown, report: errorBox({ action: 'load', filePath: '/tmp/a.ev.html', err }).report };
}

test('showErrorSheet copies the report on "Copy report"', async () => {
  const r = await runSheet(0);
  assert.equal(r.shown.length, 1);
  assert.deepEqual(r.copied, [r.report]);
  assert.deepEqual(r.logged, []);
});

test('showErrorSheet does nothing more on OK', async () => {
  const r = await runSheet(1);
  assert.deepEqual(r.copied, []);
  assert.deepEqual(r.logged, []);
});

test('showErrorSheet logs the report when no sheet can show', async () => {
  const r = await runSheet(null);
  assert.deepEqual(r.copied, []);
  assert.deepEqual(r.logged, [[r.report]]);
});

test('showErrorSheet logs the report and the failure when the sheet throws, and never rejects', async () => {
  const boom = new Error('no window');
  const r = await runSheet(boom);
  assert.deepEqual(r.logged, [[r.report, boom]]);
});
