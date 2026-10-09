'use strict';

// Pure: when a document's thumbnail is captured (Decision Q10). The caller
// does the capturing; timers are injected for the tests.
//
//   loaded(docId, visible)    first load: visible: 'load' capture after paintMs (the page has
//                             finished loading but may not have painted yet), only if still
//                             shown() then; hidden: at once if captureHidden
//   hidden / saved / reloaded at once; each cancels a pending change capture
//   changed(docId, visible)   visible: (re)starts the delayMs timer; hidden: nothing
//   firstShown(docId)         a document loaded hidden is shown for the first time: the same
//                             deferred 'load' capture as a visible load
//                             (any other capture or a visible change cancels it)
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

  // The first 'load' capture waits for a paint, and only happens if still shown then.
  const loadAfterPaint = (docId) => {
    cancel(docId);
    firstShows.set(docId, setTimeout(() => {
      firstShows.delete(docId);
      if (shown(docId)) capture(docId, 'load');
    }, paintMs));
  };

  return {
    loaded(docId, visible) {
      if (visible) loadAfterPaint(docId);
      else if (captureHidden) now(docId, 'load');
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
    firstShown: loadAfterPaint,
    forget: cancel,
  };
}

module.exports = { createThumbnailTriggers };
