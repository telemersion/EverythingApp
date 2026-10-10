'use strict';

const { nextStatus, noticeFor, manualCheckSheet } = require('./update-state');

const FIRST_CHECK_MS = 2000;

// Host updates through electron-updater (M3): one check 2 s after start and
// on Help → Check for Updates…, the download runs in the background, the
// update installs when the host quits. A ready update becomes a workspace
// notice whose Restart Now quits through the close summary.
//
// updater: electron-updater's autoUpdater (a fake in tests); app, dialog:
// Electron's; workspace: setNotice, removeNotice, sheet, showError, quit;
// log: the host log. Only packaged builds check, never under EV_PROBE (probe),
// and on macOS only from the Applications folder, where updates can install.
// nativeUpdater (macOS: Electron's autoUpdater): electron-updater reports a
// download before Squirrel.Mac has fetched it; the update is ready, and
// installs on quit, only once Squirrel reports it downloaded too.
function createUpdates({ updater, app, workspace, log, dialog, packaged, platform, probe, nativeUpdater = null }) {
  let status = { state: 'idle' };
  let dismissedVersion = null;
  let fetchingVersion = null; // downloaded, Squirrel still fetching (macOS)

  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;

  const inApplications = () => platform !== 'darwin' || app.isInApplicationsFolder();
  const canCheck = () => packaged && !probe && inApplications();

  function onEvent(event) {
    status = nextStatus(status, event);
    if (event.type === 'downloaded') {
      const notice = noticeFor(status, dismissedVersion);
      if (notice) workspace.setNotice(notice);
    }
  }
  updater.on('checking-for-update', () => onEvent({ type: 'checking' }));
  updater.on('update-available', (info) => onEvent({ type: 'available', version: info.version }));
  updater.on('update-not-available', () => onEvent({ type: 'not-available' }));
  updater.on('update-downloaded', (info) => {
    if (!nativeUpdater) {
      onEvent({ type: 'downloaded', version: info.version });
      return;
    }
    fetchingVersion = info.version;
    if (!(status.state === 'ready' && status.version === info.version)) onEvent({ type: 'available', version: info.version });
  });
  if (nativeUpdater) {
    nativeUpdater.on('update-downloaded', () => {
      if (fetchingVersion) onEvent({ type: 'downloaded', version: fetchingVersion });
    });
  }
  updater.on('error', (err) => onEvent({ type: 'error', message: (err && err.message) || String(err) }));

  const restart = () => workspace.quit({ restart: true });

  return {
    status: () => status,

    // The automatic check: its errors go to the host log only.
    start() {
      if (!canCheck()) return;
      setTimeout(() => {
        let checking;
        try {
          checking = Promise.resolve(updater.checkForUpdates());
        } catch (err) {
          checking = Promise.reject(err);
        }
        checking.catch((err) => log.write('update check failed', err));
      }, FIRST_CHECK_MS);
    },

    // Help → Check for Updates…: always answers, in a sheet.
    async checkNow() {
      if (canCheck()) {
        try {
          await updater.checkForUpdates();
        } catch (err) {
          await workspace.showError({ action: 'check for updates', err });
          return;
        }
      }
      if (status.state === 'error' && canCheck()) {
        await workspace.showError({ action: 'check for updates', err: new Error(status.message) });
        return;
      }
      const sheet = manualCheckSheet({
        status, currentVersion: app.getVersion(), packaged: packaged && !probe, inApplications: inApplications(), platform,
      });
      if (!sheet) return;
      const { action, ...options } = sheet;
      const choice = await workspace.sheet({ type: 'info', ...options, defaultId: 0, cancelId: options.buttons.length - 1 });
      if (action === 'restart' && choice === 0) await restart();
    },

    // The update notice's buttons (the workspace removes it on dismiss).
    noticeAction(kind, action) {
      if (kind !== 'update') return;
      if (action === 'dismiss' && status.state === 'ready') dismissedVersion = status.version;
      if (action === 'restart') restart();
    },

    // The end of every confirmed quit (workspace.runQuit): a ready update
    // installs, silently, and relaunches the host when asked to.
    exit({ restart: relaunch = false } = {}) {
      if (status.state === 'ready') {
        // macOS ignores quitAndInstall's arguments and follows this flag.
        updater.autoRunAppAfterInstall = relaunch;
        updater.quitAndInstall(true, relaunch);
        return;
      }
      if (relaunch) app.relaunch();
      app.exit(0);
    },

    // macOS: before the workspace exists, offers to move the host to
    // Applications, the only place updates can install (App Translocation).
    // Resolves true once moved: this instance then ends and the moved one
    // starts, so the caller must not go on starting up (a workspace made now
    // would be torn down half-loaded).
    async offerMove() {
      if (platform !== 'darwin' || !packaged || probe || app.isInApplicationsFolder()) return false;
      const { response } = await dialog.showMessageBox({
        type: 'question',
        message: 'Move EverythingApp to the Applications folder?',
        detail: 'Updates only work from there.',
        buttons: ['Move', 'Not Now'],
        defaultId: 0,
        cancelId: 1,
      });
      if (response !== 0) return false;
      try {
        return app.moveToApplicationsFolder() === true; // true: quits and relaunches from there
      } catch (err) {
        await log.write('moving to Applications failed', err);
        return false;
      }
    },
  };
}

module.exports = { createUpdates, FIRST_CHECK_MS };
