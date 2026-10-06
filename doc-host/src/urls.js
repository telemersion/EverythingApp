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
function isAllowedRequest(url, origin) {
  return url.startsWith(`${origin}/`) || url.startsWith('data:') || url.startsWith('blob:');
}

module.exports = { SCHEME, originFor, isDocumentUrl, isAllowedRequest };
