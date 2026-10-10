# Distribution

How EverythingApp reaches people's machines and keeps itself current: releases, signing, packaging, host updates, the one network exception, the file association, and the background housekeeping that comes with an installed host. How to cut a release is in [docs/guides/releasing.md](../guides/releasing.md).

## Releases

The code and its releases live in the public repository [telemersion/EverythingApp](https://github.com/telemersion/EverythingApp). A tag `v<version>` runs [`.github/workflows/release.yml`](../../.github/workflows/release.yml), which publishes a GitHub Release with:

- macOS: a DMG (for installing) and a ZIP (for updates), each for arm64 and x64;
- Windows: an x64 NSIS installer;
- the update files `latest-mac.yml` and `latest.yml`, and a `.blockmap` per package for differential downloads.

A version with a pre-release part (`0.1.0-beta.2`) becomes a GitHub pre-release. Release numbers count the host's milestones (the end of M3 is 0.1.0) and are independent of the host API version and the kit version; a host release never changes a document.

Before anything is uploaded, each platform's job runs the unit tests, the escape probe and the smoke test against the source, then the escape probe against the packaged app (`tools/packaged-probe.js`). That last step catches packaging mistakes that the source checks can't see: a file missing from the archive, a broken fuse, a host UI that doesn't load.

## Signing

On macOS, Electron's update mechanism (Squirrel.Mac) only installs into apps that are signed and notarised, and it only accepts an update signed by the same team as the installed app. Every macOS build is therefore signed with **Developer ID Application: Zurcher Hochschule der Kunste (D95XR8PG48)**, with hardened runtime, notarised and stapled. The DMG itself is not signed; Gatekeeper checks the app inside it.

Windows builds are unsigned. SmartScreen warns once on the first install of a release ("Windows protected your PC"); updates install without it.

## Packaging

[`doc-host/electron-builder.yml`](../../doc-host/electron-builder.yml) packs `src/`, `kit/` and `package.json` into an asar archive. Its one runtime dependency is `electron-updater`.

**Identity.** The bundle id `ch.zhdk.telemersion.everythingapp` (also the Windows AppUserModelID) and the name EverythingApp are permanent: updates are matched to the bundle id, and the name decides the data folder (`~/Library/Application Support/EverythingApp`, `%APPDATA%\EverythingApp`) that holds the version store, `workspace.json` and the host log.

**Fuses.** Flipped in the Electron binary at packaging time: `runAsNode`, `enableNodeOptionsEnvironmentVariable` and `enableNodeCliInspectArguments` are off, `onlyLoadAppFromAsar` and `enableEmbeddedAsarIntegrityValidation` are on. Documents could never use these (they can't set environment variables or command-line flags). The fuses keep other software on the machine from running its own code under EverythingApp's signature and permissions. Flipping them breaks Electron's ad-hoc signature, so even a local build must be signed (ad hoc with `-c.mac.identity=-`) to start on Apple Silicon.

**Windows install.** Per user, into `%LOCALAPPDATA%\Programs\EverythingApp`, without administrator rights, so that an update can install quietly when the host quits, also on managed machines.

## Host updates

`src/updates.js` drives `electron-updater` (GitHub provider). `src/update-state.js` holds the rules as pure functions.

1. **When it checks.** Once, 2 seconds after start, and when the user chooses Help → Check for Updates…. Only packaged builds check, never under the probe (`EV_PROBE`), and on macOS only from the Applications folder.
2. **Download.** In the background, without asking. A host on a pre-release also sees newer pre-releases; a host on a stable release sees only stable ones (`electron-updater` sets `allowPrerelease` from the running version).
3. **Ready.** A notice at the top of the document list: "EverythingApp 0.2.0 is ready. It installs when you quit." with **Restart Now** and **Later**. Later hides it for that version, for this run.
4. **Install.** On every confirmed quit. `Workspace.runQuit()` ends with `workspace.exit({ restart })`, which `main.js` routes to `updates.exit()`: with a ready update it calls `quitAndInstall(true, restart)`; otherwise `app.exit(0)`, after `app.relaunch()` when restarting. Restart Now is `workspace.quit({ restart: true })`, so the close summary (or the single document's save prompt) runs first: Cancel keeps everything open and the update pending. The workspace is written and restored as on any quit.
5. **Errors.** The automatic check reports nothing but a line in the host log. A manual check answers in a sheet every time: up to date, downloading, ready (with Restart Now), "only available in installed builds" (development), "can't install from here" (macOS outside Applications), or the error report.

**Move to Applications (macOS).** An app started from its DMG, or from a quarantined Downloads folder, runs from a read-only random location (App Translocation), where Squirrel.Mac can't install anything. At start, before the workspace exists, a packaged host outside Applications asks "Move EverythingApp to the Applications folder? Updates only work from there." Move calls `app.moveToApplicationsFolder()`, which quits this instance a moment later and starts the moved one; the start-up stops there, so no half-made workspace is torn down. Not Now starts normally, without automatic update checks.

A document that needs a newer host API is refused with a sheet that offers **Check for Updates** as well as Copy report.

## Network

The host resolves no host names except the update hosts. `main.js` sets Chromium's `host-resolver-rules` to `MAP * ~NOTFOUND, EXCLUDE github.com, EXCLUDE release-assets.githubusercontent.com, EXCLUDE objects.githubusercontent.com` (`src/resolver-rules.js`). The update check uses `github.com` (`releases.atom`, then a redirect to the release) and `release-assets.githubusercontent.com` (update file and download); `objects.githubusercontent.com` is the former asset host.

These rules apply to the whole app: Chromium has one resolver, and a session can't have rules of its own. The exceptions are therefore exact names, never wildcards. A document could at most look up one of these fixed names through dns-prefetch, and such a lookup carries no data. Documents still can't connect anywhere: every document session and the host-UI session go through a proxy that refuses every connection, and the documents' content security policy allows no network requests. `electron-updater` uses its own session (`electron-updater` partition) in the main process, which has no such proxy.

The probe checks both sides from the main process: `example.com` must not resolve, and with `EV_PROBE_NETWORK=1` (CI) `github.com` must.

## File association

Neither macOS nor Windows 10 and later lets an app make itself the default handler of a file type, and macOS can't tell `.ev.html` from `.html` (only the last extension counts). The host therefore registers as a **possible** handler for `.html` and `.htm`: `LSHandlerRank` `Alternate` on macOS, an Open With entry (per user) on Windows. The user makes it the default (Finder: Get Info → Open with → Change All; Windows: Open with → Choose another app → Always); Help → Use EverythingApp for HTML Documents… shows these steps.

A file is a document if and only if it contains the `ev-host-api` meta tag. What happens to any other file depends on how it arrived (`src/open-route.js`):

| Route | Non-document goes to |
| --- | --- |
| The operating system: double-click, Open With, Finder's `open-file`, the command line (first instance or `second-instance`) | the browser |
| The user, inside EverythingApp: dropped on the window, picked in Open… | the "not an EverythingApp document" sheet |
| Workspace restore | the restore notice ("not an EverythingApp document") |

"The browser" is the app that handles `https://` links (`app.getApplicationInfoForProtocol('https://')`), started with the file directly: `open -a <browser> <file>` on macOS, `<browser.exe> <file>` on Windows (`src/browser.js`). The file never goes back through the file association: when EverythingApp is the default for `.html`, that would send it straight back to the host. If no browser is found, or the handler is EverythingApp itself, the sheet appears instead.

## Version store clean-up

Once per start, after the workspace is restored, in the background (`src/cleanup.js`). Each entry of the version store is one folder per document path, with a `meta.json` (path, file name, document type, data hash, last seen) and the versions, named by time.

- **Live:** the file exists, or the document is open (an open document whose file was moved still counts as live, because its "moved or deleted" banner promises that the last saved version stays). A live entry that was marked orphaned is unmarked.
- **Unreachable:** the volume is not mounted (macOS: `/Volumes/<name>` is missing; Windows: the drive or share root). Left alone, never marked, never deleted.
- **Missing:** the file is gone from a mounted volume, even when its whole folder is gone. Marked with `orphanedSince` in `meta.json`; deleted once it has been orphaned for 90 days.
- **Size cap:** above 500 MiB of versions in total, the oldest orphans go first, then the oldest versions of live and unreachable documents. A document's newest version is never deleted.

An entry whose `meta.json` can't be read is left alone. A moved or renamed document starts a new entry under its new path; the old one becomes an orphan (re-linking it is not built).

## Host log

Background work that nobody asked for reports to `<userData>/logs/host.log` instead of a sheet: the update check and `electron-updater`'s warnings and errors, and the clean-up's summary and problems (`src/host-log.js`). One line per entry, `<ISO time> <message>`, followed by an error's stack. At 1 000 000 bytes the file moves to `host.log.1`, replacing the older one. Help → Show Log reveals it. Nothing in it ever leaves the machine.
