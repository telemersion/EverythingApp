'use strict';

// Builds a document from its sources:
//   node tools/assemble.js <source folder> <output file>
// The source folder holds meta.json ({ lang, title, docType, docTypeVersion,
// optional kitVersion }), style.css, script.js and data.json. The kit is inserted
// verbatim: the current kit, or the published kit named by meta.kitVersion.
const fs = require('node:fs');
const path = require('node:path');
const { buildDocument } = require('../src/frame');
const { escapeJson } = require('../src/splice');
const { checkDocument, formatReport } = require('../src/conformance');
const { currentKit, findKit } = require('../kit');

const [srcDir, outFile] = process.argv.slice(2);
if (!srcDir || !outFile) {
  console.error('Usage: node tools/assemble.js <source folder> <output file>');
  process.exit(1);
}

const read = (name) => fs.readFileSync(path.join(srcDir, name), 'utf8');
const meta = JSON.parse(read('meta.json'));
const kit = meta.kitVersion ? findKit(meta.kitVersion) : currentKit();
if (!kit) {
  console.error(`Kit ${meta.kitVersion} is not a published kit.`);
  process.exit(1);
}
const html = buildDocument({
  lang: meta.lang,
  api: String(kit.api),
  docType: meta.docType,
  docTypeVersion: meta.docTypeVersion,
  title: meta.title,
  style: '\n' + read('style.css'),
  data: escapeJson(JSON.stringify(JSON.parse(read('data.json')))),
  kitVersion: kit.version,
  kit: kit.text,
  script: '\n' + read('script.js'),
});

const check = checkDocument(html);
if (!check.ok) {
  console.error(formatReport(outFile, check.errors, { context: 'assemble' }));
  process.exit(1);
}
fs.writeFileSync(outFile, html, 'utf8');
console.log(`Wrote ${outFile} (kit ${kit.version}, ${html.length} characters)`);
