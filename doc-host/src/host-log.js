'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

// The host log: background work that nobody asked for (the update check,
// the version store clean-up) reports here instead of in a sheet. One line
// per entry, "<ISO time> <message>", followed by the error's stack if there
// is one. A file at or over maxBytes moves to "<file>.1" (replacing the older
// one) before the next entry. write() never rejects.
function createHostLog(file, { maxBytes = 1_000_000, now = () => new Date() } = {}) {
  let chain = Promise.resolve();

  async function append(message, err) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const size = await fs.stat(file).then((s) => s.size, () => 0);
    if (size >= maxBytes) await fs.rename(file, `${file}.1`);
    const stack = err ? `${(err && err.stack) || String(err)}\n` : '';
    await fs.appendFile(file, `${now().toISOString()} ${message}\n${stack}`, 'utf8');
  }

  return {
    file,
    // Entries are written one after another, so rotation never races.
    write(message, err) {
      chain = chain.then(() => append(message, err)).catch(() => {});
      return chain;
    },
  };
}

module.exports = { createHostLog };
