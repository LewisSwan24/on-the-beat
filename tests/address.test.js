// ON THE BEAT — the network an address counts as, for the per-address limits
// (docs/superpowers/specs/2026-09-29-staff-security-design.md §2).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addressKey } from '../relay/address.js';

test('an IPv6 address counts as its /64, however it is written', () => {
  for (const same of ['2001:db8:1:2:3:4:5:6', '2001:DB8:0001:0002::7', '2001:db8:1:2:ffff:ffff:ffff:ffff', '2001:db8:1:2::']) {
    assert.equal(addressKey(same), '2001:db8:1:2::/64', same);
  }
  assert.notEqual(addressKey('2001:db8:1:3::1'), addressKey('2001:db8:1:2::1'), 'another /64 is another network');
  assert.equal(addressKey('2001:db8::1'), '2001:db8:0:0::/64');
  assert.equal(addressKey('::1'), '0:0:0:0::/64');
  assert.equal(addressKey('fe80::1%eth0'), 'fe80:0:0:0::/64', 'a zone is not part of the network');
});

test('an IPv4-mapped IPv6 address is the IPv4 address it wraps, and an IPv4 address is itself', () => {
  assert.equal(addressKey('::ffff:203.0.113.5'), '203.0.113.5');
  assert.equal(addressKey('::FFFF:cb00:7105'), '203.0.113.5');
  assert.equal(addressKey('203.0.113.5'), '203.0.113.5');
});

test('anything that is not an address is left as it is, and nothing throws', () => {
  for (const x of ['', 'not-an-address', '1.2.3', '2001:db8::zz', '[::1]', undefined, null]) assert.equal(addressKey(x), String(x ?? ''), String(x));
});
