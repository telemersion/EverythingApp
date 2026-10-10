# M3 "Distribution" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** EverythingApp ships as signed installers from the public `telemersion/EverythingApp`. It updates itself in the background, opens documents the operating system hands it, passes other HTML to the browser, and keeps its version store from growing forever.

**Architecture:** Release mechanics copy Telemersive Gateway (`telemersion/telemersive-portbay`: `release.yml`, `electron-builder.yml`, `electron-updater`), with the differences decided on 2026-10-10: per-user Windows install, Electron fuses, CI that tests and probes the packaged app, background download. New behaviour lives in small modules: pure rules (resolver rules, clean-up selection, update state, open routes) that unit tests cover without Electron, and thin Electron wrappers that receive their Electron objects as parameters, so the smoke test can pass fakes. The workspace's single restore notice becomes a list of notices, so the update notice uses the same host area.

**Tech Stack:** Node.js ≥ 22 (tested on 25.9), Electron 44.5, `electron-updater` 6 (first runtime dependency), `electron-builder` (dev), jsdom 30 (tests only), CommonJS, `node:test`, GitHub Actions.

**Spec:** [firstSpec.md](../../firstSpec.md) (M3 section, Host behaviour steps 1 and 9, Security model "Network", Compatibility "Host releases"), [glossary](../reference/glossary.md) (Distribution, Notice). The design decisions behind every task (M3 Q1–Q20, 2026-10-10) are logged in `.superpowers/sdd/decisions.md` (local). This plan restates each one where a task needs it.

## Global Constraints

