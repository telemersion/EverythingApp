'use strict';

// Tells messages of the current page load from those of earlier loads. The
// preload makes a random id per load and announces it ('doc:hello') before
// it sends anything else. A reload retires the current id first (begin()),
// so a change signal or snapshot still in flight from the old page cannot
// count for the new one, and a retired id is never accepted again.
class LoadTags {
  constructor() {
    this.current = null;
    this.retired = new Set();
  }

  // A page announces itself. It becomes the current load unless its id was
  // retired; a page has one load at a time, so a new id retires the old one.
  hello(loadId) {
    if (typeof loadId !== 'string' || this.retired.has(loadId)) return false;
    if (this.current !== null && this.current !== loadId) this.retired.add(this.current);
    this.current = loadId;
    return true;
  }

  // A new load starts: nothing from the current one counts any more.
  begin() {
    if (this.current !== null) this.retired.add(this.current);
    this.current = null;
  }

  accepts(loadId) {
    return typeof loadId === 'string' && loadId === this.current;
  }
}

module.exports = { LoadTags };
