'use strict';

// Builds a document from its sources:
//   node tools/assemble.js <source folder> <output file>
// The source folder holds meta.json ({ lang, title, docType, docTypeVersion,
// optional modules: [names], optional kitVersion }), style.css, manifest.json,
// script.js and data.json. The kit and the modules are inserted verbatim: the
// current kit (or the published kit named by meta.kitVersion; test kits need
// EV_TEST_KITS=1) and the newest published version of each module. The
// document id stays empty: the host or the kit assigns it.
const fs = require('node:fs');
const path = require('node:path');
const { buildDocument } = require('../src/frame');
const { escapeJson } = require('../src/splice');
const { checkDocument, formatReport } = require('../src/conformance');
const { currentKit, findKit } = require('../kit');
const { newestModule } = require('../modules');

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
const modules = [...new Set(meta.modules || [])].sort().map((name) => {
  const module = newestModule(name);
  if (!module) {
    console.error(`Module ${name} is not a published module.`);
    process.exit(1);
  }
  return module;
});
const html = buildDocument({
  lang: meta.lang,
  api: String(kit.api),
  docType: meta.docType,
  docTypeVersion: meta.docTypeVersion,
  docId: '',
  title: meta.title,
  style: '\n' + read('style.css'),
  manifest: escapeJson(JSON.stringify(JSON.parse(read('manifest.json')))),
  data: escapeJson(JSON.stringify(JSON.parse(read('data.json')))),
  kitVersion: kit.version,
  kit: kit.text,
  modules,
  script: '\n' + read('script.js'),
});

const check = checkDocument(html);
if (!check.ok) {
  console.error(formatReport(outFile, check.errors, { context: 'assemble' }));
  process.exit(1);
}
fs.writeFileSync(outFile, html, 'utf8');
console.log(`Wrote ${outFile} (kit ${kit.version}, ${html.length} characters)`);
