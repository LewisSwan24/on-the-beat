// A posed photo over real sockets: kept, served as itself, listed as a photo, and nothing else under its name.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createRelay } from '../relay/server.js';
import { helpers, pause } from './relay-harness.js';

const JPEG = (n = 2000) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(n)]);
const VENUE = 'pose-room';

async function withRelay(fn) {
  const relay = await createRelay({ port: 0, host: '127.0.0.1' });
  const h = helpers(() => relay.port);
  const get = (ref) => fetch('http://127.0.0.1:' + relay.port + '/clip/' + VENUE + '/' + ref);
  try { await fn(h, get); } finally { h.cleanup(); await relay.close(); }
}

test('a photo is kept, served byte for byte as a JPEG, and listed on the floor as a photo', async () => {
  await withRelay(async ({ phone }, get) => {
    const ana = await phone(VENUE);
    const ben = await phone(VENUE);
    const photo = JPEG();
    ana.send({ t: 'clip', mime: 'image/jpeg', data: photo.toString('base64') });
    const [row] = (await ben.until((v) => v.floor.length === 1)).floor;
    assert.equal(row.kind, 'photo');
    // Refs are signed for each viewer, so hers is not the one Ben was given: it is enough that she has one, a photo.
    assert.ok((await ana.until((v) => v.me.clipKind === 'photo')).me.clip);
    const res = await get(row.ref);
    assert.equal(res.headers.get('content-type'), 'image/jpeg');
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), photo);
  });
});

test('image/jpeg that is not a JPEG, or is too big, is refused and never kept', async () => {
  await withRelay(async ({ phone }) => {
    const ana = await phone(VENUE);
    ana.send({ t: 'clip', mime: 'image/jpeg', data: Buffer.from('<script>alert(1)</script>').toString('base64') });
    ana.send({ t: 'clip', mime: 'image/jpeg', data: JPEG(300_000).toString('base64') });
    await ana.until((v, p) => p.errors.filter((e) => e === 'clip refused').length === 2);
    await pause(200);
    assert.equal(ana.view.me.clip, null);
  });
});

test('small photos are paced like clips: three at once, then one at a time', async () => {
  await withRelay(async ({ phone }) => {
    const ana = await phone(VENUE);
    for (let i = 0; i < 4; i++) ana.send({ t: 'clip', mime: 'image/jpeg', data: JPEG().toString('base64') });
    await ana.until((v, p) => p.errors.includes('clip too fast'));
    await pause(200);
    assert.deepEqual(ana.errors, ['clip too fast'], 'the fourth, and only the fourth, is refused');
  });
});

test('a clip whose mime is an object that cannot become a string does not stop the relay', async () => {
  await withRelay(async ({ phone }) => {
    const ana = await phone(VENUE);
    ana.send({ t: 'clip', mime: { toString: 1 }, data: JPEG().toString('base64') });
    await pause(200);
    const ben = await phone(VENUE);
    assert.ok(ben.view, 'the relay still answers a phone');
  });
});

test('a mime that is not a string is refused, so nothing is kept that the clip budget did not see', async () => {
  await withRelay(async ({ phone }) => {
    const ana = await phone(VENUE);
    for (let i = 0; i < 4; i++) ana.send({ t: 'clip', mime: ['image/jpeg'], data: JPEG().toString('base64') });
    await ana.until((v, p) => p.errors.filter((e) => e === 'clip refused').length === 4);
    await pause(200);
    assert.equal(ana.view.me.clip, null);
  });
});

test('a photo replaces the same person\'s clip on the floor, and a clip replaces a photo', async () => {
  await withRelay(async ({ phone }) => {
    const ana = await phone(VENUE);
    const ben = await phone(VENUE);
    ana.send({ t: 'clip', mime: 'video/webm', data: randomBytes(1500).toString('base64') });
    await ben.until((v) => v.floor.length === 1 && v.floor[0].kind === 'clip');
    ana.send({ t: 'clip', mime: 'image/jpeg', data: JPEG().toString('base64') });
    await ben.until((v) => v.floor.length === 1 && v.floor[0].kind === 'photo');
    ana.send({ t: 'clip', mime: 'video/mp4', data: randomBytes(1500).toString('base64') });
    await ben.until((v) => v.floor.length === 1 && v.floor[0].kind === 'clip');
  });
});

test('a dance back may be a photo, and the one it goes to sees a photo', async () => {
  await withRelay(async ({ phone }) => {
    const ana = await phone(VENUE);
    const ben = await phone(VENUE);
    ana.send({ t: 'clip', mime: 'video/webm', data: randomBytes(1500).toString('base64') });
    const [onFloor] = (await ben.until((v) => v.floor.length === 1)).floor;
    ben.send({ t: 'clip', mime: 'image/jpeg', data: JPEG().toString('base64'), to: onFloor.handle });
    const back = (await ana.until((v) => v.floor.some((c) => c.toYou))).floor.find((c) => c.toYou);
    assert.equal(back.kind, 'photo');
  });
});
