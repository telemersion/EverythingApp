'use strict';

const { isAllowedRequest } = require('./urls');

// Every document session goes through this proxy. Nothing listens on the
// discard port, so any connection that bypasses webRequest (preconnect,
// WebRTC over TCP) fails. ev-doc:// is served in-process and never reaches
// the proxy. "<-loopback>" also sends localhost to it. The proxy does not
// stop DNS lookups (dns-prefetch); main.js turns off name resolution for the
// whole app instead (host-resolver-rules).
const DEAD_PROXY = Object.freeze({
  mode: 'fixed_servers',
  proxyRules: 'http://127.0.0.1:9',
  proxyBypassRules: '<-loopback>',
});

// Locks down a document's (in-memory) session: no permissions, no
// downloads, no requests outside the document's own origin, no network
// beyond a proxy that refuses everything. Resolves once the proxy is set.
function hardenSession(ses, origin) {
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  ses.setDevicePermissionHandler(() => false);
  ses.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
    callback({ cancel: !isAllowedRequest(details.url, origin) });
  });
  ses.on('will-download', (event) => event.preventDefault());
  return ses.setProxy(DEAD_PROXY);
}

// The preload does not run inside iframes, so file drops onto an iframe
// would reach it. A user-origin !important rule beats any document rule:
// iframes receive no pointer input, and drops land on the document itself.
const NO_IFRAME_INPUT = 'iframe { pointer-events: none !important; }';

// Locks down a document's web contents: no navigation, no new windows, no
// webviews, no WebRTC traffic outside the (dead) proxy, no pointer input
// into iframes, and a document cannot block closing with beforeunload.
function hardenContents(wc) {
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
