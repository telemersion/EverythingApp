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

  // PASS when ICE gathering finds no server-reflexive or relay candidate,
  // i.e. the STUN server was never reached.
  async function noIceToServer(name, stunUrl) {
    let pc;
    try {
      pc = new RTCPeerConnection({ iceServers: [{ urls: stunUrl }] });
    } catch (err) {
      report(name, true, 'RTCPeerConnection unavailable');
      return;
    }
    const types = [];
    pc.onicecandidate = (e) => {
      if (e.candidate) types.push(e.candidate.type || (/ typ (\w+)/.exec(e.candidate.candidate) || [])[1]);
    };
    const complete = new Promise((resolve) => {
      pc.onicegatheringstatechange = () => { if (pc.iceGatheringState === 'complete') resolve(); };
    });
    pc.createDataChannel('probe');
    await pc.setLocalDescription(await pc.createOffer());
    await Promise.race([complete, new Promise((resolve) => setTimeout(resolve, 3000))]);
    pc.close();
    const external = types.filter((t) => t === 'srflx' || t === 'relay');
    report(name, external.length === 0, types.join(',') || 'no candidates');
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

  await noIceToServer('WebRTC reaches no STUN server', 'stun:stun.l.google.com:19302');

  const opened = window.open('https://example.com/');
  report('window.open', !opened);

  const violations = [];
  document.addEventListener('securitypolicyviolation', (e) => violations.push(e.blockedURI));
  const frame = document.createElement('iframe');
  frame.src = 'https://example.com/';
  document.body.append(frame);
  await new Promise((resolve) => setTimeout(resolve, 500));
  report('iframe to https', violations.some((uri) => uri.startsWith('https://example.com')));

  // The host's user style wins over the document's own !important rules.
  const override = document.createElement('style');
  override.textContent = 'iframe { pointer-events: auto !important; }';
  document.head.append(override);
  frame.style.setProperty('pointer-events', 'auto', 'important');
  const pointerEvents = getComputedStyle(frame).pointerEvents;
  report('iframes receive no pointer input', pointerEvents === 'none', pointerEvents);

  const before = location.href;
  location.href = 'https://example.com/';
  await new Promise((resolve) => setTimeout(resolve, 1000));
  report('navigation away', location.href === before);
  console.log('[probe] done');
})();
