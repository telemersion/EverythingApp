'use strict';

const { isAllowedRequest } = require('./urls');

// Every document session goes through this proxy. Nothing listens on the
// discard port, so any connection that bypasses webRequest (DNS prefetch,
// preconnect, WebRTC over TCP) fails. ev-doc:// is served in-process and
// never reaches the proxy. "<-loopback>" also sends localhost to it.
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

// Locks down a document's web contents: no navigation, no new windows, no
// webviews, no WebRTC traffic outside the (dead) proxy, and a document
// cannot block closing with beforeunload.
function hardenContents(wc) {
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
