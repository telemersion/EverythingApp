'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { UPDATE_HOSTS, hostResolverRules, mainProbeChecks } = require('../src/resolver-rules');

test('the rules map every name to "not found" except the given hosts', () => {
  assert.equal(hostResolverRules(['github.com', 'a.example.org']),
    'MAP * ~NOTFOUND, EXCLUDE github.com, EXCLUDE a.example.org');
});

test('the default rules exclude exactly the update hosts', () => {
  assert.equal(hostResolverRules(),
    'MAP * ~NOTFOUND, EXCLUDE github.com, EXCLUDE release-assets.githubusercontent.com, EXCLUDE objects.githubusercontent.com');
});

test('UPDATE_HOSTS is frozen and has no wildcard', () => {
  assert.ok(Object.isFrozen(UPDATE_HOSTS));
  assert.ok(UPDATE_HOSTS.every((h) => !h.includes('*')));
});

test('anything but a plain lower-case DNS name is refused', () => {
  for (const bad of ['*.github.com', 'github.com:443', 'https://github.com', 'GitHub.com', 'localhost', '']) {
    assert.throws(() => hostResolverRules([bad]), TypeError, bad);
  }
});

const resolvesOnly = (name) => async (host) => {
  if (host === name) return { endpoints: [{ address: '20.0.0.1', family: 'ipv4' }] };
  throw new Error('net::ERR_NAME_NOT_RESOLVED');
};

test('main probe checks pass when only the update host resolves', async () => {
  assert.deepEqual(await mainProbeChecks({ resolveHost: resolvesOnly(UPDATE_HOSTS[0]), expectNetwork: true }), [
    '[probe] PASS other names do not resolve',
    '[probe] PASS update host resolves',
  ]);
});

test('without EV_PROBE_NETWORK the update host check is skipped', async () => {
  assert.deepEqual(await mainProbeChecks({ resolveHost: resolvesOnly(UPDATE_HOSTS[0]), expectNetwork: false }), [
    '[probe] PASS other names do not resolve',
    '[probe] SKIP update host resolves (no EV_PROBE_NETWORK)',
  ]);
});

test('a resolving example.com fails the probe', async () => {
  const lines = await mainProbeChecks({ resolveHost: resolvesOnly('example.com'), expectNetwork: true });
  assert.equal(lines[0], '[probe] FAIL other names do not resolve (example.com resolved)');
  assert.ok(lines[1].startsWith('[probe] FAIL update host resolves'));
});
