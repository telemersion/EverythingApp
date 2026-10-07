/* EverythingApp kit 1.1.0 (host API v1). Part of the document frame:
   the host checks this exact text by hash. Do not edit it in a document. */
(function () {
  'use strict';

  var KIT_VERSION = '1.1.0';
  var kitText = document.currentScript.textContent;
  var styleText = document.getElementById('ev-style').textContent;
  var docTypeMeta = document.querySelector('meta[name="ev-doc-type"]');
  var frame = {
    lang: document.documentElement.getAttribute('lang'),
    api: document.querySelector('meta[name="ev-host-api"]').getAttribute('content'),
    docType: docTypeMeta.getAttribute('content'),
    docTypeVersion: docTypeMeta.getAttribute('data-version'),
    title: document.querySelector('head > title').textContent
  };
  var initialized = false;

  function escapeJson(json) {
    return json.replace(/</g, '\\u003c');
  }

  // Must produce exactly the frame of doc-host/src/frame.js.
  function buildDocument(p) {
    return '<!DOCTYPE html>\n<html lang="' + p.lang + '">\n<head>\n' +
      '  <meta charset="utf-8">\n' +
      '  <meta name="ev-host-api" content="' + p.api + '">\n' +
      '  <meta name="ev-doc-type" content="' + p.docType + '" data-version="' + p.docTypeVersion + '">\n' +
      '  <title>' + p.title + '</title>\n' +
      '  <style id="ev-style">' + p.style + '</style>\n' +
      '</head>\n<body>\n' +
      '  <div id="ev-app"></div>\n' +
      '  <script type="application/json" id="ev-data">' + p.data + '<\/script>\n' +
      '  <script id="ev-kit" data-kit-version="' + p.kitVersion + '">' + p.kit + '<\/script>\n' +
      '  <script id="ev-script">' + p.script + '<\/script>\n' +
      '</body>\n</html>\n';
  }

  // ---------- Browser fallback: save a new copy of this file ----------

  var DB_NAME = 'ev-kit-handles';
  var STORE = 'handles';
  var fileHandle = null;

  function openDb() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function () { req.result.createObjectStore(STORE); };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function loadHandle() {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var q = db.transaction(STORE).objectStore(STORE).get(location.href);
        q.onsuccess = function () { resolve(q.result || null); };
        q.onerror = function () { reject(q.error); };
      });
    }).catch(function () { return null; });
  }

  function storeHandle(handle) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(handle, location.href);
        tx.oncomplete = resolve;
        tx.onerror = function () { reject(tx.error); };
      });
    }).catch(function () { /* not critical: the picker appears again next time */ });
  }

  function suggestedName() {
    var last = decodeURIComponent(location.pathname.split('/').pop() || '');
    return last || frame.docType + '.ev.html';
  }

  async function writeWithPicker(html) {
    if (!fileHandle) fileHandle = await loadHandle();
    if (fileHandle) {
      var perm = await fileHandle.queryPermission({ mode: 'readwrite' });
      if (perm !== 'granted') perm = await fileHandle.requestPermission({ mode: 'readwrite' });
      if (perm !== 'granted') fileHandle = null;
    }
    if (!fileHandle) {
      fileHandle = await window.showSaveFilePicker({
        suggestedName: suggestedName(),
        types: [{ description: 'EverythingApp document', accept: { 'text/html': ['.html'] } }]
      });
      await storeHandle(fileHandle);
    }
    var w = await fileHandle.createWritable();
    await w.write(html);
    await w.close();
  }

  function download(html) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    a.download = suggestedName();
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  async function fallbackSave(html) {
    try {
      if (window.showSaveFilePicker) await writeWithPicker(html);
      else download(html);
      return true;
    } catch (err) {
      if (err && err.name === 'AbortError') return false;
      fileHandle = null;
      alert('Saving failed: ' + (err && err.message ? err.message : err));
      return false;
    }
  }

  // ---------- Public interface ----------

  function init(options) {
    if (initialized) throw new Error('EvKit.init() may only be called once.');
    initialized = true;
    options = options || {};

    var scriptEl = document.getElementById('ev-script');
    var scriptText = scriptEl ? scriptEl.textContent : '';
    var data = JSON.parse(document.getElementById('ev-data').textContent || '{}');
    if (data === null || typeof data !== 'object' || Array.isArray(data)) data = {};
    var getData = typeof options.getData === 'function' ? options.getData : function () { return data; };
    var onDirtyChange = typeof options.onDirtyChange === 'function' ? options.onDirtyChange : function () {};
    var host = window.evHost && window.evHost.version >= 1 ? window.evHost : null;
    var dirty = false;

    function serialize() {
      return JSON.stringify(getData());
    }

    function toHtml() {
      return buildDocument({
        lang: frame.lang, api: frame.api, docType: frame.docType,
        docTypeVersion: frame.docTypeVersion, title: frame.title,
        style: styleText, data: escapeJson(serialize()),
        kitVersion: KIT_VERSION, kit: kitText, script: scriptText
      });
    }

    // Elements the document marks data-ev-fallback="status" show the save state.
    function showFallbackStatus() {
      var els = document.querySelectorAll('[data-ev-fallback="status"]');
      for (var i = 0; i < els.length; i++) {
        els[i].textContent = dirty ? 'Unsaved changes' : 'Saved';
        els[i].setAttribute('data-ev-state', dirty ? 'unsaved' : 'saved');
      }
    }

    function setDirty(value) {
      if (dirty === value) return;
      dirty = value;
      showFallbackStatus();
      onDirtyChange(value);
    }

    function save() {
      if (host) return Promise.resolve(false);
      return fallbackSave(toHtml()).then(function (ok) {
        if (ok) setDirty(false);
        return ok;
      });
    }

    if (host) {
      // The host owns saving, the dirty marker and the close prompt.
      host.onSaveRequest(serialize);
      // Fallback UI the document marks is hidden here; saving rebuilds from the frame.
      var hide = document.createElement('style');
      hide.textContent = '[data-ev-fallback] { display: none !important; }';
      document.head.append(hide);
    } else {
      window.addEventListener('keydown', function (e) {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
          e.preventDefault();
          save();
        }
      });
      window.addEventListener('beforeunload', function (e) {
        if (dirty) { e.preventDefault(); e.returnValue = ''; }
      });
      document.addEventListener('click', function (e) {
        var target = e.target;
        if (target && target.closest && target.closest('[data-ev-fallback="save"]')) {
          e.preventDefault();
          save();
        }
      });
      document.addEventListener('DOMContentLoaded', showFallbackStatus);
    }

    return Object.freeze({
      data: data,
      hosted: !!host,
      changed: function () {
        if (host) host.markDirty();
        else setDirty(true);
      },
      save: save,
      toHtml: toHtml
    });
  }

  Object.defineProperty(window, 'EvKit', {
    value: Object.freeze({ version: KIT_VERSION, init: init }),
    writable: false,
    configurable: false
  });
})();
