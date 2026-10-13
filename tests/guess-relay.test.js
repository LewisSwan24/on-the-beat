// LET'S GUESS over real sockets: a show's quiz reaches its room, answers and team-ups travel,
// nobody is told another's answers, a typed venue has no quiz, and a restart keeps answers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRelay } from '../relay/server.js';
import { helpers, pause } from './relay-harness.js';

const QUIZ = JSON.parse(readFileSync(new URL('./fixtures/quiz.json', import.meta.url), 'utf8'));
const VENUE = 'test-night-zara-larsson';

async function withRelay(fn, { nightFile } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'otb-guess-'));
  const shows = join(dir, 'shows.json');
  writeFileSync(shows, JSON.stringify([{ id: VENUE, act: 'ZARA LARSSON', venue: 'ON THE BEAT test night', quiz: QUIZ }]));
  const relay = await createRelay({ port: 0, host: '127.0.0.1', shows, nightFile, saveEveryMs: 50 });
  const h = helpers(() => relay.port);
  try {
    await fn(h, relay, shows);
  } finally {
    h.cleanup();
    await relay.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

const finish = async (p) => {
  for (const [q, x] of QUIZ.entries()) {
    p.send({ t: 'answer', q, choice: x.answer });
    await p.until((v) => v.quiz?.answered.length === q + 1);
  }
};

test('answers travel to the relay, and only their own phone is told how they went', async () => {
  await withRelay(async ({ phone }) => {
    const ana = await phone(VENUE);
    const ben = await phone(VENUE);
    const first = await ana.until((v) => v.quiz?.questions.length === QUIZ.length);
    assert.equal(JSON.stringify(first).includes(QUIZ[0].fact), false, 'no fact before an answer');
    ana.send({ t: 'answer', q: 0, choice: QUIZ[0].answer });
    const after = await ana.until((v) => v.quiz.answered.length === 1);
    assert.equal(after.quiz.answered[0].right, true);
    await pause(200);
    assert.equal(JSON.stringify(ben.view).includes(QUIZ[0].fact), false, 'ben is never told ana\'s');
    for (const x of QUIZ.slice(1)) assert.equal(JSON.stringify(after).includes(x.fact), false);
  });
});

test('two who finish and team up both ways are a match, over LET\'S GUESS', async () => {
  await withRelay(async ({ phone }) => {
    const ana = await phone(VENUE);
    const ben = await phone(VENUE);
    for (const p of [ana, ben]) { p.send({ t: 'arm', intent: 'guess' }); await finish(p); }
    const seen = await ana.until((v) => v.teams.length === 1);
    ana.send({ t: 'team', handle: seen.teams[0].handle });
    const back = await ben.until((v) => v.teams.length === 1);
    ben.send({ t: 'team', handle: back.teams[0].handle });
    const [m] = (await ana.until((v) => v.matches.length === 1)).matches;
    assert.equal(m.intent, 'guess');
    assert.deepEqual(m.score, { right: 5, of: 5 });
  });
});

test('a venue somebody typed has no quiz: LET\'S GUESS is not offered and cannot be armed', async () => {
  await withRelay(async ({ phone }) => {
    const ana = await phone('a-place-nobody-listed');
    const v = await ana.until((x) => Array.isArray(x.cards));
    assert.equal(v.cards.includes('guess'), false);
    assert.equal(v.quiz, null);
    ana.send({ t: 'arm', intent: 'guess' });
    await pause(300);
    assert.equal(ana.view.me.armed, null);
  });
});

test('a restart with the night file keeps a person\'s answers', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'otb-guess-night-'));
  const nightFile = join(dir, 'night.json');
  const me = 'a'.repeat(32);
  try {
    await withRelay(async ({ phone }) => {
      const ana = await phone(VENUE, { me });
      ana.send({ t: 'answer', q: 0, choice: QUIZ[0].answer });
      await ana.until((v) => v.quiz?.answered.length === 1);
      await pause(300);
    }, { nightFile });
    await withRelay(async ({ phone }) => {
      const ana = await phone(VENUE, { me });
      const v = await ana.until((x) => x.quiz?.answered.length === 1);
      assert.equal(v.quiz.answered[0].right, true);
    }, { nightFile });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
