'use strict';

const { isAllowedRequest } = require('./urls');

// Locks down a document's (in-memory) session: no permissions, no
// downloads, no requests outside the document's own origin.
function hardenSession(ses, origin) {
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  ses.setDevicePermissionHandler(() => false);
  ses.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
    callback({ cancel: !isAllowedRequest(details.url, origin) });
  });
  ses.on('will-download', (event) => event.preventDefault());
}

// Locks down a document's web contents: no navigation, no new windows, no
// webviews, and a document cannot block closing with beforeunload.
function hardenContents(wc) {
  wc.on('will-navigate', (event) => event.preventDefault());
  wc.on('will-redirect', (event) => event.preventDefault());
  wc.on('will-attach-webview', (event) => event.preventDefault());
  wc.on('will-prevent-unload', (event) => event.preventDefault());
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
}

const WEB_PREFERENCES = Object.freeze({
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
  webSecurity: true,
  webviewTag: false,
  navigateOnDragDrop: false,
  spellcheck: false,
});

module.exports = { hardenSession, hardenContents, WEB_PREFERENCES };
