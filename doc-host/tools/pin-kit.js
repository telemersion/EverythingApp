'use strict';

// Publishes a kit: node tools/pin-kit.js <version> <api>
// Adds the kit file's hash to kit/published.json. Run once per kit version.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const [version, api] = process.argv.slice(2);
if (!/^\d+\.\d+\.\d+$/.test(version || '') || !/^[1-9]\d*$/.test(api || '')) {
  console.error('Usage: node tools/pin-kit.js <version> <api>   e.g. 1.0.0 1');
  process.exit(1);
}
const kitDir = path.join(__dirname, '..', 'kit');
const file = `ev-kit-${version}.js`;
const text = '\n' + fs.readFileSync(path.join(kitDir, file), 'utf8');
if (text.includes('\r')) throw new Error(`${file} contains CR characters; use LF line endings.`);
if (/<\/script|<!--/i.test(text)) throw new Error(`${file} contains "</script" or "<!--"; escape it as "<\\/script".`);

const listPath = path.join(kitDir, 'published.json');
const list = fs.existsSync(listPath) ? JSON.parse(fs.readFileSync(listPath, 'utf8')) : [];
if (list.some((k) => k.version === version)) throw new Error(`Kit ${version} is already published.`);
const sha256 = crypto.createHash('sha256').update(text, 'utf8').digest('hex');
list.push({ version, api: Number(api), file, sha256 });
fs.writeFileSync(listPath, JSON.stringify(list, null, 2) + '\n');
console.log(`Published kit ${version} (API v${api}): ${sha256}`);