Everything from the M1 and M2 Global Constraints still holds ([m1-loop.md](m1-loop.md#global-constraints), [m2-workspace.md](m2-workspace.md#global-constraints)), with one exception: the rule "no runtime dependencies" now allows exactly one, `electron-updater`. The commit trailer stays, verbatim:

```text
Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
```

New for M3:

- Bundle id `ch.zhdk.telemersion.everythingapp`; `productName` stays `EverythingApp` (the data folder must not move).
- Publish target: GitHub, owner `telemersion`, repo `EverythingApp`. The code moves there too (Task 10).
- Release numbers: the end of M3 is `0.1.0`; before it, `v0.1.0-beta.N` tags. The git tag is always `v` + `doc-host/package.json` version.
- macOS: DMG and ZIP, x64 and arm64, `hardenedRuntime`, signed with "Developer ID Application: Zurcher Hochschule der Kunste (D95XR8PG48)", notarised. Windows: x64 NSIS, `oneClick: false`, `perMachine: false`, unsigned.
- Fuses: `runAsNode: false`, `enableNodeOptionsEnvironmentVariable: false`, `enableNodeCliInspectArguments: false`, `onlyLoadAppFromAsar: true`, `enableEmbeddedAsarIntegrityValidation: true`.
- Resolver rules: `MAP * ~NOTFOUND` plus one `EXCLUDE <name>` per update host name, exact names only, never a wildcard.
- Updates: only packaged builds check; first check 2000 ms after start; `autoDownload` on; install when the host quits. Never under `EV_PROBE`.
- Version store clean-up: orphaned for 90 days → delete; cap `500 * 1024 * 1024` bytes; never a document's newest version; entries on an unmounted volume are skipped.
- Host log: `<userData>/logs/host.log`, rotated at 1 000 000 bytes to `host.log.1` (one old file).
- Background work that nobody asked for (update check, clean-up) never shows a sheet; it writes to the host log.
- Secrets in CI (already set, 2026-10-10): `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`.
- Nothing is pushed, tagged or archived on GitHub without the user's explicit go in that moment.

## Review Focus

These are the five conditions most likely to bite a user. The spec implies them, but no feature test covers them on its own. Each line names the task whose tests pin it.

1. **An open document whose file is missing during clean-up.** The user moved the file while it was open, and the "moved or deleted" banner promises that the last saved version stays in the version store. Expected: clean-up treats every open document's entry as live and never marks or deletes it. *(Task 4 `planCleanup` test "an open document's entry is live".)*
2. **Beta releases and their update files.** For a pre-release version, electron-builder names the update files after the channel (`beta-mac.yml`, `beta.yml`), not `latest*.yml`. portbay's upload list names only `latest*.yml`. Expected: the release uploads every `*.yml`, and a host on `beta.1` finds `beta.2`. *(Task 9 artifact patterns; Task 11 step "beta.1 updates to beta.2".)*
3. **The packaged probe on CI hitting a startup sheet.** On the macOS runner the packaged app runs outside Applications, so the Move sheet would block it forever. Expected: under `EV_PROBE`, no Move sheet, no update check, no clean-up. *(Task 6 test "no move offer and no check under EV_PROBE"; Task 8 packaged probe.)*
4. **A tag that doesn't match `package.json`.** `npm version` in `doc-host/` (not the git root) may skip the commit and tag. Expected: the release workflow refuses a tag that isn't `v` + the package version, before building anything. *(Task 9 "check tag" step; Task 1 spike on `npm version`.)*
5. **Quitting with a downloaded update while documents are dirty.** Expected: Restart Now and a plain quit both go through the close summary. Cancel keeps everything open and the update pending. After a confirmed quit, the update installs even though `runQuit` exits with `app.exit` (which skips the `quit` event `electron-updater` listens for). *(Task 6 test "exit installs a ready update"; smoke step "Restart Now goes through the close summary".)*

---

## File structure

```text
doc-host/
  electron-builder.yml      # NEW packaging, fuses, file association, publish
  build/
    icon.svg  icon.icns  icon.ico  icon.png   # NEW placeholder icon
  src/
    host-log.js             # NEW: append-only host log with one rotation
    resolver-rules.js       # NEW pure: UPDATE_HOSTS and the host-resolver-rules string
    cleanup.js              # NEW: version store clean-up (pure planCleanup + runCleanup)
    update-state.js         # NEW pure: updater events → status, notice, manual-check sheet
    updates.js              # NEW: electron-updater wiring, Move to Applications, exit/install
    open-route.js           # NEW pure: what happens to a non-document, per route
    browser.js              # NEW: hand a file to the app that handles https://
    help.js                 # NEW: Help sheets (HTML association, About on Windows)
    main.js                 # resolver rules, routes, updates, clean-up, log
    workspace.js            # notices list, open source, refuse() routes, exit hook
    ui-state.js             # notices list
    ui-intents.js           # 'notice' intent replaces 'dismiss-notice'
    ui/index.html ui/ui.js ui/ui.css   # one section per notice
    menu.js                 # Help menu, About panel
    open.js                 # refused result carries error codes
    probe.js                # main-process DNS lines
  tools/
    packaged-probe.js       # NEW: run the probe against the packaged app
    smoke.js                # update notice and Restart Now with a fake updater
    spikes/                 # Task 1 only, deleted before its commit
  test/
    host-log.test.js  resolver-rules.test.js  cleanup.test.js
    update-state.test.js  updates.test.js  open-route.test.js   # NEW
    ui-state.test.js  ui-intents.test.js  ui-page.test.js  open.test.js   # extended
.github/workflows/
  ci.yml                    # NEW
  release.yml               # NEW (from portbay)
docs/
  guides/releasing.md       # NEW deployment manual (from portbay's docs/deployment.md)
  architecture/distribution.md   # NEW (Task 12)
```

---

### Task 1: Spikes: update hosts, install on exit, Electron APIs, packaging

Five questions affect details of later tasks. Answer them with throwaway scripts in `doc-host/tools/spikes/` (run through `tools/start.js`-style spawning with `ELECTRON_RUN_AS_NODE` cleared), write the answers into "Spike results" at the end of this plan, delete the scripts, and commit the plan.

**Files:**

- Create (temporary): `doc-host/tools/spikes/*`
- Modify: `docs/plans/m3-distribution.md` ("Spike results")

- [ ] **Step 1: Update host names.** Install `electron-updater` and point it at portbay's public releases (`setFeedURL({ provider: 'github', owner: 'telemersion', repo: 'telemersive-portbay' })`, `forceDevUpdateConfig = true`, a fake current version of `0.0.1`). Log every URL through `session.fromPartition('electron-updater')` (or whatever session the spike finds `electron-updater` using) with `webRequest.onBeforeRequest`/`onBeforeRedirect` while it checks and downloads. Record every host name contacted, including redirects. That list becomes `UPDATE_HOSTS` in Task 3. Then repeat with `host-resolver-rules` set to `MAP * ~NOTFOUND` plus `EXCLUDE` of exactly that list, and record that check and download still succeed.
- [ ] **Step 2: Install on exit.** Read `electron-updater`'s `AppUpdater` and `MacUpdater`/`NsisUpdater` sources in `node_modules`. Record (a) which app event `autoInstallOnAppQuit` listens to, and whether `app.exit()` emits it; (b) what `quitAndInstall(isSilent, isForceRunAfter)` does on each platform; (c) whether `allowPrerelease` is on automatically when the current version is a pre-release; (d) which update file name (`latest-mac.yml` or `beta-mac.yml`) a `0.1.0-beta.1` host requests. Decision rule: Task 6's `exit()` calls `quitAndInstall` whenever an update is ready, unless (a) shows that `app.exit` already installs it on both platforms.
- [ ] **Step 3: Electron APIs.** In Electron 44 record: `session.defaultSession.resolveHost(name)` exists and rejects for a name mapped to `~NOTFOUND`; `app.getApplicationInfoForProtocol('https://')` returns `{ name, path }` on macOS (and the path of the browser `.app`); `app.isInApplicationsFolder()` and `app.moveToApplicationsFolder({ conflictHandler })` signatures. Decision rule: if `resolveHost` is missing, Task 3's DNS lines use `net.request` to `https://<name>/` and treat `net::ERR_NAME_NOT_RESOLVED` as "does not resolve".
- [ ] **Step 4: Packaging.** In a scratch copy of `doc-host/`, install `electron-builder` at portbay's version (`^25.1.8`). Check that it accepts the `electronFuses` block from Global Constraints, then run `npx electron-builder --mac --dir` with `CSC_IDENTITY_AUTO_DISCOVERY=false`. Record whether `npx @electron/fuses read --app <app>` shows the five fuses set, and whether the unsigned `--dir` app starts. If 25 lacks `electronFuses`, try the newest 26.x and record which version Task 8 pins.
- [ ] **Step 5: `npm version` in a subfolder.** In a scratch git repo with `pkg/package.json`, run `npm version 0.1.0-beta.1` inside `pkg/`. Record whether it commits and tags. The release guide (Task 9) documents whichever works: `npm version` alone, or `npm version <v> --no-git-tag-version` followed by `git commit` and `git tag v<v>`.
- [ ] **Step 6: Record and commit**

```bash
rm -r tools/spikes && git checkout package.json package-lock.json
git add ../docs/plans/m3-distribution.md
git commit -m "docs: M3 spike results"
```

---

### Task 2: Host log

Background work writes here instead of showing sheets (Q8, Q18.6).

**Files:**

- Create: `doc-host/src/host-log.js`, `doc-host/test/host-log.test.js`

**Interfaces:**

- Produces: `createHostLog(file: string, { maxBytes = 1_000_000, now = () => new Date() } = {}) → { file: string, write(message: string, err?: Error): Promise<void> }`. Each entry is one line `<ISO time> <message>` followed by `err.stack` lines if `err` is given. `write` never rejects; it creates the folder when needed. Before appending, a file at or over `maxBytes` is renamed to `<file>.1` (replacing an older one).

- [ ] **Step 1: Write the failing tests** in `test/host-log.test.js` (temp dirs via `fs.mkdtemp`, removed in `t.after`, decision D5):
  - `writes one timestamped line`: with `now` fixed to `2026-10-10T12:00:00.000Z`, `write('clean-up: 3 entries')` → file content `2026-10-10T12:00:00.000Z clean-up: 3 entries\n`.
  - `appends the stack of an error`: content contains the error's `stack`.
  - `rotates once at maxBytes`: with `maxBytes: 50`, after writes totalling > 50 bytes, `host.log.1` exists, `host.log` holds only the newest line, and a third rotation leaves exactly two files.
  - `never rejects`: `file` inside a path whose parent is a regular file → `write` resolves.
- [ ] **Step 2: Run** `npm test -- test/host-log.test.js`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `createHostLog` in `src/host-log.js` with `fs.promises` (`mkdir` recursive, `stat`, `rename`, `appendFile`). Serialise writes through one promise chain so rotation never races.
- [ ] **Step 4: Run** `npm test`. Expected: PASS, all suites.
- [ ] **Step 5: Commit** `feat(host): host log for background work`.

---

### Task 3: Resolver rules for the update hosts

Q6: exact `EXCLUDE`s, no wildcards; the dead proxy stays. A probe line pins the behaviour.

**Files:**

- Create: `doc-host/src/resolver-rules.js`, `doc-host/test/resolver-rules.test.js`
- Modify: `doc-host/src/main.js:13-15`, `doc-host/src/probe.js`

**Interfaces:**

- Produces: `UPDATE_HOSTS: readonly string[]` (the Task 1 list, for example `['github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com']`); `hostResolverRules(hosts = UPDATE_HOSTS) → string` = `'MAP * ~NOTFOUND, ' + hosts.map((h) => 'EXCLUDE ' + h).join(', ')`, which throws `TypeError` for any host that isn't a plain lower-case DNS name (`/^[a-z0-9-]+(\.[a-z0-9-]+)+$/`, so no `*`, no port, no scheme).
- Produces (probe): `mainProbeChecks({ resolveHost, expectNetwork }) → Promise<string[]>`, lines in the probe's `[probe] PASS|FAIL <name>` format:
  - `other names do not resolve`: `resolveHost('example.com')` rejects.
  - `update host resolves`: `resolveHost(UPDATE_HOSTS[0])` resolves. Only with `expectNetwork`; otherwise the line is `[probe] SKIP update host resolves (no EV_PROBE_NETWORK)`.

- [ ] **Step 1: Failing tests** `resolver-rules.test.js`: the exact string for `['github.com', 'a.example.org']` is `'MAP * ~NOTFOUND, EXCLUDE github.com, EXCLUDE a.example.org'`; `UPDATE_HOSTS` is frozen and has no `*`; `'*.github.com'`, `'github.com:443'`, `'https://github.com'` and `'GitHub.com'` throw. `mainProbeChecks` with a fake `resolveHost` that rejects everything except `UPDATE_HOSTS[0]` returns two PASS lines with `expectNetwork: true`, and PASS plus SKIP with `false`. One that resolves `example.com` returns a FAIL line.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement** both. In `main.js` replace the literal rule with `hostResolverRules()` and update the comment (the M3 exception is here now). In `probe.js`, `attachProbe(doc, { mainChecks })` prints the lines from `mainChecks` (a promise started at app ready with `session.defaultSession.resolveHost` and `expectNetwork: process.env.EV_PROBE_NETWORK === '1'`) and waits for them before it exits on `[probe] done`. A FAIL line fails the run. SKIP lines don't.
- [ ] **Step 4: Run** `npm test`, then `npm run probe` (offline is fine). Expected: all PASS lines, one SKIP, exit 0. Then `EV_PROBE_NETWORK=1 npm run probe` with network. Expected: no SKIP.
- [ ] **Step 5: Commit** `feat(host): only the update hosts resolve`.

---

### Task 4: Version store clean-up

Q8: skip only unmounted volumes; orphaned after the file (or its folder) is gone on a mounted volume; 90 days; 500 MB cap; never a newest version. The M1 store layout is unchanged: `<storeDir>/<pathKey>/` with `meta.json` (`path`, `fileName`, `docType`, `dataHash`, `lastSeen`) and version files named by UTC time, sorting by age ([write.js:14-61](../../doc-host/src/write.js)).

**Files:**

- Create: `doc-host/src/cleanup.js`, `doc-host/test/cleanup.test.js`
- Modify: `doc-host/src/main.js` (run after restore)

**Interfaces:**

- Consumes: `createHostLog` (Task 2) as `log.write`.
- Produces:
  - `volumeRoot(filePath: string, platform: string) → string`: darwin: `/Volumes/<name>` for paths under `/Volumes/<name>/`, else `/`. win32: `path.win32.parse(p).root` (`C:\`, `\\server\share\`). Others: `/`.
  - `planCleanup(entries, { now: Date, capBytes = CAP_BYTES, orphanDays = 90 }) → { mark: string[], unmark: string[], removeEntries: string[], removeVersions: string[] }`. `entries`: `[{ dir, meta, state: 'live'|'missing'|'unreachable', versions: [{ file, bytes }] }]`, versions oldest first. `mark`/`unmark`/`removeEntries` are entry dirs; `removeVersions` are version file paths.
  - `runCleanup({ storeDir, now = new Date(), openPaths: Set<string>, platform = process.platform, log }) → Promise<{ removedEntries: number, removedVersions: number }>`: reads the entries, decides each one's `state` (open path or file exists → live; volume root inaccessible → unreachable; otherwise missing), applies the plan (`meta.orphanedSince = now.toISOString()` for mark, delete the field for unmark, `fs.rm` recursive for entries, `fs.unlink` for versions) and logs one summary line. An entry without a readable `meta.json` is left alone and logged.
  - `CAP_BYTES = 500 * 1024 * 1024`, `ORPHAN_DAYS = 90`.

Rules `planCleanup` implements, in order:

1. `missing` without `meta.orphanedSince` → mark. `live` with it → unmark. `unreachable` → nothing changes (counts as live below).
2. `missing` with `orphanedSince` at least `orphanDays` days before `now` → remove the entry.
3. If the remaining entries' version bytes exceed `capBytes`: remove whole orphaned entries, oldest `orphanedSince` first, until under the cap. Then remove single versions of live and unreachable entries, globally oldest file name first, never an entry's newest version, until under the cap or nothing removable is left.

- [ ] **Step 1: Failing tests** `cleanup.test.js`, pure first:
  - `volumeRoot`: `/Volumes/Ddrive/03_personal/a.ev.html` → `/Volumes/Ddrive`; `/Users/x/a.ev.html` → `/`; win32 `D:\docs\a.ev.html` → `D:\`; `\\srv\share\a.ev.html` → `\\srv\share\`.
  - `marks a missing entry once`; `unmarks an entry whose file is back`; `leaves an unreachable entry alone` (even with `orphanedSince` 200 days old).
  - `removes an entry orphaned 90 days ago` and `keeps one orphaned 89 days ago`.
  - `cap removes the oldest orphan first`, then `cap removes the oldest versions of live entries next`, and `cap never removes a newest version` (one live entry of 3 × 300 MB with cap 500 MB → only the two older versions are removed, the result is still over the cap, no throw).
  - `an open document's entry is live` (Review Focus 1, tested through `runCleanup` with a temp store whose `meta.path` doesn't exist but is in `openPaths`).
  - `runCleanup` end to end on a temp store: writes `orphanedSince` into `meta.json`, deletes a 91-day orphan, leaves a corrupt `meta.json` entry and logs it.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement** `src/cleanup.js`. In `main.js`, after `workspace.restore()` and outside the `EV_PROBE` path: `runCleanup({ storeDir, openPaths: new Set(workspace.openDocuments().map((d) => d.filePath)), log }).catch((err) => log.write('clean-up failed', err))`, not awaited.
- [ ] **Step 4: Run** `npm test` and `npm run smoke`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(host): clean up the version store at start`.

---

### Task 5: Notices

The one restore notice becomes a list. Each notice has its own message, items and buttons. The update notice (Task 6) is the second kind. Copy for the restore notice is unchanged.

**Files:**

- Modify: `doc-host/src/workspace.js` (`this.notice` → `this.notices`, intent handling, list forced visible while any notice exists), `doc-host/src/ui-state.js`, `doc-host/src/ui-intents.js`, `doc-host/src/ui/index.html`, `doc-host/src/ui/ui.js`, `doc-host/src/ui/ui.css`, `doc-host/tools/smoke.js`
- Test: `doc-host/test/ui-state.test.js`, `doc-host/test/ui-intents.test.js`, `doc-host/test/ui-page.test.js`

**Interfaces:**

- Produces (main side): `workspace.notices: Array<{ kind: 'restore', failed: [{ path, reason }] } | { kind: 'update', version: string }>`; `workspace.setNotice(notice)` (replaces any notice of the same kind, then pushes state); `workspace.removeNotice(kind)`; `workspace.onNoticeAction: (kind, action) => void` (default no-op; Task 6 sets it for `update`).
- Produces (UI state): `notices: [{ kind, message, items: [{ label, reason }], actions: [{ id, label }] }]`, replacing `notice`. Restore: message `NOTICE_MESSAGE` (unchanged), actions `[{ id: 'dismiss', label: 'OK' }]`. Update: message `` `EverythingApp ${version} is ready. It installs when you quit.` ``, no items, actions `[{ id: 'restart', label: 'Restart Now' }, { id: 'dismiss', label: 'Later' }]`.
- Produces (intent): `{ type: 'notice', kind: 'restore'|'update', action: 'dismiss'|'restart' }` replaces `{ type: 'dismiss-notice' }`. `restart` is valid only with `kind: 'update'`. Any `dismiss` removes that notice; `restart` calls `onNoticeAction('update', 'restart')`.

- [ ] **Step 1: Failing tests:** `ui-state` builds both notice kinds with the exact copy above and orders them restore first; `ui-intents` accepts the four valid shapes and rejects `restart` for `restore`, unknown kinds and extra fields; `ui-page` (jsdom) renders two notice sections with their own buttons, and clicking Later sends `{ type: 'notice', kind: 'update', action: 'dismiss' }`. Inserted text stays `textContent` (M2 constraint).
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.** In `index.html`, an empty `<div id="notices">`; `ui.js` builds one `<section class="notice" role="status">` per notice. `workspace.restore()` sets the restore notice through `setNotice`.
- [ ] **Step 4: Run** `npm test` and `npm run smoke` (the existing restore-notice step still passes, through the new intent). Expected: PASS.
- [ ] **Step 5: Commit** `refactor(host): a list of workspace notices`.

---

### Task 6: Host updates, Move to Applications and the Help menu

Q5, Q17, Q18.1–5. `electron-updater` downloads in the background and installs when the host quits. The notice offers Restart Now, which quits through the close summary. On macOS, a host outside Applications offers to move there before restore.

**Files:**

- Create: `doc-host/src/update-state.js`, `doc-host/src/updates.js`, `doc-host/src/help.js`, `doc-host/test/update-state.test.js`, `doc-host/test/updates.test.js`
- Modify: `doc-host/package.json` (`dependencies: { "electron-updater": "^6.8.9" }`), `doc-host/src/main.js`, `doc-host/src/workspace.js` (`quit({ restart })`, `exit` hook, newer-API button), `doc-host/src/open.js` (refused result gets `codes`), `doc-host/src/menu.js`, `doc-host/tools/smoke.js`, `doc-host/test/open.test.js`

**Interfaces:**

- Consumes: `workspace.setNotice/removeNotice/onNoticeAction` (Task 5); `createHostLog` (Task 2).
- Produces (pure, `update-state.js`):
  - `nextStatus(status, event) → status`. Statuses: `{ state: 'idle' }`, `{ state: 'checking' }`, `{ state: 'downloading', version }`, `{ state: 'ready', version }`, `{ state: 'current' }`, `{ state: 'error', message }`. Events: `{ type: 'checking' }`, `{ type: 'available', version }`, `{ type: 'not-available' }`, `{ type: 'downloaded', version }`, `{ type: 'error', message }`. `ready` stays `ready` on a later `checking`, `not-available` or `error` (the downloaded update still installs).
  - `noticeFor(status, dismissedVersion) → { kind: 'update', version } | null`: only in `ready`, and only if `version !== dismissedVersion`.
  - `manualCheckSheet({ status, currentVersion, packaged, inApplications, platform }) → { message, detail, buttons, action?: 'restart' }`. Exact copy:
    - not packaged → `Updates are only available in installed builds.` / `` / `['OK']`
    - darwin and not `inApplications` → `Updates can't install from here.` / `Move EverythingApp to the Applications folder, then open it from there.` / `['OK']`
    - `current` → `You're up to date.` / `` `EverythingApp ${currentVersion} is the newest version.` `` / `['OK']`
    - `downloading` → `` `EverythingApp ${version} is downloading.` `` / `It installs when you quit. You can keep working.` / `['OK']`
    - `ready` → `` `EverythingApp ${version} is ready.` `` / `It installs when you quit.` / `['Restart Now', 'Later']`, with `action: 'restart'` for button 0
    - `error` is not a sheet descriptor: the caller shows `workspace.showError({ action: 'check for updates', err })`.
- Produces (`updates.js`): `createUpdates({ updater, app, workspace, log, packaged, platform, probe }) → { start(), checkNow(): Promise<void>, exit({ restart }): void, offerMove(): Promise<void>, status() }`.
  - `updater` is `electron-updater`'s `autoUpdater` (a fake in tests). It sets `autoDownload = true` and `autoInstallOnAppQuit = true`, and maps updater events through `nextStatus`. On `ready` it calls `workspace.setNotice(noticeFor(…))`. `Later` stores `dismissedVersion` for this run.
  - `start()`: nothing if `!packaged` or `probe`, or if on darwin and not in Applications. Otherwise one check after 2000 ms. Errors of automatic checks go only to `log.write('update check failed', err)`.
  - `checkNow()`: runs a check when allowed, then shows `manualCheckSheet` through `workspace.sheet`. A `ready` sheet's Restart Now behaves like the notice's.
  - Restart Now (notice or sheet) → `workspace.quit({ restart: true })`.
  - `exit({ restart })` replaces `app.exit(0)` at the end of `workspace.runQuit()` (`workspace.exit = (opts) => updates.exit(opts)`). If an update is `ready`: `updater.quitAndInstall(true, restart)`. Else if `restart`: `app.relaunch(); app.exit(0)`. Else `app.exit(0)`. (Adjust per Task 1 Step 2.)
  - `offerMove()`: only on darwin, packaged, not `probe`, and `!app.isInApplicationsFolder()`. It shows an app-modal message box before restore: `Move EverythingApp to the Applications folder?` / `Updates only work from there.` / `['Move', 'Not Now']`. Move → `app.moveToApplicationsFolder()`, which relaunches; a failure is logged and the start continues. `main.js` awaits it before `workspace.restore()`.
- Produces (`help.js`): `htmlAssociationSheet(platform) → { message, detail, buttons: ['OK'] }`, message `Use EverythingApp for HTML documents`, detail for darwin: `In Finder, select any .html file and choose File → Get Info. Under "Open with", pick EverythingApp, then click Change All.`; for win32: `Right-click any .html file and choose Open with → Choose another app. Pick EverythingApp and select Always.` `aboutSheet({ version, electron }) → { message: 'EverythingApp', detail: `Version ${version}\nElectron ${electron}`, buttons: ['OK'] }`.
- Produces (`open.js`): `{ kind: 'refused', filePath, report, codes: string[] }`. `workspace.refuse` shows buttons `['Check for Updates', 'Copy report', 'OK']` when `codes` includes `'api-newer'`, and button 0 calls `workspace.checkForUpdates()` (set by `main.js` to `updates.checkNow`).
- Menu: Help → `Check for Updates…`, `Use EverythingApp for HTML Documents…`, `Show Log` (`shell.showItemInFolder(log.file)` after creating the file if it's missing), and on non-macOS `About EverythingApp`. On macOS, `app.setAboutPanelOptions({ applicationName: 'EverythingApp', applicationVersion: app.getVersion(), version: `Electron ${process.versions.electron}` })` (the `appMenu` role already has About).

- [ ] **Step 1: Failing tests** `update-state.test.js`: every transition above; `ready` survives `checking`, `not-available` and `error`; `noticeFor` respects `dismissedVersion`; each `manualCheckSheet` case with its exact copy.
- [ ] **Step 2: Failing tests** `updates.test.js` with a fake `updater` (an `EventEmitter` with `checkForUpdates`, `quitAndInstall`), a fake `app`, a fake `workspace` and fake timers (`t.mock.timers`):
  - `checks once 2000 ms after start in a packaged build`; `never checks unpackaged`; `no move offer and no check under EV_PROBE` (Review Focus 3); `no automatic check outside Applications on darwin`.
  - `downloaded sets the update notice`; `Later hides it for this version only` (a newer `downloaded` shows again).
  - `exit installs a ready update` (`quitAndInstall(true, false)`), `exit with restart and a ready update` (`quitAndInstall(true, true)`), `exit without update` (`app.exit(0)`), `restart without update` (`app.relaunch` then `app.exit(0)`) (Review Focus 5).
  - `an automatic check error goes to the log, not a sheet`; `a manual check error shows the error sheet`.
- [ ] **Step 3: Failing test** in `open.test.js`: a document declaring `ev-host-api` `99` → `kind: 'refused'` with `codes` `['api-newer']`.
- [ ] **Step 4: Run** them. Expected: FAIL.
- [ ] **Step 5: Implement** the modules, the `workspace.quit({ restart })`/`exit` hook, the menu and the `main.js` wiring (`offerMove()` → `restore()` → `updates.start()`).
- [ ] **Step 6: Smoke steps** in `tools/smoke.js` with a fake updater passed to `createUpdates`: `downloaded` → the update notice appears in the UI state; with one dirty document, the notice's Restart Now → the close summary appears (stubbed Cancel) → nothing closes, the notice stays; then stubbed Save all → `exit({ restart: true })` reaches the fake `quitAndInstall(true, true)` (the smoke replaces `workspace.exit`, so the process doesn't really exit).
- [ ] **Step 7: Run** `npm test`, `npm run smoke`, `npm run probe`. Expected: PASS. Then `npm start` and check by hand that Help → Check for Updates… says `Updates are only available in installed builds.`
- [ ] **Step 8: Commit** `feat(host): background host updates and the Help menu`.

---

### Task 7: Where non-documents go

Q7, Q16: a non-document that the operating system sent goes to the app that handles `https://`, launched with the file directly, never through the file association (if EverythingApp is the `.html` default, that would loop). Drops and Open… keep the sheet. Restore names it in the notice (unchanged).

**Files:**

- Create: `doc-host/src/open-route.js`, `doc-host/src/browser.js`, `doc-host/test/open-route.test.js`
- Modify: `doc-host/src/workspace.js` (`open(rawPath, { paneId, source })`, `refuse`, pending opens keep `source`), `doc-host/src/main.js` (OS routes pass `source: 'os'`)

**Interfaces:**

- Produces: `nonDocumentAction(source: 'os'|'user') → 'browser'|'sheet'` (unknown source → `'sheet'`). `workspace.open(rawPath, { paneId, source = 'user' })`; `main.js` passes `source: 'os'` for `open-file`, `second-instance` and launch argv.
- Produces: `openInBrowser(filePath, { app, spawn = child_process.spawn, platform = process.platform }) → Promise<boolean>`. It finds the browser with `app.getApplicationInfoForProtocol('https://')`. On darwin it spawns `open -a <info.path> <filePath>`; on win32 it spawns `<info.path> <filePath>`, detached, `stdio: 'ignore'`, `unref()`. It returns `false` without spawning when no handler is found, or when the handler's path is EverythingApp's own (`app.getPath('exe')` or its `.app` bundle). `refuse()` falls back to the sheet on `false`.

- [ ] **Step 1: Failing tests:** `nonDocumentAction` for `'os'`, `'user'`, `undefined`; `openInBrowser` with a fake `app` and `spawn`: darwin spawns `['open', ['-a', '/Applications/Google Chrome.app', '/tmp/a.html']]`; win32 spawns the exe with the path; a handler that is EverythingApp itself → `false` and no spawn; a rejecting `getApplicationInfoForProtocol` → `false`.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement** and wire. The drop route (`open-files` intent) and the Open dialog keep `source: 'user'`.
- [ ] **Step 4: Smoke step:** `workspace.open(<temp plain .html>, { source: 'os' })` with `openInBrowser` stubbed calls the stub once and shows no sheet; the same file with `source: 'user'` shows the "not an EverythingApp document" sheet (stubbed).
- [ ] **Step 5: Run** `npm test` and `npm run smoke`. Expected: PASS.
- [ ] **Step 6: Commit** `feat(host): non-documents from the system open in the browser`.

---

### Task 8: Packaging

The unsigned local build has to work before CI signs it. Version pins come from Task 1 Step 4.

**Files:**

- Create: `doc-host/electron-builder.yml`, `doc-host/build/icon.svg` (+ generated `icon.icns`, `icon.ico`, `icon.png` 1024×1024), `doc-host/tools/packaged-probe.js`
- Modify: `doc-host/package.json` (devDependency `electron-builder`, `@electron/fuses`; scripts `"package": "electron-builder"`, `"packaged-probe": "node tools/packaged-probe.js"`), `.gitignore` (`doc-host/dist/`)

**Interfaces:**

- Produces: `electron-builder.yml` with: `appId: ch.zhdk.telemersion.everythingapp`, `productName: EverythingApp`, `directories: { buildResources: build, output: dist }`. `files`: `src/**`, `kit/**`, `package.json`, excluding `test`, `tools`, `fixtures`. `fileAssociations: [{ ext: [html, htm], name: HTML Document, role: Viewer, rank: Alternate }]`. `mac`: dmg + zip for x64 and arm64, `artifactName: EverythingApp-${version}-${arch}.${ext}`, `identity: "Developer ID Application"`, `hardenedRuntime: true`, no custom entitlements (electron-builder's defaults suffice: no camera, no microphone). `win`: nsis x64, `artifactName: EverythingApp-Setup-${version}.${ext}`. `nsis: { oneClick: false, perMachine: false, allowToChangeInstallationDirectory: false }`. `electronFuses` as in Global Constraints. `publish: { provider: github, owner: telemersion, repo: EverythingApp }`.
- Produces: `node tools/packaged-probe.js [app executable]` runs the packaged executable (default: `dist/mac-arm64/EverythingApp.app/Contents/MacOS/EverythingApp` on darwin, `dist/win-unpacked/EverythingApp.exe` on win32) with `EV_PROBE=1` and `fixtures/escape-probe.ev.html`, passes `EV_PROBE_NETWORK` through, and exits with the probe's exit code. It fails with a clear message if the executable is missing.

- [ ] **Step 1: Icon.** Draw a simple placeholder `build/icon.svg` (a page shape with a plain "E"; no resemblance to any existing brand), render it to `icon.png` (1024²) and to `icon.icns`/`icon.ico` with `sips`/`iconutil` (macOS) or a one-off script. Commit only the outputs and the SVG.
- [ ] **Step 2: Build locally, unsigned:** `CSC_IDENTITY_AUTO_DISCOVERY=false npm run package -- --mac --dir`. Expected: `dist/mac-arm64/EverythingApp.app`.
- [ ] **Step 3: Packaged probe:** `npm run packaged-probe`. Expected: the same PASS lines as `npm run probe`, exit 0 (no Move sheet, Review Focus 3). Then `npx @electron/fuses read --app dist/mac-arm64/EverythingApp.app` shows the five fuses, and `ELECTRON_RUN_AS_NODE=1 dist/.../EverythingApp -e "console.log(1)"` does **not** print `1`.
- [ ] **Step 4: Bundle id and data folder:** `defaults read dist/mac-arm64/EverythingApp.app/Contents/Info.plist CFBundleIdentifier` prints `ch.zhdk.telemersion.everythingapp`, and `CFBundleDocumentTypes` lists `html`/`htm` with `LSHandlerRank` `Alternate`. Start the packaged app once with a test document (a `/tmp` copy with a distinctive name, as in M2) and confirm it uses `~/Library/Application Support/EverythingApp`.
- [ ] **Step 5: Run** `npm test`. Expected: PASS.
- [ ] **Step 6: Commit** `build(host): package with electron-builder and fuses`.

---

### Task 9: CI and the release guide

Q12, Q14: `ci.yml` on every push to `main`; `release.yml` on `v*` tags, portbay's three jobs plus checks. All steps run in `doc-host/`.

**Files:**

- Create: `.github/workflows/ci.yml`, `.github/workflows/release.yml`, `docs/guides/releasing.md`

**Interfaces:**

- `ci.yml`: `on: push: branches: [main]` and `pull_request`. One job, matrix `os: [macos-latest, windows-latest]`, `defaults.run.working-directory: doc-host`, `actions/setup-node@v4` with Node 22 and npm cache on `doc-host/package-lock.json`. Steps: `npm ci`, `npm test`, `npm run probe` with `EV_PROBE_NETWORK: '1'`, `npm run smoke`.
- `release.yml`: `on: push: tags: ['v*']`. Jobs `build-mac` (macos-latest), `build-win` (windows-latest), `release` (ubuntu-latest, `needs` both, `permissions: contents: write`).
  - Each build job: checkout → setup-node 22 → **check tag** (`node -e` comparing `process.env.GITHUB_REF_NAME` with `'v' + require('./package.json').version`, failing with both values printed; Review Focus 4) → `npm ci` → `npm test` → `npm run probe` → `npm run smoke`. Then (mac only) portbay's "Import signing certificate into a dedicated keychain" step, verbatim, with the same secrets. Then `npm run package -- --mac --publish never` (mac, env `CSC_KEYCHAIN`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`) or `npm run package -- --win --publish never` (win). Then `npm run packaged-probe` with `EV_PROBE_NETWORK: '1'`. Then `actions/upload-artifact@v4` with `doc-host/dist/*.dmg`, `*.zip`, `*.blockmap`, `*.yml` (mac) or `*.exe`, `*.blockmap`, `*.yml` (win). Every `*.yml`, never only `latest*.yml` (Review Focus 2).
  - `release`: download both artifacts into `dist`, then `softprops/action-gh-release@v2` with `files: dist/*`, `generate_release_notes: true`, `prerelease: ${{ contains(github.ref_name, '-') }}`.
- `docs/guides/releasing.md`: portbay's `docs/deployment.md`, adapted. Versioning (the git tag is `v` + `doc-host/package.json` version, with the command sequence from Task 1 Step 5); beta tags before `0.1.0`; the CI jobs; the five secrets and how to renew them (the app-specific password dies when the Apple Account password changes); why Windows is unsigned (keys on hardware since June 2023) and where Azure Trusted Signing would plug in (`win.azureSignOptions`); local packaging (`--dir`, `CSC_IDENTITY_AUTO_DISCOVERY=false`); what to do when notarisation fails.

- [ ] **Step 1: Write** both workflows and the guide.
- [ ] **Step 2: Lint** the workflows locally: `npx --yes action-validator .github/workflows/ci.yml .github/workflows/release.yml` (or `actionlint` if installed). Expected: no errors.
- [ ] **Step 3: Commit** `ci: test on every push, sign and publish on tags`. The workflows first run in Task 10/11.

---

### Task 10: Move the repository to `telemersion/EverythingApp`

Q3: full history, public; `maybites/EverythingApp` archived. **Every GitHub action in this task needs the user's explicit go at that moment.**

**Files:**

- Possibly modify: `.claude/settings.json` (tracked, contains local paths), `.gitignore`

- [ ] **Step 1: Pre-publication check.** List for the user: tracked files with personal paths (`git grep -n "/Users/\|/Volumes/"`; on 2026-10-10 only `.claude/settings.json`); `git log --all --format='%an <%ae>' | sort -u` (author identities that become public); large files in history (`git rev-list --objects --all | git cat-file --batch-check | sort -k3 -n | tail`); and the sample data in `hours-sheet.html` and the fixtures. Ask the user what to change. Untrack `.claude/settings.json` (`git rm --cached`, add it to `.gitignore`) only if the user says so; it stays in history either way. Say so.
- [ ] **Step 2: On the user's go:** `git remote rename origin maybites`, `git remote add origin git@github.com:telemersion/EverythingApp.git`, `git push -u origin main`. Expected: `ci.yml` starts. Watch it with `gh run watch -R telemersion/EverythingApp`.
- [ ] **Step 3: Make CI green.** Fix what fails on the runners (Windows paths, display for smoke), each fix its own commit. If `smoke` is flaky on hosted runners (fails, then passes on rerun without a change), report to the user, who decides whether it becomes non-blocking (Q12).
- [ ] **Step 4: On the user's go:** archive the old repository (`gh repo archive maybites/EverythingApp`) and set its description to point to `telemersion/EverythingApp`.

---

### Task 11: First betas

Q11: at least two beta releases, to prove signing, notarisation and a real update.

- [ ] **Step 1: On the user's go:** set version `0.1.0-beta.1` with the command sequence in `releasing.md`, push `main` and the tag. Watch `release.yml`. Expected: green, and a pre-release in `telemersion/EverythingApp` with two DMGs, two ZIPs, the Windows `.exe`, blockmaps and the channel `.yml` files. The keychain import step proves `APPLE_CERTIFICATE`/`_PASSWORD`; the notarise step proves the other three secrets.
- [ ] **Step 2: Verify the signature** on the downloaded arm64 DMG: `spctl --assess --type open --context context:primary-signature -v <dmg>`, mount, `spctl --assess -vv /Volumes/EverythingApp*/EverythingApp.app` → `accepted, source=Notarized Developer ID`; `xcrun stapler validate` on the app.
- [ ] **Step 3: The user installs beta.1** from the DMG (talk them through it; Move to Applications appears if they start it from the DMG).
- [ ] **Step 4: On the user's go:** release `0.1.0-beta.2` (any small commit, for example a release-guide tweak). Expected: within a minute of the next start, beta.1 shows "EverythingApp 0.1.0-beta.2 is ready. It installs when you quit."; Restart Now comes back on beta.2 with the workspace restored (Review Focus 2 and 5).
- [ ] **Step 5:** Record results and anything changed in "Beta results" at the end of this plan; commit `docs: M3 beta results`.

---

### Task 12: Acceptance walk-through, docs and 0.1.0

**Files:**

- Create: `docs/architecture/distribution.md`
- Modify: `docs/plans/m3-distribution.md` ("Acceptance results"), `firstSpec.md` (M3 done line, the user story's first criterion, "To document" rows moved), `docs/reference/glossary.md` if terms changed

- [ ] **Step 1: Write `docs/architecture/distribution.md`** (the current solution only): release pipeline, signing (Developer ID, notarisation, Windows unsigned), packaging and fuses, the update flow (states, notice, quit and install, Move to Applications), the resolver rules and why the names are exact, file association and non-document routes, version store clean-up rules, host log. Move the M3 rows of firstSpec's "To document" table into it and delete those rows there.
- [ ] **Step 2: Walk through the 13 acceptance criteria** (Q20) with the user at the keyboard, on installed builds, and record each result in "Acceptance results":
  1. A `v*` tag builds signed, notarised macOS DMG/ZIP (x64, arm64) and the Windows installer, the packaged probe passes, and a release with update files appears.
  2. A fresh Mac install from the DMG raises no Gatekeeper warning.
  3. Windows installs without admin rights; at most one SmartScreen warning.
  4. Starting from the DMG offers Move to Applications; the app then runs from Applications.
  5. beta → newer release: notice, Restart Now through the close summary, restored workspace; a plain quit installs too.
  6. Check for Updates: up to date; offline error sheet; dev build "installed builds only".
  7. Open With lists EverythingApp; after Change All a double-click opens a document as a tab; a non-document HTML opens in the browser without a loop; a dropped non-document gets the sheet.
  8. Only the update hosts resolve (packaged probe lines).
  9. The fuses are set; `ELECTRON_RUN_AS_NODE` doesn't turn the app into Node.
  10. Clean-up keeps unplugged-volume entries, marks and deletes orphans, enforces the cap, keeps newest versions (unit tests plus one look at a real store with the Ddrive unplugged).
  11. The newer-API refusal offers Check for Updates.
  12. The code is in `telemersion/EverythingApp` with full history; `maybites/EverythingApp` is archived.
  13. M1/M2 still pass: unit tests, probe and smoke in CI on macOS and Windows.
- [ ] **Step 3: Update `firstSpec.md`:** tick the user story's first criterion with the M3 evidence, and change the last line of "Code session plan" to "M3 passed its acceptance walk-through on <date>, results in docs/plans/m3-distribution.md".
- [ ] **Step 4: Commit** `docs: record M3 acceptance results`.
- [ ] **Step 5: On the user's go:** release `0.1.0` (not a pre-release). Testers on betas update to it.

---

## Known limits of M3 (by design)

- Windows builds are unsigned: SmartScreen warns once per installed release until reputation builds.
- Move to Applications relaunches without the files the user may have double-clicked in the same moment; they need opening again.
- Clean-up treats a missing file as orphaned even if it was only renamed; the history of a moved document isn't re-linked (non-goal).
- Update checks need `github.com` and the asset host names reachable; behind a proxy that blocks them, the automatic check fails silently and the manual check shows the error.
- A document can still look up one of the fixed update host names through dns-prefetch; the lookup carries no data.

## Spike results (filled in by Task 1)

Recorded 2026-10-10 on macOS 26 (arm64), Electron 44.5.1, electron-updater 6.8.x.

1. **Update host names.** `electron-updater` (GitHub provider) against portbay's public releases contacted exactly `github.com` (`releases.atom`, then a 302 to `/releases/tag/<tag>`) and `release-assets.githubusercontent.com` (update file and download, after a 302 from `github.com`). With `MAP * ~NOTFOUND, EXCLUDE github.com, EXCLUDE release-assets.githubusercontent.com, EXCLUDE objects.githubusercontent.com` the check found 0.2.2 and the download started (113 MB). `electron-updater` uses its own session `session.fromPartition('electron-updater', { cache: false })`, which has no dead proxy. `UPDATE_HOSTS` = these three names: `objects.githubusercontent.com` is the former asset host and stays in case GitHub falls back to it.
2. **Install on exit.** `app.exit(0)` emits the `quit` event with exit code 0 (not `before-quit` or `will-quit`). `electron-updater`'s install-on-quit (`BaseUpdater.addQuitHandler`, Windows) listens to exactly that, so a plain quit installs a ready update. On macOS, with `autoInstallOnAppQuit`, the download is handed to Squirrel.Mac at once and installs when the app ends. `quitAndInstall(isSilent, isForceRunAfter)` sets `quitAndInstallCalled`, so the quit handler doesn't install twice. Task 6 keeps the explicit `quitAndInstall` for a ready update (harmless, and needed for Restart Now). `allowPrerelease` is on automatically when the current version has a pre-release part. A `0.1.0-beta.N` host asks for the channel file of its tag (`beta-mac.yml`/`beta.yml`) and falls back to `latest*.yml`.
3. **Electron APIs.** `session.defaultSession.resolveHost('example.com')` rejects with `net::ERR_NAME_NOT_RESOLVED` under the rules and resolves `github.com`. `app.getApplicationInfoForProtocol('https://')` returned `{ name: 'Firefox', path: '/Applications/Firefox.app' }` (plus an icon). `app.isInApplicationsFolder()` and `app.moveToApplicationsFolder()` exist. `--host-resolver-rules=…` as a command-line switch works the same as `appendSwitch`.
4. **Packaging.** electron-builder 25.1.8 (portbay's) has no `electronFuses` option; **26.15.3** has it, and an arm64 `--dir` build shows the five fuses set (`@electron/fuses read`). A build with `CSC_IDENTITY_AUTO_DISCOVERY=false` is unsigned, and macOS kills it at launch (SIGKILL: flipping fuses breaks Electron's ad-hoc signature). Local builds therefore use ad-hoc signing, `-c.mac.identity=-` (electron-builder warns about library validation; the app ran fine). The ad-hoc app passed the probe (23 PASS, exit 0). With `ELECTRON_RUN_AS_NODE=1` it started as EverythingApp instead of Node, and treated the `-e` code as a file to open (an error sheet appeared). So a runtime check of that fuse shows a sheet; `@electron/fuses read` is the check to use.
5. **`npm version` in a subfolder.** In `pkg/` of a git repo, `npm version 0.1.0-beta.1` updated `package.json` but made no commit and no tag. Releases use `npm version <v> --no-git-tag-version`, then `git commit` and `git tag v<v>`.

## Beta results (filled in by Task 11)

Recorded 2026-10-10.

1. **v0.1.0-beta.1** ([release](https://github.com/telemersion/EverythingApp/releases/tag/v0.1.0-beta.1)): `release.yml` passed on the first try. The keychain import proved `APPLE_CERTIFICATE` and `APPLE_CERTIFICATE_PASSWORD`; notarisation proved `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID`. The packaged probe passed on both platforms. Assets: DMG and ZIP for arm64 and x64, `EverythingApp-Setup-0.1.0-beta.1.exe`, blockmaps, `latest-mac.yml` and `latest.yml`. electron-builder named the update files `latest*` even for a beta (Review Focus 2 expected `beta*`; uploading every `*.yml` covers both, and a beta host falls back to `latest*`), and the release is marked as a pre-release.
2. **Signature:** the app in the arm64 DMG is `accepted, source=Notarized Developer ID`, origin `Developer ID Application: Zurcher Hochschule der Kunste (D95XR8PG48)`, stapled (`stapler validate` passed), bundle id `ch.zhdk.telemersion.everythingapp`. The DMG itself is unsigned (electron-builder's default, as in portbay): Gatekeeper checks the app inside.
3. **Install (the user):** downloaded in the browser, opened from the DMG: only macOS's usual "downloaded from the Internet" question, no developer warning; the Move to Applications sheet moved the app and it relaunched from `/Applications`; About showed 0.1.0-beta.1. **Found:** right after Move, an error sheet "EverythingApp could not show the document list and tabs" (`ERR_FAILED (-2) loading 'ev-ui://host/index.html'`). `app.moveToApplicationsFolder()` quits the old instance a moment after it returns, and the old instance had gone on to create the workspace. Fixed in 7e36211: a successful move ends the start-up. A restart from Applications showed no error. The probe now also checks that the host UI loads (`[probe] PASS host UI loads`, also in a local packaged build).
4. **v0.1.0-beta.2** ([release](https://github.com/telemersion/EverythingApp/releases/tag/v0.1.0-beta.2)), with the fix: Help → Check for Updates… on the running beta.1 reported the download; the notice "EverythingApp 0.1.0-beta.2 is ready. It installs when you quit." appeared; with an unsaved document, Restart Now showed the save prompt and Cancel kept everything open with the notice; Restart Now again with Save quit, installed and came back on 0.1.0-beta.2 with the workspace restored (the user, 2026-10-10).

## Acceptance results (filled in by Task 12)
