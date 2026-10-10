'use strict';

// Builds a module file from its entry in modules/src:
//   node modules/build.js <name> <version> [--out <file>]
// Writes modules/<name>-<version>.js (or --out): a header line naming the
// module, its upstream packages and this script, then the minified bundle.
// The build is reproducible from package-lock.json; publish the result with
// node tools/pin-kit.js module <name> <version>.
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');

// Upstream packages named in each module's header.
const PACKAGES = {
  codemirror: ['@codemirror/state', '@codemirror/view', '@codemirror/commands'],
};

const [name, version, flag, outArg] = process.argv.slice(2);
if (!PACKAGES[name] || !/^\d+\.\d+\.\d+$/.test(version || '') || (flag && flag !== '--out')) {
  console.error('Usage: node modules/build.js <name> <version> [--out <file>]   e.g. codemirror 1.0.0');
  process.exit(1);
}
const out = outArg ? path.resolve(outArg) : path.join(__dirname, `${name}-${version}.js`);
const published = require('./published.json');
if (!outArg && published.some((m) => m.name === name && m.version === version)) {
  console.error(`Module ${name} ${version} is published; its file never changes. Build with --out to compare.`);
  process.exit(1);
}

// The packages do not export package.json, so read it from node_modules.
const versionOf = (pkg) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'node_modules', pkg, 'package.json'), 'utf8')).version;
const upstream = PACKAGES[name].map((pkg) => `${pkg} ${versionOf(pkg)}`).join(', ');
const result = esbuild.buildSync({
  entryPoints: [path.join(__dirname, 'src', `${name}.js`)],
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'chrome120',
  legalComments: 'none',
  define: { MODULE_VERSION: JSON.stringify(version) },
  write: false,
});
const header = `/* EverythingApp module ${name} ${version}: ${upstream}; built by doc-host/modules/build.js */`;
const text = `${header}\n${result.outputFiles[0].text.replace(/\n$/, '')}\n`;
if (/<\/script|<!--/i.test(text)) throw new Error(`The ${name} bundle contains "</script" or "<!--".`);
fs.writeFileSync(out, text);
console.log(`Built ${path.relative(process.cwd(), out)} (${text.length} bytes)`);
