'use strict';

const path = require('node:path');
const { WebContentsView, session } = require('electron');
const { hardenUiSession, hardenContents, WEB_PREFERENCES } = require('./security');
const { serveHostUi } = require('./protocol');
const { UI_ORIGIN } = require('./urls');

const PARTITION = 'ev-ui'; // no "persist:" = in memory
const PUSH_INTERVAL_MS = 16;

// Web contents ids of the host-UI views. Their DevTools front ends load in
// the same session and may load devtools:// URLs; the host UI itself never.
const uiContents = new Set();
// One host-UI session per process (a partition name names one session):
// served and hardened by the first HostUi, shared by any later one.
let sessionReady = null;

function prepareSession(ses, allowDevTools) {
  if (!sessionReady) {
    serveHostUi(ses);
    sessionReady = hardenUiSession(ses, { allowDevTools, isUiContents: (id) => uiContents.has(id) });
  }
  return sessionReady;
}

// The host UI: one view beneath every document view, over the whole content
// area of the window. It draws the document list, tab strips, banner rows,
// dividers, the empty state and the restore notice from the state the
// workspace pushes (ui-state.js), and reports what the user does as intents.
// It decides nothing: ipc.js accepts ui:intent only from this view's web
// contents, checks each intent (ui-intents.js) and hands it to onIntent.
// Its session and preload are its own; no document shares them.
class HostUi {
  constructor({ win, onIntent, allowDevTools = false }) {
    this.win = win;
    this.onIntent = onIntent;
    this.state = null;          // the newest state
    this.timer = null;          // the scheduled send
    this.lastSent = -Infinity;  // when a state last went out
    this.loaded = false;        // the page has loaded once
    this.disposed = false;
    this.defaultBackground = '#ffffffff'; // what the view had before the first raise
    this.raised = false;        // above the documents, transparent: a drag runs

    const ses = session.fromPartition(PARTITION);
    const hardened = prepareSession(ses, allowDevTools);
    this.view = new WebContentsView({
      webPreferences: { ...WEB_PREFERENCES, session: ses, preload: path.join(__dirname, 'ui-preload.js') },
    });
    const wc = this.view.webContents;
    this.webContentsId = wc.id;
    uiContents.add(this.webContentsId);
    hardenContents(wc);
    this.defaultBackground = this.view.getBackgroundColor?.() || this.defaultBackground;
    // A crash or a reload of the page while raised must not leave the
    // documents covered.
    wc.on('render-process-gone', () => this.lower());
    wc.on('did-start-navigation', (details) => {
      if ((details?.isMainFrame ?? true) && !(details?.isSameDocument)) this.lower();
    });
    // Every load, a reload from its DevTools included, gets the newest state.
    wc.on('did-finish-load', () => {
      this.loaded = true;
      this.schedule();
    });
    // First child: beneath every document view. The workspace keeps the
    // bounds at the whole content area.
    win.contentView.addChildView(this.view, 0);
    const { width, height } = win.getContentBounds();
    this.view.setBounds({ x: 0, y: 0, width, height });
    // Resolves once the page has loaded; it never loads before the proxy is set.
    this.ready = hardened
      .then(() => (wc.isDestroyed() ? undefined : wc.loadURL(`${UI_ORIGIN}/index.html`)))
      .catch((err) => {
        if (!this.disposed) throw err;
      });
  }

  // Sends the newest state: at most one 'ui:state' per 16 ms, and the one
  // that goes out is always the newest.
  pushState(state) {
    this.state = state;
    this.schedule();
  }

  schedule() {
    if (this.timer || this.disposed || !this.loaded || this.state === null) return;
    const delay = Math.max(0, this.lastSent + PUSH_INTERVAL_MS - Date.now());
    this.timer = setTimeout(() => this.sendNow(), delay);
  }

  sendNow() {
    clearTimeout(this.timer);
    this.timer = null;
    const wc = this.view.webContents;
    if (this.disposed || !this.loaded || this.state === null || wc.isDestroyed()) return;
    this.lastSent = Date.now();
    wc.send('ui:state', { ...this.state, dragging: this.raised });
  }

  // A document's thumbnail (Task 12).
  pushThumbnail(docId, dataUrl) {
    const wc = this.view.webContents;
    if (!this.disposed && this.loaded && !wc.isDestroyed()) wc.send('ui:thumbnail', docId, dataUrl);
  }

  // During a drag: the view goes on top of the documents with a transparent
  // background, so the page can draw drop markers over them (the page drops
  // its own backgrounds when it sees dragging: true).
  raise() {
    if (this.disposed || this.raised || this.win.isDestroyed()) return;
    this.raised = true;
    this.view.setBackgroundColor('#00000000');
    this.win.contentView.addChildView(this.view); // re-adding puts it on top
    this.sendNow(); // the page drops its backgrounds at once: no flash
  }

  // Back beneath every document, opaque. Never left on top: the documents
  // would be unusable.
  lower() {
    if (this.disposed || !this.raised) return;
    this.raised = false;
    if (!this.win.isDestroyed()) {
      this.win.contentView.addChildView(this.view, 0);
      this.view.setBackgroundColor(this.defaultBackground);
    }
    this.sendNow();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    clearTimeout(this.timer);
    this.timer = null;
    uiContents.delete(this.webContentsId);
    if (!this.win.isDestroyed()) this.win.contentView.removeChildView(this.view);
    if (!this.view.webContents.isDestroyed()) this.view.webContents.close();
  }
}

module.exports = { HostUi };
