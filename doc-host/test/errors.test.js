'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { formatErrorReport, errorBox } = require('../src/errors');
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
