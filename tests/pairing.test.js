import { test } from 'node:test';
import assert from 'node:assert/strict';
import { codeFrom, pairUrl } from '../app/lib/pairing.js';

test('a pairing address carries the four letters, and gives them back', () => {
  assert.equal(pairUrl('https://otb.example/', 'NQJA'), 'https://otb.example/pair/NQJA');
  assert.equal(codeFrom(pairUrl('https://otb.example', 'NQJA')), 'NQJA');
  assert.equal(codeFrom('http://192.168.1.20:8790/pair/nqja/'), 'NQJA', 'lower case, and a trailing slash');
  assert.equal(codeFrom('https://otb.example/pair/NQJA?from=camera'), 'NQJA', 'a query string');
  assert.equal(codeFrom('  nqja  '), 'NQJA', 'the letters on their own');
});

test('anything else is not a wristband code, and is not trimmed until it looks like one', () => {
  const not = [
    '', 'NQJ', 'NQJAB', 'NQIA', 'N0JA', 'NQ JA',
    'https://otb.example/', 'https://otb.example/pair/', 'https://otb.example/pair/NQIA',
    'https://otb.example/pair/NQJA/more', 'https://otb.example/band/NQJA', 'https://otb.example/pair/%E0%A4%A',
    'WIFI:S:venue;T:WPA;P:secret;;', null, undefined,
  ];
  for (const s of not) assert.equal(codeFrom(s), null, JSON.stringify(s));
});
