// ON THE BEAT — the staff page's words and order (app/staff/list.js), that the build made the page, and that the
// offline shell never keeps it (docs/superpowers/specs/2026-09-28-staff-reports-design.md §4).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { REFUSED, freshIds, openCount, ordered, timeOf, titleFor, whereLine, whoLine } from '../app/staff/list.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const report = (x) => ({
  id: 'r1', at: 0, about: 'P-4F2A91', times: 1, people: 1, bandNow: 'near the bar', bandThen: 'near the bar',
  fromThen: 'by the stage', why: '', handledAt: 0, ...x,
});

test('open reports come first, newest first, then handled ones, newest first', () => {
  const list = [report({ id: 'r4', handledAt: 9 }), report({ id: 'r3' }), report({ id: 'r2', handledAt: 5 }), report({ id: 'r1' })];
  assert.deepEqual(ordered(list).map((r) => r.id), ['r3', 'r1', 'r4', 'r2']);
  assert.equal(openCount(list), 2);
});

test('who a report is about: a tag, how often and by how many — or something else', () => {
  assert.equal(whoLine(report({ times: 3, people: 2 })), 'About someone · P-4F2A91 · reported 3 times by 2 people');
  assert.equal(whoLine(report()), 'About someone · P-4F2A91 · reported once by 1 person');
  assert.equal(whoLine(report({ about: null, times: 0, people: 0 })), 'Something else');
});

test('where: now, then, and the reporter — and a person who left', () => {
  assert.equal(whereLine(report()), 'now near the bar · then near the bar · reporter was by the stage');
  assert.equal(whereLine(report({ bandNow: 'left' })), 'now: left · then near the bar · reporter was by the stage');
  assert.equal(whereLine(report({ about: null, bandNow: null, bandThen: null })), 'reporter was by the stage');
});

test('a new report is one the last list did not have; the first list has none', () => {
  assert.deepEqual(freshIds(null, [report()]), []);
  assert.deepEqual(freshIds(new Set(['r1']), [report({ id: 'r2' }), report()]), ['r2']);
});

test('the tab counts the open ones, and a time reads as the venue\'s clock', () => {
  assert.equal(titleFor('The Roundhouse, Camden · BRUNO MARS', 2), '(2) Staff · The Roundhouse, Camden · BRUNO MARS');
  assert.equal(titleFor('The Roundhouse, Camden · BRUNO MARS', 0), 'Staff · The Roundhouse, Camden · BRUNO MARS');
  assert.match(timeOf(Date.UTC(2026, 8, 28, 10, 5)), /^\d{2}:\d{2}$/);
});

test('every refusal the relay can give has words of its own', () => {
  for (const why of ['no staff page', 'wrong code', 'too many tries', 'expired', 'bad staff', 'too many venues', 'signed out']) assert.ok(REFUSED[why], why);
  assert.equal(new Set(Object.values(REFUSED)).size, Object.keys(REFUSED).length);
  assert.match(REFUSED.expired, /new night, or the passcode was changed/);
  assert.doesNotMatch(REFUSED.expired, /restarted/, 'a restart no longer signs anyone out');
});

test('the build made the staff page', () => {
  const page = readFileSync(root + 'dist/staff.html', 'utf8');
  assert.match(page, /<title>Staff · On The Beat<\/title>/);
  assert.match(page, /src="\/assets\/[^"]+\.js"/);
});

test('the build gives the staff page its own manifest and its own worker', () => {
  const page = readFileSync(root + 'dist/staff.html', 'utf8');
  assert.match(page, /<link rel="manifest" href="\/staff\.webmanifest">/);
  assert.match(page, /<link rel="apple-touch-icon" href="\/icon-192\.png">/);
  const manifest = JSON.parse(readFileSync(root + 'dist/staff.webmanifest', 'utf8'));
  assert.equal(manifest.id, '/staff');
  assert.equal(manifest.start_url, '/staff');
  assert.equal(manifest.scope, '/staff');
  assert.equal(manifest.display, 'standalone', 'what iOS needs before it allows Web Push');
  assert.ok(existsSync(root + 'dist/staff-sw.js'));
});

test('the offline shell never keeps the staff page, nor answers for it', () => {
  const listeners = {};
  const context = {
    self: { addEventListener: (type, f) => { listeners[type] = f; } },
    location: { origin: 'https://otb.test' },
    URL,
    caches: {},
    fetch: () => new Promise(() => {}),
  };
  vm.runInNewContext(readFileSync(root + 'app/public/sw.js', 'utf8'), context);
  const answered = (path) => {
    let took = false;
    listeners.fetch({ request: { url: 'https://otb.test' + path, method: 'GET', mode: 'navigate' }, respondWith: () => { took = true; } });
    return took;
  };
  assert.equal(answered('/staff'), false);
  assert.equal(answered('/staff/'), false);
  assert.equal(answered('/staff.html'), false);
  assert.equal(answered('/'), true, 'the app itself is still kept');
  assert.equal(answered('/tonight'), true);
});
