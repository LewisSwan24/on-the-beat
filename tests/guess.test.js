// LET'S GUESS in the room: answers, scores, what a phone may see, and what a restart keeps
// (docs/superpowers/specs/2026-10-13-lets-guess-design.md §1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRoom } from '../relay/room.js';
import { quizOf } from '../relay/quiz.js';

const QUIZ = quizOf(JSON.parse(readFileSync(new URL('./fixtures/quiz.json', import.meta.url), 'utf8')));
const RIGHT = QUIZ.map((x) => x.answer);
const room = (more = {}) => {
  const r = createRoom({ salt: 'g', quiz: QUIZ, ...more });
  for (const p of ['ana', 'ben', 'cal']) r.join(p);
  return r;
};
const answerAll = (r, id, choices = RIGHT) => choices.forEach((c, q) => assert.equal(r.answer(id, q, c), true, id + ' q' + q));

test('a person answers in order, once each, and the view tells only them how they did', () => {
  const r = room();
  assert.deepEqual(r.viewFor('ana').quiz.questions, QUIZ.map(({ q, options }) => ({ q, options })));
  assert.deepEqual(r.viewFor('ana').quiz.answered, []);
  assert.equal(r.answer('ana', 1, 0), false, 'not the first unanswered question');
  assert.equal(r.answer('ana', 0, 4), false, 'no such option');
  assert.equal(r.answer('ana', 0, 1.5), false);
  assert.equal(r.answer('ana', 0, '1'), false);
  assert.equal(r.answer('ana', 0, 0), true, 'a wrong answer is still an answer');
  assert.equal(r.answer('ana', 0, RIGHT[0]), false, 'final once given: the same question twice counts once');
  assert.deepEqual(r.viewFor('ana').quiz.answered, [{ choice: 0, right: false, answer: RIGHT[0], fact: QUIZ[0].fact }]);
  assert.equal(r.viewFor('ana').quiz.done, false);
  assert.deepEqual(r.viewFor('ana').quiz.score, { right: 0, of: 5 });
  assert.deepEqual(r.viewFor('ben').quiz.answered, [], 'nobody else is told');
  assert.equal(r.answer('nobody', 0, 1), false, 'only someone in the room');
});

test('no view holds the answer or the fact of a question its person has not locked', () => {
  const r = room();
  r.answer('ana', 0, RIGHT[0]);
  const ana = JSON.stringify(r.viewFor('ana'));
  const ben = JSON.stringify(r.viewFor('ben'));
  assert.ok(ana.includes(QUIZ[0].fact));
  for (const x of QUIZ.slice(1)) assert.ok(!ana.includes(x.fact), 'ana is not told ' + x.fact);
  for (const x of QUIZ) assert.ok(!ben.includes(x.fact), 'ben is not told ' + x.fact);
  assert.doesNotMatch(ben, /"answer"/);
});

test('every answer given: done, and the score is the right ones out of all', () => {
  const r = room();
  answerAll(r, 'ana', [RIGHT[0], 0, RIGHT[2], RIGHT[3], 0]);
  const q = r.viewFor('ana').quiz;
  assert.equal(q.done, true);
  assert.deepEqual(q.score, { right: 3, of: 5 });
  assert.equal(r.answer('ana', 5, 0), false, 'nothing past the last question');
});

test('a room whose show has no quiz: LET\'S GUESS is closed, nothing is asked, nothing can be answered', () => {
  const r = createRoom({ salt: 'g' });
  r.join('ana');
  assert.equal(r.viewFor('ana').quiz, null);
  assert.equal(r.viewFor('ana').cards.includes('guess'), false);
  assert.equal(r.answer('ana', 0, 0), false);
});

test('answers outlive leaving the room, and go when the person is forgotten', () => {
  const r = room();
  r.answer('ana', 0, RIGHT[0]);
  r.leave('ana');
  r.join('ana');
  assert.equal(r.viewFor('ana').quiz.answered.length, 1, 'a socket that dropped past its grace keeps them');
  r.forgetPerson('ana');
  r.join('ana');
  assert.equal(r.viewFor('ana').quiz.answered.length, 0);
});

test('a restart keeps answers for the same quiz, and drops them for a corrected one', () => {
  const r = room();
  answerAll(r, 'ana');
  const dump = JSON.parse(JSON.stringify(r.dump()));
  assert.equal(typeof dump.quizHash, 'string');
  const same = createRoom({ quiz: QUIZ, restore: dump });
  assert.equal(same.viewFor('ana').quiz.done, true);
  const fixed = QUIZ.map((x, i) => (i === 0 ? { ...x, answer: (x.answer + 1) % 4 } : x));
  const other = createRoom({ quiz: fixed, restore: dump });
  assert.deepEqual(other.viewFor('ana').quiz.answered, []);
  const gone = createRoom({ restore: dump });
  assert.equal(gone.viewFor('ana').quiz, null, 'a show that lost its quiz has none');
});

// The list a phone sees, by band.
const teamsOf = (r, id) => r.viewFor(id).teams;
const handleOf = (r, viewer, other) => teamsOf(r, viewer).find((p) => p.band === r.viewFor(other).me.band)?.handle;

