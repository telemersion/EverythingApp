'use strict';

// Pure: when a document's thumbnail is captured (Decision Q10). The caller
// does the capturing; timers are injected for the tests.
//
//   loaded(docId, visible)    first load: at once if visible, or hidden and captureHidden
//   hidden / saved / reloaded at once; each cancels a pending change capture
//   changed(docId, visible)   visible: (re)starts the delayMs timer; hidden: nothing
//   firstShown(docId)         a document loaded hidden is shown for the first time: 'load'
//                             capture after paintMs (its view may not have painted yet),
//                             only if still shown() then; any other capture cancels it
//   forget(docId)             cancels
function createThumbnailTriggers({
  capture,
  delayMs = 2000,
  captureHidden = true,
  paintMs = 200,
  shown = () => true,
  setTimeout = globalThis.setTimeout,
  clearTimeout = globalThis.clearTimeout,
}) {
  const timers = new Map(); // docId → pending change capture

  const firstShows = new Map(); // docId → pending first-show load capture

  const cancel = (docId) => {
    if (firstShows.has(docId)) {
      clearTimeout(firstShows.get(docId));
      firstShows.delete(docId);
    }
    if (timers.has(docId)) {
      clearTimeout(timers.get(docId));
      timers.delete(docId);
    }
  };
  const now = (docId, reason) => {
    cancel(docId);
    capture(docId, reason);
  };

  return {
    loaded(docId, visible) {
      if (visible || captureHidden) now(docId, 'load');
    },
    hidden: (docId) => now(docId, 'hidden'),
    saved: (docId) => now(docId, 'saved'),
    reloaded: (docId) => now(docId, 'reloaded'),
    changed(docId, visible) {
      if (!visible) return;
      cancel(docId);
      timers.set(docId, setTimeout(() => {
        timers.delete(docId);
        capture(docId, 'changed');
      }, delayMs));
    },
    firstShown(docId) {
      cancel(docId);
      firstShows.set(docId, setTimeout(() => {
        firstShows.delete(docId);
        if (shown(docId)) capture(docId, 'load');
      }, paintMs));
    },
    forget: cancel,
  };
}

module.exports = { createThumbnailTriggers };
