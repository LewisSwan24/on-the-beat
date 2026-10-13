// LET'S GUESS's questions as a shows file carries them (docs/superpowers/specs/2026-10-13-lets-guess-design.md §1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { QUIZ_MAX, quizFault, quizHash, quizOf, withoutQuiz } from '../relay/quiz.js';
import { chooseShows, createRelay } from '../relay/server.js';

const QUIZ = JSON.parse(readFileSync(new URL('./fixtures/quiz.json', import.meta.url), 'utf8'));
const one = (change) => [{ ...QUIZ[0], ...change }];

test('a quiz of one to five questions, each with four different options and an answer among them, stands', () => {
  assert.equal(quizFault(QUIZ), '');
  assert.equal(QUIZ_MAX, 5);
  assert.equal(quizFault(QUIZ.slice(0, 1)), '');
  assert.equal(quizFault(one({ fact: undefined })), '', 'a fact is optional');
});

test('a quiz that breaks a rule says which rule', () => {
  assert.match(quizFault([]), /1 to 5 questions/);
  assert.match(quizFault([...QUIZ, QUIZ[0]]), /1 to 5 questions/);
  assert.match(quizFault('Sweden'), /1 to 5 questions/);
  assert.match(quizFault([null]), /question 1 is not a question/);
  assert.match(quizFault(one({ q: '' })), /"q"/);
  assert.match(quizFault(one({ q: 'x'.repeat(141) })), /"q"/);
  assert.match(quizFault(one({ options: ['a', 'b', 'c'] })), /"options"/);
  assert.match(quizFault(one({ options: ['a', 'b', 'c', 7] })), /"options"/);
  assert.match(quizFault(one({ options: ['a', 'b', 'c', 'x'.repeat(61)] })), /"options"/);
  assert.match(quizFault(one({ options: ['a', 'b', 'c', ' A '] })), /must differ/);
  assert.match(quizFault(one({ answer: 4 })), /"answer"/);
  assert.match(quizFault(one({ answer: '1' })), /"answer"/);
  assert.match(quizFault(one({ fact: 'x'.repeat(141) })), /"fact"/);
});

test('the relay keeps a quiz trimmed to its own fields, and its print changes with any of them', () => {
  const kept = quizOf([{ ...QUIZ[0], q: '  ' + QUIZ[0].q + ' ', extra: 'no' }]);
  assert.deepEqual(Object.keys(kept[0]).sort(), ['answer', 'fact', 'options', 'q']);
  assert.equal(kept[0].q, QUIZ[0].q);
  assert.equal(kept[0].fact, QUIZ[0].fact);
  assert.equal(quizOf(one({ fact: undefined }))[0].fact, '');
  assert.match(quizHash(QUIZ), /^[0-9a-f]{16}$/);
  assert.equal(quizHash(QUIZ), quizHash(JSON.parse(JSON.stringify(QUIZ))));
  assert.notEqual(quizHash(QUIZ), quizHash([{ ...QUIZ[0], answer: 0 }, ...QUIZ.slice(1)]));
  assert.deepEqual(withoutQuiz({ id: 'x', act: 'A', quiz: QUIZ }), { id: 'x', act: 'A' });
});

test('a shows file: a bad quiz is dropped and said, and its show stands; a good one is kept', () => {
  const dir = mkdtempSync(join(tmpdir(), 'otb-quiz-'));
  try {
    const file = join(dir, 'shows.json');
    writeFileSync(file, JSON.stringify([
      { id: 'good-night', act: 'ZARA LARSSON', quiz: QUIZ },
      { id: 'bad-night', act: 'ZARA LARSSON', quiz: one({ answer: 9 }) },
    ]));
    const said = [];
    const shows = chooseShows(file, file, (line) => said.push(line));
    assert.deepEqual(shows.map((s) => s.id), ['good-night', 'bad-night'], 'both shows stand');
    assert.deepEqual(shows[0].quiz, quizOf(QUIZ));
    assert.equal('quiz' in shows[1], false, 'the bad quiz is gone');
    assert.ok(said.some((l) => /bad-night/.test(l) && /"answer"/.test(l)), said.join('\n'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the venue list phones are given carries no quiz, so no answer leaves the relay that way', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'otb-quiz-'));
  const file = join(dir, 'shows.json');
  writeFileSync(file, JSON.stringify([{ id: 'good-night', act: 'ZARA LARSSON', quiz: QUIZ }]));
  const relay = await createRelay({ port: 0, host: '127.0.0.1', shows: file });
  try {
    const text = await (await fetch('http://127.0.0.1:' + relay.port + '/api/shows')).text();
    assert.equal(JSON.parse(text)[0].id, 'good-night');
    assert.doesNotMatch(text, /quiz|Stockholm|"answer"/);
  } finally {
    await relay.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
