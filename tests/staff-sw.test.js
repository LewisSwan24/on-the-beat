// ON THE BEAT — the staff page's service worker (app/public/staff-sw.js;
// docs/superpowers/specs/2026-09-29-staff-push-design.md §1), run in a vm with a fake `self`: what a push shows,
// and where a tap on it goes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../app/public/staff-sw.js', import.meta.url), 'utf8');

/** The worker, loaded fresh: its listeners, what it showed, the windows it can see and what it opened. */
function worker(windows = []) {
  const listeners = {};
  const w = { listeners, shown: [], opened: [], focused: [], closed: false };
  const waits = [];
  vm.runInNewContext(source, {
    URL,
    self: {
      addEventListener: (type, f) => { listeners[type] = f; },
      skipWaiting: () => Promise.resolve(),
      registration: {
        showNotification: (title, options) => { w.shown.push(JSON.parse(JSON.stringify({ title, ...options }))); return Promise.resolve(); },
      },
      clients: {
        matchAll: async () => windows.map((url) => ({ url, focus: async () => { w.focused.push(url); } })),
        openWindow: async (url) => { w.opened.push(url); },
      },
    },
  });
  w.push = async (data) => {
    const json = () => (typeof data === 'string' ? JSON.parse(data) : data);
    listeners.push({ data: data === undefined ? null : { json }, waitUntil: (p) => waits.push(p) });
    await Promise.all(waits);
  };
  w.click = async () => {
    listeners.notificationclick({ notification: { close: () => { w.closed = true; } }, waitUntil: (p) => waits.push(p) });
    await Promise.all(waits);
  };
  return w;
}

test('a push shows the venue and how many are open, tagged so a newer one replaces it and still alerts', async () => {
  const w = worker();
  await w.push({ venue: 'The Roundhouse, Camden', open: 2 });
  await w.push({ venue: 'The Roundhouse, Camden', open: 1 });
  assert.deepEqual(w.shown, [
    { title: 'New report · The Roundhouse, Camden', body: '2 open — tap to see them', tag: 'otb-reports', renotify: true, icon: '/icon-192.png', data: { url: '/staff' } },
    { title: 'New report · The Roundhouse, Camden', body: '1 open — tap to see it', tag: 'otb-reports', renotify: true, icon: '/icon-192.png', data: { url: '/staff' } },
  ]);
});

test('a push with no data, or data it cannot read, still shows New report: Safari takes the permission back otherwise', async () => {
  const w = worker();
  await w.push(undefined);
  await w.push('not json {');
  await w.push({ venue: 42, open: 'many' });
  assert.deepEqual(w.shown.map((n) => [n.title, n.body, n.tag]), [
    ['New report', 'Tap to see the list', 'otb-reports'],
    ['New report', 'Tap to see the list', 'otb-reports'],
    ['New report', 'Tap to see the list', 'otb-reports'],
  ]);
});

test('a tap on it focuses an open staff window, or opens /staff', async () => {
  const open = worker(['https://otb.test/tonight', 'https://otb.test/staff']);
  await open.click();
  assert.equal(open.closed, true);
  assert.deepEqual(open.focused, ['https://otb.test/staff']);
  assert.deepEqual(open.opened, []);
  const none = worker(['https://otb.test/tonight']);
  await none.click();
  assert.deepEqual(none.opened, ['/staff']);
});

test('it keeps nothing: the staff page stays live or nothing', () => {
  assert.equal(worker().listeners.fetch, undefined);
});
