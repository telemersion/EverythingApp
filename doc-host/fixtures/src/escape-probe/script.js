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
    try {
      pc.createDataChannel('probe');
      await pc.setLocalDescription(await pc.createOffer());
    } catch (err) {
      pc.close();
      report(name, false, 'could not start ICE gathering: ' + (err && err.message));
      return;
    }
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
  // Names never resolve inside the host, so name-based attempts can fail at
  // the lookup and hide the layers behind it. The IP literals skip the
  // lookup: this fetch is stopped by the content security policy, the STUN
  // attempt by IP address below by the WebRTC policy.
  await blockedFetch('fetch https by IP address', 'https://1.1.1.1/');
  await blockedFetch('fetch file://', 'file:///etc/hosts');
  await blockedFetch('fetch own origin', location.origin + '/other.html');
  await blockedImage('image from https', 'https://www.google.com/favicon.ico');
  await blockedImage('image from file://', 'file:///System/Library/CoreServices/Finder.app/Contents/Resources/Finder.icns');

  await noIceToServer('WebRTC reaches no STUN server', 'stun:stun.l.google.com:19302');
  await noIceToServer('WebRTC reaches no STUN server by IP address', 'stun:162.159.207.0:3478');

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

  // An iframe inside a shadow root is covered too (user styles pierce shadow
  // trees). A <frame> cannot be probed here: it needs a frameset as the
  // document body, which would destroy this page. The selector
  // "iframe, frame, frameset" covers it, as it does iframes.
  const shadowHost = document.createElement('div');
  const shadowFrame = document.createElement('iframe');
  shadowHost.attachShadow({ mode: 'open' }).append(shadowFrame);
  document.body.append(shadowHost);
  shadowFrame.style.setProperty('pointer-events', 'auto', 'important');
  const shadowPointer = getComputedStyle(shadowFrame).pointerEvents;
  report('iframes in shadow roots receive no pointer input', shadowPointer === 'none', shadowPointer);

  // The host UI (document list, tabs, banners) is out of reach: no bridge to
  // it, no way to load or open its page, no native dialog that could pass for
  // a host prompt, and no fullscreen that could cover it.
  report('no host-UI bridge', typeof window.evUi === 'undefined');
  await blockedFetch('fetch host UI', 'ev-ui://host/index.html');
  report('window.open host UI', !window.open('ev-ui://host/index.html'));
  const started = Date.now();
  alert('probe');
  report('alert does nothing', Date.now() - started < 1000);
  report('confirm returns false', confirm('probe') === false);
  try {
    await document.documentElement.requestFullscreen();
    report('fullscreen refused', false);
  } catch {
    report('fullscreen refused', true);
  }

  const before = location.href;
  location.href = 'https://example.com/';
  await new Promise((resolve) => setTimeout(resolve, 1000));
  report('navigation away', location.href === before);
  console.log('[probe] done');
})();
