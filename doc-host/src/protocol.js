'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { protocol } = require('electron');
const { SCHEME, isDocumentUrl, UI_SCHEME, uiFileOf } = require('./urls');

const CSP = [
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  "script-src 'unsafe-inline'",
  'img-src data: blob:',
  'font-src data:',
].join('; ');

// The host UI runs only its own files: no inline script or style at all (it
// positions elements through the CSSOM), images only as data: URLs.
const UI_CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src data:";
const UI_DIR = path.join(__dirname, 'ui');
const UI_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};

// Must run before the app is ready.
function registerSchemePrivileges() {
  protocol.registerSchemesAsPrivileged([
    { scheme: SCHEME, privileges: { standard: true, secure: true } },
    { scheme: UI_SCHEME, privileges: { standard: true, secure: true } },
  ]);
}

// Serves the files of src/ui in the host-UI session, with the host UI's CSP.
// Every other request on the scheme gets a 404.
function serveHostUi(ses) {
  ses.protocol.handle(UI_SCHEME, async (request) => {
    const name = request.method === 'GET' ? uiFileOf(request.url) : null;
    if (!name) return new Response('Not found', { status: 404 });
    return new Response(await fs.readFile(path.join(UI_DIR, name)), {
      status: 200,
      headers: {
        'content-type': UI_TYPES[path.extname(name)],
        'content-security-policy': UI_CSP,
        'x-content-type-options': 'nosniff',
        'cache-control': 'no-store',
      },
    });
  });
}

// Serves exactly one URL in this session: the document, from memory, with a
// strict CSP. Every other request on the scheme gets a 404.
function serveDocument(ses, origin, getHtml) {
  ses.protocol.handle(SCHEME, (request) => {
    if (request.method !== 'GET' || !isDocumentUrl(request.url, origin)) {
      return new Response('Not found', { status: 404 });
    }
    return new Response(getHtml(), {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy': CSP,
        'cache-control': 'no-store',
      },
    });
  });
}

module.exports = { CSP, UI_CSP, registerSchemePrivileges, serveDocument, serveHostUi };
