'use strict';

// The host resolves no names except the update hosts. Chromium's
// host-resolver-rules apply to the whole app, document sessions included, so
// the exceptions are exact names, never wildcards: a document could at most
// look up one of these fixed names, which carries no data. The update check
// uses github.com (releases.atom, then a redirect to the release) and the
// asset host it redirects to; objects.githubusercontent.com is the former
// asset host (M3 spike results).
const UPDATE_HOSTS = Object.freeze([
  'github.com',
  'release-assets.githubusercontent.com',
  'objects.githubusercontent.com',
]);

const PLAIN_NAME = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;

function hostResolverRules(hosts = UPDATE_HOSTS) {
  for (const host of hosts) {
    if (typeof host !== 'string' || !PLAIN_NAME.test(host)) {
      throw new TypeError(`Not a plain host name: ${JSON.stringify(host)}`);
    }
  }
  return ['MAP * ~NOTFOUND', ...hosts.map((h) => `EXCLUDE ${h}`)].join(', ');
}

// Probe lines from the main process (EV_PROBE): other names do not resolve,
// the first update host does (only with expectNetwork, since offline it
// cannot). resolveHost: session.resolveHost.
async function mainProbeChecks({ resolveHost, expectNetwork }) {
  const resolves = (name) => resolveHost(name).then(() => true, () => false);
  const lines = [];
  lines.push(await resolves('example.com')
    ? '[probe] FAIL other names do not resolve (example.com resolved)'
    : '[probe] PASS other names do not resolve');
  if (!expectNetwork) {
    lines.push('[probe] SKIP update host resolves (no EV_PROBE_NETWORK)');
  } else {
    lines.push(await resolves(UPDATE_HOSTS[0])
      ? '[probe] PASS update host resolves'
      : `[probe] FAIL update host resolves (${UPDATE_HOSTS[0]} did not resolve)`);
  }
  return lines;
}

module.exports = { UPDATE_HOSTS, hostResolverRules, mainProbeChecks };
