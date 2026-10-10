# Releasing EverythingApp

How to publish a release of the host, and how the signing behind it is set up. The mechanics follow Telemersive Gateway ([telemersion/telemersive-portbay](https://github.com/telemersion/telemersive-portbay), `docs/deployment.md`). The differences are noted where they matter.

## Overview

Pushing a tag `v<version>` runs [`.github/workflows/release.yml`](../../.github/workflows/release.yml). It produces:

- **macOS:** a DMG and a ZIP for Intel (`x64`) and Apple Silicon (`arm64`), signed with the ZHdK Developer ID and notarised. The DMG is for installing; `electron-updater` uses the ZIP.
- **Windows:** an NSIS installer (`x64`) that installs per user, without administrator rights. It is **unsigned** (see "Windows signing").
- **Update files:** `latest-mac.yml` and `latest.yml`, or `beta-mac.yml` and `beta.yml` for a pre-release, plus `.blockmap` files.

Everything goes into a GitHub Release in [telemersion/EverythingApp](https://github.com/telemersion/EverythingApp), with release notes generated from the commit messages. A tag with a `-` (`v0.1.0-beta.2`) becomes a pre-release.

Installed hosts check for updates 2 seconds after start and on Help → Check for Updates…. They download in the background and install when the host quits.

## Versions

`doc-host/package.json` `version` is the single source of the version number. The git tag is always `v` + that version, and the release workflow refuses a tag that does not match, before it builds anything.

| Release | Version |
| --- | --- |
| End of a milestone | next minor: `0.1.0` (end of M3), `0.2.0`, … |
| Fixes | patch: `0.1.1` |
| Trying the pipeline before a release | pre-release: `0.1.0-beta.1`, `0.1.0-beta.2`, … |

Release numbers count the host's milestones. They are independent of the host API version (`ev-host-api`) and the kit version, and a host release never changes a document.

A host on a pre-release version also sees newer pre-releases (`electron-updater` turns on `allowPrerelease` by itself). A host on a stable version only sees stable releases.

## Releasing a new version

`npm version` runs in `doc-host/`, which is not the root of the git repository, so it changes `package.json` and `package-lock.json` but makes **no commit and no tag**. Do these by hand:

```bash
cd doc-host
npm version 0.1.0-beta.1 --no-git-tag-version
cd ..
git add doc-host/package.json doc-host/package-lock.json
git commit -m "release: 0.1.0-beta.1"
git tag v0.1.0-beta.1
git push origin main v0.1.0-beta.1
```

Then watch the run: `gh run watch -R telemersion/EverythingApp`.

## The CI workflows

[`ci.yml`](../../.github/workflows/ci.yml) runs on every push to `main` and every pull request, on `macos-latest` and `windows-latest`: `npm test`, `npm run probe` (with `EV_PROBE_NETWORK=1`, so the probe also checks that the update host resolves) and `npm run smoke`.

[`release.yml`](../../.github/workflows/release.yml) runs on `v*` tags in three jobs:

1. **`build-mac`**: tag check → the same checks as CI → import the signing certificate into a temporary keychain → `npm run package -- --mac --publish never` (signs and notarises; adds about 5–10 minutes) → `npm run packaged-probe` (the escape probe against the signed app) → upload.
2. **`build-win`**: tag check → the same checks → `npm run package -- --win --publish never` → `npm run packaged-probe` → upload.
3. **`release`**: collects both uploads and publishes the GitHub Release.

A failing check stops the release before anything is uploaded.

## Signing and notarisation (macOS)

Without signing and notarisation, Gatekeeper blocks the app, and Squirrel.Mac (the macOS update mechanism) refuses to install updates. EverythingApp is signed by the same Apple team as Telemersive Gateway: **Developer ID Application: Zurcher Hochschule der Kunste (D95XR8PG48)**. Squirrel.Mac only installs an update signed by the same team as the installed app, so the team must not change between releases.

The workflow needs five repository secrets in `telemersion/EverythingApp` (Settings → Secrets and variables → Actions). They were set on 2026-10-10. GitHub never shows a secret again, so they are re-entered, not copied, when they change:

| Secret | Value | Renew when |
| --- | --- | --- |
| `APPLE_CERTIFICATE` | The Developer ID certificate with its private key, as a base64-encoded `.p12` | The certificate expires (5 years) or is revoked |
| `APPLE_CERTIFICATE_PASSWORD` | The password protecting that `.p12` | With the certificate |
| `APPLE_ID` | The Apple Account that submits for notarisation; a member of the ZHdK team | The person changes |
| `APPLE_APP_SPECIFIC_PASSWORD` | An app-specific password of that Apple Account, named `everythingapp-ci` | The Apple Account's password changes (that revokes every app-specific password) |
| `APPLE_TEAM_ID` | `D95XR8PG48` | Never |

To set one, from a terminal (the value never appears on screen):

```bash
# the certificate: export it from Keychain Access (My Certificates → the Developer ID → Export… → .p12)
base64 -i certificate.p12 | gh secret set APPLE_CERTIFICATE -R telemersion/EverythingApp
rm certificate.p12
# the others: gh asks for the value at a hidden prompt
gh secret set APPLE_CERTIFICATE_PASSWORD -R telemersion/EverythingApp
```

The app-specific password is created at [account.apple.com](https://account.apple.com) → Sign-In and Security → App-Specific Passwords (the account needs two-factor authentication).

**When it fails:**

- *"Import signing certificate"* fails: `APPLE_CERTIFICATE` and `APPLE_CERTIFICATE_PASSWORD` don't belong together.
- The build fails at notarisation with an authentication error: the app-specific password was revoked (the Apple Account's password changed) or `APPLE_ID` is wrong. Create a new password and set it again.
- Notarisation rejects the app: the log names the file. Usually a binary without hardened runtime, or a new native module.

## Windows signing

Windows builds are unsigned. On the first install, SmartScreen shows "Windows protected your PC" (More info → Run anyway). Updates install without that warning.

Signing was left out on purpose. Since June 2023, certificate authorities issue code-signing keys only on hardware tokens or cloud HSMs, so a newly bought certificate can't be exported into a CI secret, as portbay's deployment notes suggest. The likely way in is Azure Trusted Signing: electron-builder's `win.azureSignOptions` plus three secrets of an Azure service principal, with no change to the workflow's structure. It needs an identity validation that may or may not be available for ZHdK.

## Packaging

[`doc-host/electron-builder.yml`](../../doc-host/electron-builder.yml) holds the configuration:

- **Identity:** bundle id `ch.zhdk.telemersion.everythingapp`, name EverythingApp. Neither may change: updates are matched to the bundle id, and the name decides the data folder (version store, `workspace.json`, host log).
- **Electron fuses:** running as Node, `NODE_OPTIONS`, the inspector flags off; only the app archive loads, and its integrity is checked. Check a build with `npx @electron/fuses read --app <path to EverythingApp.app>`.
- **File association:** `.html` and `.htm`, as a possible handler (`Alternate`). The user makes EverythingApp the default; Help → Use EverythingApp for HTML Documents… explains how.
- **Windows:** per-user NSIS installer, so updates need no administrator rights.

## Local packaging

To build without a tag (macOS):

```bash
cd doc-host
npm run package -- --mac --dir --arm64 -c.mac.identity=-
npm run packaged-probe
```

`--dir` skips the DMG and ZIP. `-c.mac.identity=-` signs ad hoc: flipping the fuses breaks Electron's own signature, and macOS kills an unsigned, fused app at launch. The ad-hoc app runs only on the machine that built it. To build a Developer ID-signed app locally, leave out `-c.mac.identity=-` (the certificate must be in your keychain). Notarisation happens only if `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID` are set in the environment.

The packaged app run from `dist/` is not in Applications, so on a normal start it offers to move there. The packaged probe (`EV_PROBE=1`) skips that offer, the update check and the version store clean-up.

## Network

The host resolves no host names except the update hosts: `github.com`, `release-assets.githubusercontent.com` and `objects.githubusercontent.com` (`doc-host/src/resolver-rules.js`). If GitHub moves its release downloads to another host, updates fail with a name-resolution error in the host log (Help → Show Log). The new name then has to be added to that list in a release, and installed hosts need that release by hand.
