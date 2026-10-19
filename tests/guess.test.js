// LET'S GUESS in the room: answers, scores, what a phone may see, and what a restart keeps
// (docs/superpowers/specs/2026-10-13-lets-guess-design.md §1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRoom } from '../relay/room.js';
import { quizOf } from '../relay/quiz.js';

const QUIZ = quizOf(JSON.parse(readFileSync(new URL('./fixtures/quiz.json', import.meta.url), 'utf8')));
// Ten questions, so a person is dealt five of them.
const BIG = quizOf(Array.from({ length: 10 }, (_, i) => ({ q: 'Question ' + i + '?', options: ['a' + i, 'b' + i, 'c' + i, 'd' + i], answer: i % 4, fact: 'Fact ' + i + '.' })));
const room = (more = {}) => {
  const r = createRoom({ salt: 'g', quiz: QUIZ, ...more });
  for (const p of ['ana', 'ben', 'cal']) r.join(p);
  return r;
};
// What a person was dealt, read from their own view: each question's source, and where its right option sits for them.
const dealt = (r, id, quiz = QUIZ) => r.viewFor(id).quiz.questions.map((x) => {
  const src = quiz.find((s) => s.q === x.q);
  return { src, right: x.options.indexOf(src.options[src.answer]) };
});
const rightOf = (r, id, q, quiz = QUIZ) => dealt(r, id, quiz)[q].right;
const answerAll = (r, id, pick = (right) => right) => dealt(r, id).forEach((d, q) => assert.equal(r.answer(id, q, pick(d.right, q)), true, id + ' q' + q));

test('a person answers in order, once each, and the view tells only them how they did', () => {
  const r = room();
  const mine = dealt(r, 'ana');
  assert.equal(mine.length, 5, 'a quiz of five: all five are dealt');
  assert.deepEqual(new Set(mine.map((d) => d.src.q)), new Set(QUIZ.map((x) => x.q)));
  assert.deepEqual(r.viewFor('ana').quiz.answered, []);
  const wrong = (mine[0].right + 1) % 4;
  assert.equal(r.answer('ana', 1, 0), false, 'not the first unanswered question');
  assert.equal(r.answer('ana', 0, 4), false, 'no such option');
  assert.equal(r.answer('ana', 0, 1.5), false);
  assert.equal(r.answer('ana', 0, '1'), false);
  assert.equal(r.answer('ana', 0, wrong), true, 'a wrong answer is still an answer');
  assert.equal(r.answer('ana', 0, mine[0].right), false, 'final once given: the same question twice counts once');
  assert.deepEqual(r.viewFor('ana').quiz.answered, [{ choice: wrong, right: false, answer: mine[0].right, fact: mine[0].src.fact }]);
  assert.equal(r.viewFor('ana').quiz.done, false);
  assert.deepEqual(r.viewFor('ana').quiz.score, { right: 0, of: 5 });
  assert.deepEqual(r.viewFor('ben').quiz.answered, [], 'nobody else is told');
  assert.equal(r.answer('nobody', 0, 1), false, 'only someone in the room');
});

test('no view holds the answer or the fact of a question its person has not locked', () => {
  const r = room();
  const first = dealt(r, 'ana')[0].src;
  r.answer('ana', 0, rightOf(r, 'ana', 0));
  const ana = JSON.stringify(r.viewFor('ana'));
  const ben = JSON.stringify(r.viewFor('ben'));
  assert.ok(ana.includes(first.fact));
  for (const x of QUIZ.filter((y) => y !== first)) assert.ok(!ana.includes(x.fact), 'ana is not told ' + x.fact);
  for (const x of QUIZ) assert.ok(!ben.includes(x.fact), 'ben is not told ' + x.fact);
  assert.doesNotMatch(ben, /"answer"/);
});

