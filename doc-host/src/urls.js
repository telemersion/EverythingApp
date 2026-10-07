'use strict';

// Pure URL rules for document sessions and the host-UI session (no Electron
// imports, unit-tested).

const SCHEME = 'ev-doc';
const UI_SCHEME = 'ev-ui';
const UI_ORIGIN = `${UI_SCHEME}://host`;
const UI_FILES = Object.freeze(['index.html', 'ui.css', 'ui.js']);

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

// The file of src/ui that a host-UI URL names, or null: exactly
// UI_ORIGIN/<one of UI_FILES>, no query, no fragment, no folders.
function uiFileOf(url) {
  if (typeof url !== 'string' || !url.startsWith(`${UI_ORIGIN}/`)) return null;
  const name = url.slice(UI_ORIGIN.length + 1);
  return UI_FILES.includes(name) ? name : null;
}

// Requests the host-UI session may make at all: its own files and data:
// URLs (thumbnails). allowDevTools (dev builds only) lets its DevTools front
// end load.
function isAllowedUiRequest(url, { allowDevTools = false } = {}) {
  if (typeof url !== 'string') return false;
  return uiFileOf(url) !== null || url.startsWith('data:') || (allowDevTools && url.startsWith('devtools://'));
}

module.exports = {
  SCHEME, originFor, isDocumentUrl, isAllowedRequest, UI_SCHEME, UI_ORIGIN, UI_FILES, uiFileOf, isAllowedUiRequest,
};
