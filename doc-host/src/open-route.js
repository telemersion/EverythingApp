'use strict';

// Pure: what happens to a file that is not a document, by the route it came
// on (M3). The operating system sent it ('os': double-click, Open With, the
// command line): it goes to the browser, since the user asked the system, not
// EverythingApp, to open it. The user dropped it or picked it in Open…
// ('user'): the "not an EverythingApp document" sheet answers them.
function nonDocumentAction(source) {
  return source === 'os' ? 'browser' : 'sheet';
}

module.exports = { nonDocumentAction };