test('every answer given: done, and the score is the right ones out of all', () => {
  const r = room();
  answerAll(r, 'ana', (right, q) => (q === 1 || q === 4 ? (right + 1) % 4 : right));
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
  r.answer('ana', 0, rightOf(r, 'ana', 0));
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

test('from a bigger quiz each person is dealt five of their own, with the options in their own order', () => {
  const r = createRoom({ salt: 'g', quiz: BIG });
  const ids = Array.from({ length: 12 }, (_, i) => 'p' + i);
  for (const p of ids) r.join(p);
  const deals = ids.map((p) => dealt(r, p, BIG));
  for (const d of deals) {
    assert.equal(d.length, 5);
    assert.equal(new Set(d.map((x) => x.src.q)).size, 5, 'five different questions');
  }
  for (const p of ids) {
    for (const x of r.viewFor(p).quiz.questions) {
      const src = BIG.find((y) => y.q === x.q);
      assert.deepEqual([...x.options].sort(), [...src.options].sort(), 'the same four options, in some order');
    }
  }
  const sets = new Set(deals.map((d) => d.map((x) => x.src.q).sort().join('|')));
  assert.ok(sets.size > 1, 'not everyone is dealt the same five');
  assert.ok(new Set(deals.flatMap((d) => d.map((x) => x.src.q))).size > 5, 'between them, more of the ten are asked');
  // One question, asked of several people: its options do not come in one order for all of them.
  const orders = new Map();
  for (const p of ids) for (const x of r.viewFor(p).quiz.questions) orders.set(x.q, [...(orders.get(x.q) ?? []), x.options.join('|')]);
  const shared = [...orders.values()].filter((o) => o.length >= 3);
  assert.ok(shared.length > 0, 'some question is asked of three or more');
  for (const o of shared) assert.ok(new Set(o).size > 1, 'the options are in more than one order: ' + o.join(' / '));
  assert.deepEqual(r.viewFor('p0').quiz.questions, r.viewFor('p0').quiz.questions, 'a deal holds from one view to the next');
  assert.deepEqual(r.viewFor('p0').quiz.score, { right: 0, of: 5 });
});

test('an answer is the place a person tapped on their own screen, marked against their own order', () => {
  const r = createRoom({ salt: 'g', quiz: BIG });
  r.join('ana');
  const mine = dealt(r, 'ana', BIG);
  assert.equal(r.answer('ana', 0, mine[0].right), true);
  const wrong = (mine[1].right + 1) % 4;
  assert.equal(r.answer('ana', 1, wrong), true);
  assert.deepEqual(r.viewFor('ana').quiz.answered, [
    { choice: mine[0].right, right: true, answer: mine[0].right, fact: mine[0].src.fact },
    { choice: wrong, right: false, answer: mine[1].right, fact: mine[1].src.fact },
  ]);
  for (let q = 2; q < 5; q += 1) r.answer('ana', q, mine[q].right);
  assert.equal(r.viewFor('ana').quiz.done, true, 'done after their own five, not all ten');
  assert.deepEqual(r.viewFor('ana').quiz.score, { right: 4, of: 5 });
  assert.equal(r.answer('ana', 5, 0), false, 'nothing past their fifth');
});

test('a restart deals the same person the same questions in the same order, and keeps their answers', () => {
  const r = createRoom({ salt: 'g', quiz: BIG });
  r.join('ana');
  r.answer('ana', 0, rightOf(r, 'ana', 0, BIG));
  const { lastAt: _, ...before } = r.viewFor('ana').quiz;
  const dump = JSON.parse(JSON.stringify(r.dump()));
  const again = createRoom({ quiz: BIG, restore: dump });
  again.join('ana');
  const { lastAt: __, ...after } = again.viewFor('ana').quiz;
  assert.deepEqual(after, before);
  delete dump.quizDeal;
  const old = createRoom({ quiz: BIG, restore: dump });
  old.join('ana');
  assert.deepEqual(old.viewFor('ana').quiz.answered, [], 'answers saved before deals were in another order: dropped');
});

// The list a phone sees, by band.
const teamsOf = (r, id) => r.viewFor(id).teams;
const handleOf = (r, viewer, other) => teamsOf(r, viewer).find((p) => p.band === r.viewFor(other).me.band)?.handle;

test('a room with no quiz still lists LET\'S GUESS, resting: shown, never open, never on the wrist', () => {
  const r = createRoom({ salt: 'g' });
  r.join('ana');
  const v = r.viewFor('ana');
  assert.deepEqual(v.cards, ['hi', 'song', 'dance'], 'open cards: the wristband steps over LET\'S GUESS');
  assert.deepEqual(v.resting, ['guess'], 'the phone shows it greyed');
  assert.ok(!v.quiz, 'no questions to send');
  const q = room();
  q.join('ana');
  assert.deepEqual(q.viewFor('ana').resting, [], 'with a quiz nothing rests');
  assert.equal(r.setClosed(['guess', 'hi']), true);
  assert.deepEqual(r.viewFor('ana').resting, [], 'closed by the staff: hidden like any closed card, not greyed');
});

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
  const right = rightOf(r, 'ana', 0);
  assert.equal(r.setClosed(['guess']), true);
  assert.equal(r.viewFor('ana').quiz, null);
  assert.equal(r.answer('ana', 0, right), false);
});

test('teams: only people who finished and have LET\'S GUESS armed, with their score; nothing until you finish', () => {
  const r = room();
  for (const p of ['ana', 'ben', 'cal']) r.arm(p, 'guess');
  answerAll(r, 'ben', (right, q) => (q < 2 ? right : (right + 1) % 4));
  r.answer('cal', 0, rightOf(r, 'cal', 0));
  r.answer('ana', 0, rightOf(r, 'ana', 0));
  assert.deepEqual(teamsOf(r, 'ana'), [], 'ana has not finished, so she sees nobody yet');
  for (let q = 1; q < 5; q += 1) r.answer('ana', q, rightOf(r, 'ana', q));
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
  r.answer('cal', 0, rightOf(r, 'cal', 0));
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

test('a person\'s view says when they last answered, so their band can play it; nobody else\'s says it', () => {
  let t = 5000;
  const r = createRoom({ salt: 'g', quiz: QUIZ, now: () => t });
  for (const p of ['ana', 'ben']) r.join(p);
  assert.equal(r.viewFor('ana').quiz.lastAt, null, 'nothing answered yet');
  t = 7000;
  r.answer('ana', 0, rightOf(r, 'ana', 0));
  assert.equal(r.viewFor('ana').quiz.lastAt, 7000);
  assert.equal(r.viewFor('ben').quiz.lastAt, null);
  t = 9000;
  assert.equal(r.answer('ana', 0, 0), false);
  assert.equal(r.viewFor('ana').quiz.lastAt, 7000, 'a refused answer moves nothing');
  const again = createRoom({ quiz: QUIZ, restore: JSON.parse(JSON.stringify(r.dump())), now: () => t });
  again.join('ana');
  assert.equal(again.viewFor('ana').quiz.lastAt, null, 'a restart plays no old answer again');
});
