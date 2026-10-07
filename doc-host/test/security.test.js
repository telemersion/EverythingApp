'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('preload and security.js insert the same no-subframe-input rule', () => {
  const { NO_IFRAME_INPUT } = require('../src/security');
  const preload = fs.readFileSync(path.join(__dirname, '../src/preload.js'), 'utf8');
  const match = /const NO_IFRAME_INPUT = '([^']*)';/.exec(preload);
  assert.ok(match, 'preload defines NO_IFRAME_INPUT');
  assert.equal(match[1], NO_IFRAME_INPUT);
  assert.match(NO_IFRAME_INPUT, /iframe, frame, frameset/);
});

// A stand-in for an Electron session that records what hardening sets.
function fakeSession() {
  const ses = { handlers: {}, events: {}, proxy: null };
  ses.setPermissionRequestHandler = (fn) => { ses.handlers.request = fn; };
  ses.setPermissionCheckHandler = (fn) => { ses.handlers.check = fn; };
  ses.setDevicePermissionHandler = (fn) => { ses.handlers.device = fn; };
  ses.webRequest = { onBeforeRequest: (_filter, fn) => { ses.handlers.request2 = fn; } };
  ses.on = (name, fn) => { ses.events[name] = fn; };
  ses.setProxy = async (config) => { ses.proxy = config; };
  return ses;
}

const cancels = (ses, url, webContentsId = 1) => {
  let result;
  ses.handlers.request2({ url, webContentsId }, (r) => { result = r.cancel; });
  return result;
};

test('the host-UI session loads only its own files, denies permissions and downloads, and uses the dead proxy', async () => {
  const { hardenUiSession } = require('../src/security');
  const ses = fakeSession();
  await hardenUiSession(ses);
  assert.equal(cancels(ses, 'ev-ui://host/ui.js'), false);
  assert.equal(cancels(ses, 'data:image/png;base64,AAAA'), false);
  for (const url of ['ev-ui://host/x.js', 'https://example.com/', 'ev-doc://abc/', 'devtools://devtools/x']) {
    assert.equal(cancels(ses, url), true, url);
  }
  let granted;
  ses.handlers.request(null, 'fullscreen', (ok) => { granted = ok; });
  assert.equal(granted, false);
  assert.equal(ses.handlers.check(), false);
  assert.equal(ses.handlers.device(), false);
  let prevented = false;
  ses.events['will-download']({ preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
  assert.deepEqual(ses.proxy, { mode: 'fixed_servers', proxyRules: 'http://127.0.0.1:9', proxyBypassRules: '<-loopback>' });
});

test('in dev builds the host-UI session lets DevTools load, but never for the host UI itself', async () => {
  const { hardenUiSession } = require('../src/security');
  const ses = fakeSession();
  await hardenUiSession(ses, { allowDevTools: true, isUiContents: (id) => id === 7 });
  assert.equal(cancels(ses, 'devtools://devtools/bundled/devtools_app.html', 8), false);
  assert.equal(cancels(ses, 'devtools://devtools/bundled/devtools_app.html', 7), true);
  assert.equal(cancels(ses, 'https://example.com/', 8), true);
});
