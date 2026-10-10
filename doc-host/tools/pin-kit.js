'use strict';

// Publishes a kit:    node tools/pin-kit.js <version> <api>
// Publishes a module: node tools/pin-kit.js module <name> <version>
// Adds the file's hash to kit/published.json or modules/published.json.
// Run once per version.
const fs = require('node:fs');
const path = require('node:path');
const { sha256: hashText } = require('../src/hash');

const args = process.argv.slice(2);
const isModule = args[0] === 'module';
const [name, version, api] = isModule ? [args[1], args[2], null] : ['kit', args[0], args[1]];
const usage = 'Usage: node tools/pin-kit.js <version> <api>   e.g. 2.0.0 1\n' +
  '       node tools/pin-kit.js module <name> <version>   e.g. module codemirror 1.0.0';
if (!/^\d+\.\d+\.\d+$/.test(version || '') || (isModule ? !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name || '') : !/^[1-9]\d*$/.test(api || ''))) {
  console.error(usage);
  process.exit(1);
}
const dir = path.join(__dirname, '..', isModule ? 'modules' : 'kit');
const file = isModule ? `${name}-${version}.js` : `ev-kit-${version}.js`;
const label = isModule ? `Module ${name} ${version}` : `Kit ${version}`;
const text = '\n' + fs.readFileSync(path.join(dir, file), 'utf8');
if (text.includes('\r')) throw new Error(`${file} contains CR characters; use LF line endings.`);
if (/<\/script|<!--/i.test(text)) throw new Error(`${file} contains "</script" or "<!--"; escape it as "<\\/script".`);

const listPath = path.join(dir, 'published.json');
const list = fs.existsSync(listPath) ? JSON.parse(fs.readFileSync(listPath, 'utf8')) : [];
if (list.some((k) => k.version === version && (!isModule || k.name === name))) throw new Error(`${label} is already published.`);
const sha256 = hashText(text);
list.push(isModule ? { name, version, file, sha256 } : { version, api: Number(api), file, sha256 });
fs.writeFileSync(listPath, JSON.stringify(list, null, 2) + '\n');
console.log(`Published ${isModule ? label : `kit ${version} (API v${api})`}: ${sha256}`);