test('staff cannot close the last open card where LET\'S GUESS has no quiz', () => {
  const r = createRoom({ salt: 'g' });
  assert.equal(r.setClosed(['hi', 'song']), true);
  assert.equal(r.setClosed(['hi', 'song', 'dance']), false, 'with no quiz, that would close every card');
  assert.deepEqual(r.closed().cards, ['hi', 'song']);
  const q = room();
  assert.equal(q.setClosed(['hi', 'song', 'dance']), true, 'with a quiz, LET\'S GUESS is still open');
});

test('staff closing LET\'S GUESS stops answering, and its questions leave the view', () => {
  const r = room();
  assert.equal(r.setClosed(['guess']), true);
  assert.equal(r.viewFor('ana').quiz, null);
  assert.equal(r.answer('ana', 0, RIGHT[0]), false);
});

test('teams: only people who finished and have LET\'S GUESS armed, with their score; nothing until you finish', () => {
  const r = room();
  for (const p of ['ana', 'ben', 'cal']) r.arm(p, 'guess');
  answerAll(r, 'ben', RIGHT.map((c, q) => (q < 2 ? c : (c + 1) % 4)));
  r.answer('cal', 0, RIGHT[0]);
  r.answer('ana', 0, RIGHT[0]);
  assert.deepEqual(teamsOf(r, 'ana'), [], 'ana has not finished, so she sees nobody yet');
  for (let q = 1; q < 5; q += 1) r.answer('ana', q, RIGHT[q]);
  const rows = teamsOf(r, 'ana');
  assert.equal(rows.length, 1, 'cal has not finished, so only ben is listed');
  assert.deepEqual(rows[0].score, { right: 2, of: 5 });
  assert.equal(rows[0].asked, false);
  assert.equal(rows[0].band, r.viewFor('ben').me.band);
});

test('a team-up each way is a match, carrying both scores; one is not', () => {
  const r = room();
  for (const p of ['ana', 'ben']) { r.arm(p, 'guess'); answerAll(r, p); }
  assert.equal(r.team('ana', handleOf(r, 'ana', 'ben')), null, 'one team-up is not a match');
  assert.equal(teamsOf(r, 'ana')[0].asked, true);
  const m = r.team('ben', handleOf(r, 'ben', 'ana'));
  assert.equal(m.intent, 'guess');
  const seen = r.viewFor('ana').matches[0];
  assert.deepEqual([seen.yourScore, seen.score], [{ right: 5, of: 5 }, { right: 5, of: 5 }]);
});

test('no team-up to someone who has not finished, or who disarmed LET\'S GUESS since', () => {
  const r = room();
  for (const p of ['ana', 'ben']) { r.arm(p, 'guess'); answerAll(r, p); }
  const toBen = handleOf(r, 'ana', 'ben');
  r.arm('ben', 'hi');
  assert.deepEqual(teamsOf(r, 'ana'), [], 'ben left the list');
  assert.equal(r.team('ana', toBen), false, 'and a team-up kept from before is refused');
  r.arm('cal', 'guess');
  r.answer('cal', 0, RIGHT[0]);
  r.arm('ben', 'guess');
  assert.equal(teamsOf(r, 'ana').length, 1, 'ben is back; cal never finished');
});

test('a block takes team-ups away both ways, and a forgotten person\'s go with them', () => {
  const r = room();
  for (const p of ['ana', 'ben']) { r.arm(p, 'guess'); answerAll(r, p); }
  r.team('ana', handleOf(r, 'ana', 'ben'));
  r.block('ben', handleOf(r, 'ben', 'ana'));
  assert.deepEqual(teamsOf(r, 'ana'), []);
  assert.deepEqual(teamsOf(r, 'ben'), []);
  const s = room();
  for (const p of ['ana', 'ben']) { s.arm(p, 'guess'); answerAll(s, p); }
  s.team('ana', handleOf(s, 'ana', 'ben'));
  s.forgetPerson('ana');
  assert.equal(s.dump().teams.length, 0);
});

test('a restart keeps team-ups for the same quiz, and drops them with a corrected one', () => {
  const r = room();
  for (const p of ['ana', 'ben']) { r.arm(p, 'guess'); answerAll(r, p); }
  r.team('ana', handleOf(r, 'ana', 'ben'));
  const dump = JSON.parse(JSON.stringify(r.dump()));
  const same = createRoom({ quiz: QUIZ, restore: dump });
  assert.equal(same.viewFor('ben').teams.length, 1);
  assert.equal(same.team('ben', same.viewFor('ben').teams[0].handle)?.intent, 'guess', 'the kept team-up makes the match');
  const fixed = QUIZ.map((x, i) => (i === 0 ? { ...x, answer: (x.answer + 1) % 4 } : x));
  assert.equal(createRoom({ quiz: fixed, restore: dump }).dump().teams.length, 0);
});

test('a match over another card carries no quiz score, even between two who finished', () => {
  const r = room();
  for (const p of ['ana', 'ben']) { answerAll(r, p); r.arm(p, 'hi'); }
  const near = (a, b) => r.viewFor(a).near.find((p) => p.band === r.viewFor(b).me.band).handle;
  r.wave('ana', near('ana', 'ben'));
  const m = r.wave('ben', near('ben', 'ana'));
  assert.equal(m?.intent, 'hi');
  const seen = r.viewFor('ana').matches[0];
  assert.deepEqual([seen.score, seen.yourScore], [null, null]);
});
