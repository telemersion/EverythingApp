'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  originFor, isDocumentUrl, isAllowedRequest, UI_SCHEME, UI_ORIGIN, UI_FILES, isAllowedUiRequest, uiFileOf,
} = require('../src/urls');

const origin = originFor('0123abcd');

test('originFor builds an ev-doc origin', () => {
  assert.equal(origin, 'ev-doc://0123abcd');
});

test('only the document URL itself is served', () => {
  assert.equal(isDocumentUrl('ev-doc://0123abcd/', origin), true);
  assert.equal(isDocumentUrl('ev-doc://0123abcd/other.html', origin), false);
  assert.equal(isDocumentUrl('ev-doc://0123abcd/?x=1', origin), false);
  assert.equal(isDocumentUrl('ev-doc://ffff/', origin), false);
});

test('a document session may only request its own origin, data: and blob:', () => {
  assert.equal(isAllowedRequest('ev-doc://0123abcd/', origin), true);
  assert.equal(isAllowedRequest('data:image/png;base64,AAAA', origin), true);
  assert.equal(isAllowedRequest('blob:ev-doc://0123abcd/5f2c', origin), true);
  for (const url of ['devtools://devtools/bundled/devtools_app.html', 'https://example.com/', 'http://localhost/', 'file:///etc/hosts', 'ev-doc://ffff/', 'ws://x/']) {
    assert.equal(isAllowedRequest(url, origin), false, url);
  }
});

test('devtools:// is allowed only with the dev flag, and nothing else opens up', () => {
  const devtools = 'devtools://devtools/bundled/devtools_app.html?remoteBase=x';
  assert.equal(isAllowedRequest(devtools, origin), false);
  assert.equal(isAllowedRequest(devtools, origin, { allowDevTools: false }), false);
  assert.equal(isAllowedRequest(devtools, origin, { allowDevTools: true }), true);
  assert.equal(isAllowedRequest('ev-doc://0123abcd/', origin, { allowDevTools: true }), true);
  for (const url of ['https://chrome-devtools-frontend.appspot.com/', 'http://localhost:9222/', 'file:///etc/hosts', 'ev-doc://ffff/']) {
    assert.equal(isAllowedRequest(url, origin, { allowDevTools: true }), false, url);
  }
});

test('the host UI has its own scheme, origin and three files', () => {
  assert.equal(UI_SCHEME, 'ev-ui');
  assert.equal(UI_ORIGIN, 'ev-ui://host');
  assert.deepEqual(UI_FILES, ['index.html', 'ui.css', 'ui.js']);
});

test('the host UI may load only its own files and data: URLs', () => {
  assert.equal(isAllowedUiRequest('ev-ui://host/ui.js'), true);
  for (const u of ['ev-ui://host/other.js', 'ev-ui://evil/ui.js', 'https://example.com/', 'file:///etc/hosts', 'ev-doc://x/']) {
    assert.equal(isAllowedUiRequest(u), false, u);
  }
  assert.equal(isAllowedUiRequest('ev-ui://host/index.html'), true);
  assert.equal(isAllowedUiRequest('ev-ui://host/ui.css'), true);
  assert.equal(isAllowedUiRequest('data:image/png;base64,AAAA'), true);
  for (const u of ['ev-ui://host/', 'ev-ui://host/ui.js?x=1', 'ev-ui://host/ui.js#x', 'ev-ui://host/src/ui.js',
    'ev-ui://host/../ui.js', 'ev-ui://host.evil/ui.js', 'blob:ev-ui://host/1', 'devtools://devtools/bundled/devtools_app.html',
    'ws://localhost/', '', null, undefined, 42]) {
    assert.equal(isAllowedUiRequest(u), false, String(u));
  }
});

test('devtools:// opens for the host UI only with the dev flag', () => {
  const devtools = 'devtools://devtools/bundled/devtools_app.html?remoteBase=x';
  assert.equal(isAllowedUiRequest(devtools, { allowDevTools: false }), false);
  assert.equal(isAllowedUiRequest(devtools, { allowDevTools: true }), true);
  for (const u of ['https://chrome-devtools-frontend.appspot.com/', 'ev-ui://host/other.js', 'file:///etc/hosts']) {
    assert.equal(isAllowedUiRequest(u, { allowDevTools: true }), false, u);
  }
});

test('uiFileOf names the file of src/ui a URL asks for, or null', () => {
  assert.equal(uiFileOf('ev-ui://host/index.html'), 'index.html');
  assert.equal(uiFileOf('ev-ui://host/ui.js'), 'ui.js');
  for (const u of ['ev-ui://host/', 'ev-ui://host/ui.js?x', 'ev-ui://evil/ui.js', 'ev-doc://host/ui.js', 'data:,x', 42]) {
    assert.equal(uiFileOf(u), null, String(u));
  }
});
