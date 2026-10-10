'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHostLog } = require('../src/host-log');

const tempDirs = [];

// Every test works in its own mkdtemp directory; all are removed afterwards.
test.after(async () => {
  for (const dir of tempDirs) await fs.rm(dir, { recursive: true, force: true });
});

async function mkTemp() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ev-log-'));
  tempDirs.push(dir);
  return dir;
}

const fixedNow = () => new Date('2026-10-10T12:00:00.000Z');

test('writes one timestamped line', async () => {
  const file = path.join(await mkTemp(), 'logs', 'host.log');
  const log = createHostLog(file, { now: fixedNow });
  await log.write('clean-up: 3 entries');
  assert.equal(log.file, file);
  assert.equal(await fs.readFile(file, 'utf8'), '2026-10-10T12:00:00.000Z clean-up: 3 entries\n');
});

test('appends the stack of an error', async () => {
  const file = path.join(await mkTemp(), 'host.log');
  const log = createHostLog(file, { now: fixedNow });
  const err = new Error('feed unreachable');
  await log.write('update check failed', err);
  const text = await fs.readFile(file, 'utf8');
  assert.ok(text.startsWith('2026-10-10T12:00:00.000Z update check failed\n'));
  assert.ok(text.includes(err.stack));
});

test('rotates once at maxBytes', async () => {
  const dir = await mkTemp();
  const file = path.join(dir, 'host.log');
  const log = createHostLog(file, { maxBytes: 50, now: fixedNow });
  await log.write('first line, long enough to fill it'); // 59 bytes
  await log.write('second');
  assert.equal(await fs.readFile(`${file}.1`, 'utf8'), '2026-10-10T12:00:00.000Z first line, long enough to fill it\n');
  assert.equal(await fs.readFile(file, 'utf8'), '2026-10-10T12:00:00.000Z second\n');
  await log.write('third, which makes the file long enough');
  await log.write('fourth');
  assert.deepEqual((await fs.readdir(dir)).sort(), ['host.log', 'host.log.1']);
  assert.equal(await fs.readFile(file, 'utf8'), '2026-10-10T12:00:00.000Z fourth\n');
});

test('never rejects', async () => {
  const dir = await mkTemp();
  await fs.writeFile(path.join(dir, 'blocker'), 'a file, not a folder');
  const log = createHostLog(path.join(dir, 'blocker', 'host.log'));
  await log.write('nowhere to go');
});

test('concurrent writes keep their order', async () => {
  const file = path.join(await mkTemp(), 'host.log');
  const log = createHostLog(file, { now: fixedNow });
  await Promise.all(['a', 'b', 'c'].map((m) => log.write(m)));
  assert.equal(await fs.readFile(file, 'utf8'), ['a', 'b', 'c'].map((m) => `2026-10-10T12:00:00.000Z ${m}\n`).join(''));
});
