import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quizNow, scoreText } from '../app/lib/guess.js';

const qs = [{ q: 'A?', options: ['1', '2', '3', '4'] }, { q: 'B?', options: ['1', '2', '3', '4'] }];

test('where a person is in tonight\'s quiz', () => {
  assert.equal(quizNow(null), null);
  assert.equal(quizNow({ questions: [] }), null);
  assert.deepEqual(quizNow({ questions: qs, answered: [], done: false, score: { right: 0, of: 2 } }),
    { total: 2, index: 0, current: qs[0], done: false, score: { right: 0, of: 2 } });
  const one = quizNow({ questions: qs, answered: [{ choice: 1, right: true, answer: 1, fact: '' }], done: false, score: { right: 1, of: 2 } });
  assert.equal(one.index, 1);
  assert.equal(one.current, qs[1]);
  const all = quizNow({ questions: qs, answered: [{}, {}], done: true, score: { right: 1, of: 2 } });
  assert.equal(all.current, null);
  assert.equal(all.done, true);
});

test('a score reads as right out of all, or nothing', () => {
  assert.equal(scoreText({ right: 3, of: 5 }), '3/5');
  assert.equal(scoreText({ right: 0, of: 5 }), '0/5');
  assert.equal(scoreText(null), '');
  assert.equal(scoreText({ right: 1, of: 0 }), '');
});

test('a locked answer is checking until it lands, or for CHECK_MS online; offline it waits for the line', async () => {
  const { CHECK_MS, checking } = await import('../app/lib/guess.js');
  const q0 = { questions: qs, answered: [] };
  const locked = { index: 0, at: 1000 };
  assert.equal(checking(locked, q0, 1000 + CHECK_MS - 1, false), true, 'not yet heard');
  assert.equal(checking(locked, q0, 1000 + CHECK_MS, false), false, 'lost or refused: the person may lock again');
  assert.equal(checking(locked, q0, 1000 + CHECK_MS * 10, true), true, 'offline it is queued, so it stays saved');
  assert.equal(checking(locked, { questions: qs, answered: [{}] }, 1001, false), false, 'taken');
  assert.equal(checking(null, q0, 1001, false), false, 'nothing locked');
});
