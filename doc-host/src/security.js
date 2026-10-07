'use strict';

const { isAllowedRequest, isAllowedUiRequest } = require('./urls');

// Every document session, and the host-UI session, goes through this proxy.
// Nothing listens on the discard port, so any connection that bypasses
// webRequest (preconnect, WebRTC over TCP) fails. ev-doc:// and ev-ui:// are
// served in-process and never reach the proxy. "<-loopback>" also sends
// localhost to it. The proxy does not stop DNS lookups (dns-prefetch);
// main.js turns off name resolution for the whole app instead
// (host-resolver-rules).
const DEAD_PROXY = Object.freeze({
  mode: 'fixed_servers',
  proxyRules: 'http://127.0.0.1:9',
  proxyBypassRules: '<-loopback>',
});

// No permissions (fullscreen included, so nothing can cover the host UI), no
// downloads, only the requests isAllowed(details) accepts, no network beyond
// a proxy that refuses everything. Resolves once the proxy is set.
function lockDown(ses, isAllowed) {
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  ses.setDevicePermissionHandler(() => false);
  ses.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
    callback({ cancel: !isAllowed(details) });
  });
  ses.on('will-download', (event) => event.preventDefault());
  return ses.setProxy(DEAD_PROXY);
}

// Locks down a document's (in-memory) session: no requests outside the
// document's own origin. allowDevTools (dev builds only) lets the DevTools
// front end, which loads in this session, open. Requests from the document's
// own web contents never get that exception; documentWebContentsId() is read
// per request because the web contents is created after the session.
function hardenSession(ses, origin, { allowDevTools = false, documentWebContentsId = () => undefined } = {}) {
  return lockDown(ses, (details) => isAllowedRequest(details.url, origin, {
    allowDevTools: allowDevTools && details.webContentsId !== documentWebContentsId(),
  }));
}

// Locks down the host UI's (in-memory) session the same way: it loads only
// its own files and data: URLs. Requests from host-UI web contents
// (isUiContents(id)) never get the DevTools exception.
function hardenUiSession(ses, { allowDevTools = false, isUiContents = () => false } = {}) {
  return lockDown(ses, (details) => isAllowedUiRequest(details.url, {
    allowDevTools: allowDevTools && !isUiContents(details.webContentsId),
  }));
}

// The preload does not run inside iframes, so file drops onto an iframe
// would reach it. A user-origin !important rule beats any document rule:
// subframes (iframe, and frame/frameset after a document swaps in a
// frameset) receive no pointer input, and drops land on the document itself.
// preload.js inserts the same rule before any document script runs; it is
// sandboxed and cannot require this module, so it keeps a copy (a test
// checks that both are equal). Keep them in sync.
const NO_IFRAME_INPUT = 'iframe, frame, frameset { pointer-events: none !important; }';

// Locks down a document's web contents: no navigation, no new windows, no
// webviews, no WebRTC traffic outside the (dead) proxy, no pointer input
// into iframes, and a document cannot block closing with beforeunload.
function hardenContents(wc) {
  // Backstop: the preload inserts the rule earlier, on every load.
  wc.on('dom-ready', () => { // every load, including reloads
    wc.insertCSS(NO_IFRAME_INPUT, { cssOrigin: 'user' }).catch(() => {});
  });
  wc.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
  wc.on('will-navigate', (event) => event.preventDefault());
  wc.on('will-redirect', (event) => event.preventDefault());
  wc.on('will-attach-webview', (event) => event.preventDefault());
  wc.on('will-prevent-unload', (event) => event.preventDefault());
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
}

// disableDialogs: alert() does nothing and confirm() returns false at once.
// A document cannot block itself or the host with a native dialog.
const WEB_PREFERENCES = Object.freeze({
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
  webSecurity: true,
  webviewTag: false,
  navigateOnDragDrop: false,
  spellcheck: false,
  disableDialogs: true,
});

module.exports = { hardenSession, hardenUiSession, hardenContents, WEB_PREFERENCES, NO_IFRAME_INPUT };
