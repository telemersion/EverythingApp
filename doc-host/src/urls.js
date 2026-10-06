'use strict';

// Pure URL rules for document sessions (no Electron imports, unit-tested).

const SCHEME = 'ev-doc';

function originFor(id) {
  return `${SCHEME}://${id}`;
}

// The only URL the protocol handler answers: the document itself.
function isDocumentUrl(url, origin) {
  return url === `${origin}/`;
}

// Requests a document session may make at all. Everything else is cancelled.
// allowDevTools (dev builds only) lets the DevTools front end load; it is
// the devtools:// scheme only, never network.
function isAllowedRequest(url, origin, { allowDevTools = false } = {}) {
  return url.startsWith(`${origin}/`) || url.startsWith('data:') || url.startsWith('blob:')
    || (allowDevTools && url.startsWith('devtools://'));
}

module.exports = { SCHEME, originFor, isDocumentUrl, isAllowedRequest };
