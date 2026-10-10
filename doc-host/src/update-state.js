'use strict';

// Pure: the host update's status from electron-updater's events, the notice
// it shows and the sheet a manual check answers with.
//
// status: { state: 'idle' } | { state: 'checking' } | { state: 'downloading', version }
//       | { state: 'ready', version } | { state: 'current' } | { state: 'error', message }
// event:  { type: 'checking' } | { type: 'available', version } | { type: 'not-available' }
//       | { type: 'downloaded', version } | { type: 'error', message }

// A downloaded update stays ready through later checks and errors: it still
// installs when the host quits.
function nextStatus(status, event) {
  switch (event.type) {
    case 'checking':
      return status.state === 'ready' ? status : { state: 'checking' };
    case 'available':
      return { state: 'downloading', version: event.version };
    case 'not-available':
      return status.state === 'ready' ? status : { state: 'current' };
    case 'downloaded':
      return { state: 'ready', version: event.version };
    case 'error':
      return status.state === 'ready' ? status : { state: 'error', message: event.message };
    default:
      return status;
  }
}

// The workspace notice for a ready update, unless the user chose Later for
// that version in this run.
function noticeFor(status, dismissedVersion) {
  if (status.state !== 'ready' || status.version === dismissedVersion) return null;
  return { kind: 'update', version: status.version };
}

// What Help → Check for Updates… answers once the check is done. null when
// there is no sheet: an error is shown as an error report instead.
function manualCheckSheet({ status, currentVersion, packaged, inApplications, platform }) {
  if (!packaged) return { message: 'Updates are only available in installed builds.', detail: '', buttons: ['OK'] };
  if (platform === 'darwin' && !inApplications) {
    return {
      message: "Updates can't install from here.",
      detail: 'Move EverythingApp to the Applications folder, then open it from there.',
      buttons: ['OK'],
    };
  }
  switch (status.state) {
    case 'current':
      return { message: "You're up to date.", detail: `EverythingApp ${currentVersion} is the newest version.`, buttons: ['OK'] };
    case 'downloading':
      return { message: `EverythingApp ${status.version} is downloading.`, detail: 'It installs when you quit. You can keep working.', buttons: ['OK'] };
    case 'ready':
      return { message: `EverythingApp ${status.version} is ready.`, detail: 'It installs when you quit.', buttons: ['Restart Now', 'Later'], action: 'restart' };
    default:
      return null;
  }
}

module.exports = { nextStatus, noticeFor, manualCheckSheet };
