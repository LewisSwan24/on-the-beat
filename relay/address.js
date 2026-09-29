// ON THE BEAT — the network an address counts as, for the per-address limits
// (docs/superpowers/specs/2026-09-29-staff-security-design.md §2).
//
// An IPv6 network is handed out as a /64 at least, so whoever is on one holds 2^64 addresses and would get a fresh
// allowance for each. Its /64 is what is counted. An IPv4-mapped IPv6 address is the IPv4 address it wraps.

import { isIPv4, isIPv6 } from 'node:net';

/** The eight 16-bit groups of an IPv6 address in the compressed form a URL hostname has. */
function groupsOf(compressed) {
  const [head, tail] = compressed.split('::');
  const front = head ? head.split(':') : [];
  const back = tail ? tail.split(':') : [];
  return [...front, ...new Array(8 - front.length - back.length).fill('0'), ...back].map((g) => parseInt(g, 16));
}

/** What `address` counts as: its /64 (`2001:db8:1:2::/64`), the IPv4 address a mapped one wraps, or itself. */
export function addressKey(address) {
  const text = String(address ?? '');
  const bare = text.split('%')[0];   // a zone is not part of the network
  if (isIPv4(bare) || !isIPv6(bare)) return text;
  // A URL writes an address in one canonical form, the embedded IPv4 tail of a mapped address as two hex groups.
  const g = groupsOf(new URL('http://[' + bare + ']/').hostname.slice(1, -1));
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return [g[6] >> 8, g[6] & 255, g[7] >> 8, g[7] & 255].join('.');
  return g.slice(0, 4).map((x) => x.toString(16)).join(':') + '::/64';
}
