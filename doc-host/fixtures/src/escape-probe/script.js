// Escape probe: tries everything a document must not be able to do and
// reports each attempt as PASS (blocked) or FAIL (possible). Run it with
// `npm run probe`; the host prints the results and exits 1 on any FAIL.
// Data shape: {"runs":0}
(async function () {
  'use strict';

  const doc = EvKit.init();
  const list = document.createElement('ul');
  document.getElementById('ev-app').append(list);

  function report(name, pass, detail) {
    const line = `[probe] ${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' (' + detail + ')' : ''}`;
    const li = document.createElement('li');
    li.className = pass ? 'pass' : 'fail';
    li.textContent = line;
    list.append(li);
    console.log(line);
  }

  async function blockedFetch(name, url) {
    try {
      await fetch(url);
      report(name, false, 'request succeeded');
    } catch {
      report(name, true);
    }
  }

  function blockedImage(name, url) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => { report(name, false, 'image loaded'); resolve(); };
      img.onerror = () => { report(name, true); resolve(); };
      img.src = url;
    });
  }

  report('runs inside the host', doc.hosted);
  report('host API is data-only', Object.keys(window.evHost).sort().join(',') === 'markDirty,onSaveRequest,version',
    Object.keys(window.evHost).join(','));
  report('no Node.js in the page', typeof require === 'undefined' && typeof process === 'undefined');
  report('storage starts empty', localStorage.length === 0);
  localStorage.setItem('probe', 'set');

  await blockedFetch('fetch https', 'https://example.com/');
  await blockedFetch('fetch file://', 'file:///etc/hosts');
  await blockedFetch('fetch own origin', location.origin + '/other.html');
  await blockedImage('image from https', 'https://www.google.com/favicon.ico');
  await blockedImage('image from file://', 'file:///System/Library/CoreServices/Finder.app/Contents/Resources/Finder.icns');

  const opened = window.open('https://example.com/');
  report('window.open', !opened);

  const violations = [];
  document.addEventListener('securitypolicyviolation', (e) => violations.push(e.blockedURI));
  const frame = document.createElement('iframe');
  frame.src = 'https://example.com/';
  document.body.append(frame);
  await new Promise((resolve) => setTimeout(resolve, 500));
  report('iframe to https', violations.some((uri) => uri.startsWith('https://example.com')));

  const before = location.href;
  location.href = 'https://example.com/';
  await new Promise((resolve) => setTimeout(resolve, 1000));
  report('navigation away', location.href === before);
  console.log('[probe] done');
})();
