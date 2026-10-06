'use strict';

const { protocol } = require('electron');
const { SCHEME, isDocumentUrl } = require('./urls');

const CSP = [
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  "script-src 'unsafe-inline'",
  'img-src data: blob:',
  'font-src data:',
].join('; ');

// Must run before the app is ready.
function registerSchemePrivileges() {
  protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true } }]);
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

module.exports = { CSP, registerSchemePrivileges, serveDocument };
