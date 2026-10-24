# LET'S GUESS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A fourth card, LET'S GUESS: answer tonight's quiz on your own, then team up with someone else who finished; a team-up each way is a match.

**Architecture:** The quiz lives in the shows file and only on the relay (`relay/quiz.js` checks it). The room keeps each person's answers in a map that outlives leaving, scores them against the key, and gives a person their own questions and results in their view. The card is one more row in `relay/cards.js` and one more play in `relay/room.js`'s `plays` table, so matching, blocking, closing and the wristband reuse what the other three cards already do.

**Tech Stack:** Node 24 (relay, `node:test`), React + Vite (phone), PlatformIO C++ (`firmware/src/band_logic.h`, host-built by `tests/firmware.test.js`).

**Spec:** `docs/superpowers/specs/2026-10-13-lets-guess-design.md`

## Global Constraints

- Artefacts are English: code, comments, commits, docs, test names.
- Nothing from `../on-the-beat-research/` or `../on-the-beat-design/` enters the repository. The repository is public: no secrets.
- Never push to `cimi2232/DECO3500`. Push to `origin` (`LewisSwan24/on-the-beat`) when `npm test` is green.
- A quiz holds 1 to 5 questions. Each has `q` (1 to 140 characters), exactly 4 distinct `options` (1 to 60 characters each), `answer` (0 to 3), and an optional `fact` (at most 140 characters).
- Card: id `guess`, label `LET'S GUESS`, band words `LET'S GUESS!`, hue `#8FB4FF`, deep `#4F7FE0`, screens `quiz` (opens) and `teams`.
- `/api/shows` carries no `quiz`. No phone ever receives `answer` or `fact` for a question before that person locked it.
- Running one test file that needs `dist/`: `npm run build` first. Room and quiz tests do not need it.
- Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Send `git commit` as its own command (the ECC hook reads any `-n` beside it as `--no-verify`).
- Deploying to Fly and reflashing the four StickC Plus each wait for our explicit yes.

## Review Focus

1. **The same answer sent twice** (a double tap, or a queued answer replayed after reconnect): the second is refused, and the score counts it once. Pinned in Task 2.
2. **Staff close SAY HI, FIRST SONG? and LET'S DANCE! at a venue whose show has no quiz:** every card would be closed. Refuse, as closing every card is refused today. Pinned in Task 3 (it needs `guess` among the cards).
3. **A person whose socket dropped past the grace and who comes back:** their answers are still there. Pinned in Task 2.
4. **The shows file corrected mid-night** (restart with a changed quiz): old answers and team-ups are dropped, nobody keeps a score for questions they never saw. Pinned in Task 2.
5. **A teammate who disarms LET'S GUESS after you saw their row:** they leave your list, and a TEAM UP? sent to them is refused. Pinned in Task 3.

---

### Task 1: The quiz rules, and shows that keep the answers to themselves

**Files:**
- Create: `relay/quiz.js`
- Create: `tests/fixtures/quiz.json`
- Create: `tests/quiz.test.js`
- Modify: `relay/server.js` (imports; `loadShows`, `chooseShows` ~187-215; `showsJson` and `showsNow` ~303-322)

**Interfaces:**
- Produces: `quizFault(quiz) -> string` ('' when it stands), `quizOf(quiz) -> Question[]` (trimmed, only its own fields), `quizHash(quiz) -> string` (16 hex), `withoutQuiz(show) -> show`, `QUIZ_MAX = 5`. A `Question` is `{ q, options: string[4], answer: 0..3, fact }`.
- Produces: the shows a relay holds carry `quiz` as `quizOf(...)` output, or no `quiz`.

- [ ] **Step 1: Write the fixture**

`tests/fixtures/quiz.json`:

```json
[
  { "q": "Which country is Zara Larsson from?", "options": ["Norway", "Sweden", "Denmark", "Finland"], "answer": 1, "fact": "She grew up in Stockholm." },
  { "q": "At 10, Zara won a TV talent show. Which one?", "options": ["Idol", "The Voice", "Talang (Sweden's Got Talent)", "The X Factor"], "answer": 2, "fact": "She won Talang in 2008." },
  { "q": "Which song was the official song of UEFA Euro 2016?", "options": ["This One's for You", "Lush Life", "Symphony", "Ain't My Fault"], "answer": 0, "fact": "David Guetta featuring Zara Larsson." },
  { "q": "Who did Zara team up with on \"Symphony\"?", "options": ["Calvin Harris", "Kygo", "Marshmello", "Clean Bandit"], "answer": 3, "fact": "Clean Bandit featuring Zara Larsson, a UK number one in 2017." },
  { "q": "Her 2024 album shares its name with a planet. Which one?", "options": ["Mars", "Venus", "Saturn", "Jupiter"], "answer": 1, "fact": "Venus came out in February 2024." }
]
```

- [ ] **Step 2: Write the failing tests**

`tests/quiz.test.js`:

```js
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
```

- [ ] **Step 3: Run them to see them fail**

Run: `node --test tests/quiz.test.js`
Expected: FAIL, `Cannot find module '../relay/quiz.js'`.

- [ ] **Step 4: Write `relay/quiz.js`**

```js
// ON THE BEAT — LET'S GUESS's questions, as a show in the shows file carries them
// (docs/superpowers/specs/2026-10-13-lets-guess-design.md §1). The relay keeps the
// answers: a phone gets a question's answer and fact only once it locked one in.

import { createHash } from 'node:crypto';

export const QUIZ_MAX = 5;
const Q_MAX = 140;
const OPTION_MAX = 60;
const FACT_MAX = 140;

const text = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;

/** What is wrong with a show's quiz, or '' when it stands. */
export function quizFault(quiz) {
  if (!Array.isArray(quiz) || quiz.length < 1 || quiz.length > QUIZ_MAX) return `"quiz" must be a list of 1 to ${QUIZ_MAX} questions`;
  for (const [i, x] of quiz.entries()) {
    const n = 'question ' + (i + 1);
    if (!x || typeof x !== 'object' || Array.isArray(x)) return n + ' is not a question';
    if (!text(x.q, Q_MAX)) return `${n}: "q" must be text of 1 to ${Q_MAX} characters`;
    if (!Array.isArray(x.options) || x.options.length !== 4 || !x.options.every((o) => text(o, OPTION_MAX))) {
      return `${n}: "options" must be 4 texts of 1 to ${OPTION_MAX} characters`;
    }
    if (new Set(x.options.map((o) => o.trim().toLowerCase())).size !== 4) return `${n}: the 4 options must differ`;
    if (!Number.isInteger(x.answer) || x.answer < 0 || x.answer > 3) return `${n}: "answer" must be 0, 1, 2 or 3`;
    if (x.fact != null && !(typeof x.fact === 'string' && x.fact.length <= FACT_MAX)) return `${n}: "fact" must be text of at most ${FACT_MAX} characters`;
  }
  return '';
}

/** A quiz that stands, as the relay keeps it: its own fields, trimmed. */
export const quizOf = (quiz) => quiz.map((x) => ({
  q: x.q.trim(), options: x.options.map((o) => o.trim()), answer: x.answer, fact: (x.fact ?? '').trim(),
}));

/** A short print of a quiz: answers carried across a restart are for this quiz and no other. */
export const quizHash = (quiz) => createHash('sha256').update(JSON.stringify(quizOf(quiz))).digest('hex').slice(0, 16);

/** A show as phones are given it: everything but its quiz. */
export const withoutQuiz = ({ quiz: _, ...show }) => show;
```

- [ ] **Step 5: Check quizzes as shows are read, and strip them from the list phones get**

In `relay/server.js`, add to the imports:

```js
import { quizFault, quizOf, withoutQuiz } from './quiz.js';
```

Below `showFault`, add:

```js
/** A show with its quiz as the relay keeps it, or with none: a quiz that breaks a rule is dropped and said, and the show stands. */
const quizChecked = (s, say, file) => {
  if (s.quiz == null) return withoutQuiz(s);
  const fault = quizFault(s.quiz);
  if (!fault) return { ...s, quiz: quizOf(s.quiz) };
  say(`shows: the quiz of "${shown(s.id)}" in ${file} dropped: ${fault}`);
  return withoutQuiz(s);
};
```

Change `loadShows` to:

```js
export function loadShows(file) {
  return (readShowsFile(file).all ?? []).filter((s) => !showFault(s)).map((s) => quizChecked(s, () => {}, file));
}
```

In `chooseShows`, change `else kept.push(s);` to:

```js
    else kept.push(quizChecked(s, say, file));
```

Change `const showsJson = JSON.stringify(shows);` to:

```js
  // A quiz's answers stay here: the list phones are given never carries one (docs/superpowers/specs/2026-10-13-lets-guess-design.md §1).
  const showsJson = JSON.stringify(shows.map(withoutQuiz));
```

and in `showsNow`, change the mapping to:

```js
    const list = shows.map((s) => {
      const t = rooms.get(s.id)?.room.times();
      if (!t) return withoutQuiz(s);
      moved = true;
      const { at: _, ...five } = t;
      return { ...withoutQuiz(s), ...five };
    });
```

Then search for any other place a show is serialised to a client:

Run: `grep -nE "JSON.stringify\(.*show|show:" relay/server.js`
Expected: only the two places above, plus places that send a single field (act, venue). If a whole show object is sent anywhere else, wrap it in `withoutQuiz(...)` the same way.

- [ ] **Step 6: Run the tests**

Run: `node --test tests/quiz.test.js`
Expected: PASS, 5 tests.

- [ ] **Step 7: Commit**

```bash
git add relay/quiz.js relay/server.js tests/quiz.test.js tests/fixtures/quiz.json docs/superpowers/specs/2026-10-13-lets-guess-design.md docs/superpowers/plans/2026-10-13-lets-guess.md
git commit -m "LET'S GUESS: a show's quiz, checked as it is read and never in the venue list" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The room answers, scores and remembers

**Files:**
- Modify: `relay/room.js` (import; `createRoom` options; state near `likes` ~168; `isClosed` ~188; restore ~199-240; `forgetPerson` ~316; `setClosed` ~506; `viewFor` ~905; `dump` ~950; the returned object)
- Create: `tests/guess.test.js`

**Interfaces:**
- Consumes: `quizHash(quiz)` from Task 1; a quiz as `quizOf` returns it.
- Produces: `createRoom({ quiz })` (quiz or null); `room.answer(id, q, choice) -> boolean`; `viewFor(id).quiz` = `null` or `{ questions: [{ q, options }], answered: [{ choice, right, answer, fact }], done: boolean, score: { right, of } }`; `dump().answers` (`[id, choices[]][]`), `dump().quizHash` (string or null). Inside the room: `doneOf(id)`, `scoreOf(id)`, `answers` map, used by Task 3.

- [ ] **Step 1: Write the failing tests**

`tests/guess.test.js`:

```js
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
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --test tests/guess.test.js`
Expected: FAIL, `r.answer is not a function`.

- [ ] **Step 3: Give the room its quiz and its answers**

In `relay/room.js`:

Add to the imports:

```js
import { quizHash } from './quiz.js';
```

Add to `createRoom`'s options, after `spots = SPOTS,`:

```js
  // Tonight's LET'S GUESS questions, with their answers, as relay/quiz.js keeps them; null for a show with none.
  quiz = null,
```

After `const dances = new Map(); ...`, add:

```js
  const answers = new Map();  // id -> [choice, ...] in question order (LET'S GUESS); outlives leave(), as likes do
```

Change `isClosed`:

```js
  // LET'S GUESS is closed where the show has no quiz: there is nothing to answer.
  const isClosed = (id) => !!closed?.cards.includes(id) || (id === 'guess' && !quiz);
```

At the end of the `if (restore) { ... }` block, before its closing brace, add:

```js
    // Answers are for the quiz they were given against: a corrected quiz starts everyone again.
    if (quiz && restore.quizHash === quizHash(quiz)) {
      for (const [id, list] of Array.isArray(restore.answers) ? restore.answers : []) {
        if (typeof id === 'string' && Array.isArray(list)) answers.set(id, list.filter((c) => Number.isInteger(c) && c >= 0 && c <= 3).slice(0, quiz.length));
      }
    }
```

After the `canSee`/`shows` helpers (before `function join`), add:

```js
  // ---------- LET'S GUESS: answers ----------
  const doneOf = (id) => !!quiz && (answers.get(id)?.length ?? 0) >= quiz.length;
  const scoreOf = (id) => {
    const list = answers.get(id) ?? [];
    return { right: quiz ? list.filter((c, i) => c === quiz[i].answer).length : 0, of: quiz ? quiz.length : 0 };
  };

  /** LET'S GUESS: a person's answer to the first question they have not answered. Final once given; true when taken. */
  function answer(id, q, choice) {
    if (!quiz || isClosed('guess') || !people.has(id)) return false;
    const list = answers.get(id) ?? [];
    if (q !== list.length || q >= quiz.length || !Number.isInteger(choice) || choice < 0 || choice > 3) return false;
    answers.set(id, [...list, choice]);
    return true;
  }
```

In `forgetPerson`, after `latest.delete(id);`, add:

```js
    answers.delete(id);
```

In `setClosed`, after `const ids = closedOf(list);`, add:

```js
    // Never every card: LET'S GUESS with no quiz counts as closed already.
    if (ids && INTENTS.every((c) => ids.includes(c) || (c === 'guess' && !quiz))) return false;
```

In `viewFor`, after the `cards: ...` line, add:

```js
      // LET'S GUESS: the questions, and for each one this person answered, how it went. Never anyone else's.
      quiz: quiz && !isClosed('guess') ? {
        questions: quiz.map(({ q, options }) => ({ q, options: [...options] })),
        answered: (answers.get(id) ?? []).map((c, i) => ({ choice: c, right: c === quiz[i].answer, answer: quiz[i].answer, fact: quiz[i].fact })),
        done: doneOf(id),
        score: scoreOf(id),
      } : null,
```

In `dump`, after `card: ...`, add:

```js
      answers: [...answers],
      quizHash: quiz ? quizHash(quiz) : null,
```

In the returned object, change `wave,wavedAtYou, ...` to also export `answer`:

```js
    wave,wavedAtYou, wavesAt, like, unlike, danceBack, block, answer,
```

Note: `cards: INTENTS.filter(...)` and the play lists still list three cards; `guess` joins `INTENTS` in Task 3, and the `cards` assertion in the no-quiz test holds either way.

- [ ] **Step 4: Run the tests**

Run: `node --test tests/guess.test.js tests/room.test.js tests/rules.test.js`
Expected: PASS. (The `setClosed` guard is not tested yet: while `INTENTS` holds three cards, `closedOf` already refuses closing all three, and `closedOf` refuses `'guess'` as unknown. Its tests land in Task 3, once `guess` is a card.)

- [ ] **Step 5: Commit**

```bash
git add relay/room.js tests/guess.test.js
git commit -m "LET'S GUESS: the room takes answers in order, scores them, and keeps them across a restart" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The fourth card, everywhere a card is named, and its team-up

**Files:**
- Modify: `relay/cards.js` (CARDS)
- Modify: `relay/room.js` (`teams` map; `plays.guess`; `matchIfMutual` scores; `viewFor` match scores; `forgetPerson`; restore; `dump`; returned `team`)
- Modify: `app/copy.js` (WORDS.guess; HOW.cards, HOW.both; GUIDE side-press text; GUIDE.lights.cards.guess)
- Modify: `app/styles.css` (line 22 hues; option styles)
- Modify: `app/fonts/fonts.json` and `app/fonts/material-symbols-outlined.woff2` (by `npm run fonts`)
- Modify: `firmware/src/band_logic.h` (CARDS ~264)
- Modify: `tests/fixtures/wrist-cases.json` (cases that spell the SIDE cycle)
- Modify: `tests/cards.test.js`
- Modify: `tests/guess.test.js`

**Interfaces:**
- Consumes: `doneOf`, `scoreOf`, `answers`, `createRoom({ quiz })` from Task 2.
- Produces: `room.team(viewer, handle) -> false | null | match`; `viewFor(id).teams` = `[{ handle, band, score: { right, of }, asked }]`; a match's view gains `score` and `yourScore` (`{ right, of }` or null); the card `guess` in `INTENTS` with screens `quiz`, `teams`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/guess.test.js`:

```js
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
  answerAll(r, 'ben', [RIGHT[0], RIGHT[1], 0, 0, 0]);
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
```

In `tests/cards.test.js`:

Change the first test's name and its first assertion:

```js
test('the cards are the canvas three and LET\'S GUESS, in order, and what the relay lets you arm', () => {
  assert.deepEqual(INTENTS, ['hi', 'song', 'dance', 'guess']);
```

Change the `INTENT_OF` assertion to:

```js
  assert.deepEqual(INTENT_OF, { beacon: 'hi', near: 'hi', pick: 'song', wall: 'song', camera: 'dance', floor: 'dance', quiz: 'guess', teams: 'guess' }, 'each screen, in its card');
```

Add, after the imports:

```js
const QUIZ = JSON.parse(read('./fixtures/quiz.json'));
```

Add to the `YES` table:

```js
  guess: { ready: (room, a) => QUIZ.forEach((x, q) => room.answer(a, q, x.answer)), send: (room, a, h) => room.team(a, h) },
```

In the last test, change both `createRoom({ salt: 'c' })` calls to `createRoom({ salt: 'c', quiz: QUIZ })`.

- [ ] **Step 2: Run them to see them fail**

Run: `node --test tests/guess.test.js tests/cards.test.js`
Expected: FAIL: `r.team is not a function`; `INTENTS` lacks `guess`.

- [ ] **Step 3: Add the card to the table**

In `relay/cards.js`, after the `dance` entry:

```js
  { id: 'guess', label: "LET'S GUESS", band: "LET'S GUESS!", c: '#8FB4FF', g: '#4F7FE0', open: 'quiz', screens: ['quiz', 'teams'] },
```

and change the header comment's "Every card a person can arm" paragraph only if it names three; it does not, so leave it.

- [ ] **Step 4: Its play in the room**

In `relay/room.js`:

After the `answers` map, add:

```js
  const teams = new Map();    // 'a>b' -> true: a asked b to team up (LET'S GUESS)
```

In the restore block, inside the `if (quiz && restore.quizHash === quizHash(quiz)) { ... }`, after the answers loop, add:

```js
      for (const k of Array.isArray(restore.teams) ? restore.teams : []) if (typeof k === 'string') teams.set(k, true);
```

In `forgetPerson`, change the map loop to include `teams`:

```js
    for (const map of [waves, likes, dances, teams]) for (const k of [...map.keys()]) if (theirs(k)) map.delete(k);
```

In `matchIfMutual`, after `picks: ...`, add:

```js
      scores: { [a]: quiz && doneOf(a) ? scoreOf(a) : null, [b]: quiz && doneOf(b) ? scoreOf(b) : null },
```

In `plays`, after `dance: { ... },`, add:

```js
    // LET'S GUESS: a team-up, between two people who both finished tonight's quiz.
    guess: {
      yeses: teams,
      may: (viewer, t) => doneOf(viewer) && doneOf(t) && people.get(t).armed === 'guess',
      take: (viewer, t) => { teams.set(viewer + '>' + t, true); },
      // Everyone who finished and is looking for a teammate, with their score and never their answers.
      // Nobody until you finish yourself.
      list: 'teams',
      rows: (id, others, row) => (doneOf(id) ? others.filter((p) => p.armed === 'guess' && doneOf(p.id)).map((p) => ({
        ...row(p), score: scoreOf(p.id), asked: teams.has(id + '>' + p.id),
      })) : []),
    },
```

After `const danceBack = ...`, add:

```js
  const team = (viewer, h) => yes('guess', viewer, h);
```

In `viewFor`'s match mapping, after `pick: m.picks[other], yourPick: m.picks[id],`, add:

```js
          score: m.scores?.[other] ?? null, yourScore: m.scores?.[id] ?? null,
```

In `dump`, after `answers: [...answers],`, add:

```js
      teams: [...teams.keys()],
```

In the returned object, add `team` after `answer`.

- [ ] **Step 5: Its words, colours and icon on the phone**

In `app/copy.js`, add to `WORDS` after `dance`:

```js
  guess: () => ({ icon: 'quiz', title: "LET'S GUESS!", atitle: "LET'S GUESS!",
    idle: ['Ready?', 'Tap to test', 'what you know'], armed: ['Answer, then find', 'a teammate'] }),
```

Change `HOW`:

```js
  cards: 'Four cards. SAY HI waves at someone near. FIRST SONG? guesses the opener. LET’S DANCE! puts a clip on the floor. LET’S GUESS! is tonight’s quiz.',
  both: 'A match needs you both: a wave waved back, a pick liked both ways, a dance danced back, a team-up both ways. Only then a name, and where to meet.',
```

In `GUIDE.screens`, in the row whose face is `['READY', 'SIDE TO CHANGE']`, change `steps HI, SONG, DANCE, OFF` to `steps HI, SONG, DANCE, GUESS, OFF`.

In `GUIDE.lights.cards`, add:

```js
    guess: "your colour while LET'S GUESS! is armed",
```

In `app/styles.css`, change line 22 to:

```css
  --hi: #4ED7F1; --hi-g: #0C9DE2; --song: #F2D65E; --song-g: #C79A1E; --dance: #DA8CF2; --dance-g: #A93FD9; --guess: #8FB4FF; --guess-g: #4F7FE0;
```

and append (first run `grep -n "\.opt\b" app/styles.css` and expect no match):

```css
/* LET'S GUESS: an option, then how it went once the relay says. */
.opt { min-height: 52px; width: 100%; text-align: left; padding: 12px 16px; border-radius: 14px; border: 1.5px solid var(--line); background: var(--ink-2); color: #fff; font: var(--body-l); }
.opt[aria-pressed="true"] { border-color: var(--guess); box-shadow: 0 0 24px -12px var(--guess-g); }
.opt.right { border-color: var(--ok); }
.opt.wrong { border-color: var(--stop); }
```

Then cut the icon font again for the new icon:

Run: `npm run fonts`
Expected: `app/fonts/fonts.json` lists `quiz` among `icons.names`, and `app/fonts/material-symbols-outlined.woff2` is rewritten.

- [ ] **Step 6: The wristband's copy of the table**

In `firmware/src/band_logic.h`, in `constexpr Hue CARDS[]`, after the `dance` line:

```cpp
  {"guess", {0x8F, 0xB4, 0xFF}, {0x4F, 0x7F, 0xE0}, "LET'S GUESS!"},
```

- [ ] **Step 7: The wrist cases that spell out the SIDE cycle**

In `tests/fixtures/wrist-cases.json`, the case containing (line ~97):

```json
        { "at": "3000", "press": 2, "face": { "big": "LET'S DANCE!", "ink": "dance" } },
        { "at": "4000", "press": 2, "face": { "big": "OFF", "small": "SIDE: NEXT", "ink": "text2" } },
        { "at": "4100+COMMIT_MS-1", "face": { "big": "OFF", "small": "SIDE: NEXT" } },
        { "at": "4100+COMMIT_MS", "sent": [{ "t": "set", "intent": null, "basis": 3 }], "face": { "big": "OFF", "small": "SENDING" } },
        { "at": "7500", "show": "OFF", "rev": 4, "sounds": ["up"], "face": { "big": "", "field": "white", "light": "LIGHT_FULL" } },
        { "at": "7500+500", "face": { "big": "READY", "small": "SET", "light": "LIGHT_AWAKE" } },
```

becomes:

```json
        { "at": "3000", "press": 2, "face": { "big": "LET'S DANCE!", "ink": "dance" } },
        { "at": "4000", "press": 2, "face": { "big": "LET'S GUESS!", "ink": "guess" } },
        { "at": "5000", "press": 2, "face": { "big": "OFF", "small": "SIDE: NEXT", "ink": "text2" } },
        { "at": "5100+COMMIT_MS-1", "face": { "big": "OFF", "small": "SIDE: NEXT" } },
        { "at": "5100+COMMIT_MS", "sent": [{ "t": "set", "intent": null, "basis": 3 }], "face": { "big": "OFF", "small": "SENDING" } },
        { "at": "8500", "show": "OFF", "rev": 4, "sounds": ["up"], "face": { "big": "", "field": "white", "light": "LIGHT_FULL" } },
        { "at": "8500+500", "face": { "big": "READY", "small": "SET", "light": "LIGHT_AWAKE" } },
```

and the case with `"with": { "closed": "song" }` (line ~1471):

```json
        { "at": "3000", "press": 2, "face": { "big": "LET'S DANCE!", "small": "SIDE: NEXT", "ink": "dance" } },
        { "at": "4000", "press": 2, "face": { "big": "OFF", "small": "SIDE: NEXT" } },
        { "at": "5000", "press": 2, "face": { "big": "HI :)", "small": "SIDE: NEXT", "ink": "hi" } },
        { "at": "6000", "press": 2, "face": { "big": "LET'S DANCE!", "small": "SIDE: NEXT", "ink": "dance" } },
        { "at": "6100+COMMIT_MS", "sent": [{ "t": "set", "intent": "dance", "basis": 3 }], "face": { "big": "LET'S DANCE!", "small": "SENDING" } }
```

becomes:

```json
        { "at": "3000", "press": 2, "face": { "big": "LET'S DANCE!", "small": "SIDE: NEXT", "ink": "dance" } },
        { "at": "4000", "press": 2, "face": { "big": "LET'S GUESS!", "small": "SIDE: NEXT", "ink": "guess" } },
        { "at": "5000", "press": 2, "face": { "big": "OFF", "small": "SIDE: NEXT" } },
        { "at": "6000", "press": 2, "face": { "big": "HI :)", "small": "SIDE: NEXT", "ink": "hi" } },
        { "at": "7000", "press": 2, "face": { "big": "LET'S DANCE!", "small": "SIDE: NEXT", "ink": "dance" } },
        { "at": "7100+COMMIT_MS", "sent": [{ "t": "set", "intent": "dance", "basis": 3 }], "face": { "big": "LET'S DANCE!", "small": "SENDING" } }
```

A band on older firmware sent `guess` is already covered: the existing case "a found without a whole number plays nothing, and one whose card is not a card flashes white" in the same file pins that an unknown card shows no other card's colour. Leave it as it is.

Run: `npm run build && node --test tests/wrist.test.js tests/firmware.test.js tests/guide.test.js`
Expected: PASS. If another case fails because a SIDE press after `LET'S DANCE!` now shows `LET'S GUESS!` where it expected `OFF`, make the same edit to it: insert the `LET'S GUESS!` step one second after the `LET'S DANCE!` step, and move every later `at` of that case one second (1000) later. If a failing case is about anything else, stop and look.

- [ ] **Step 8: Run the card and guess tests**

Run: `node --test tests/guess.test.js tests/cards.test.js tests/fonts.test.js`
Expected: PASS.

- [ ] **Step 9: Run everything**

Run: `npm test`
Expected: PASS (the count grows by the new tests; 6 skipped as before).

- [ ] **Step 10: Commit**

```bash
git add relay/cards.js relay/room.js app/copy.js app/styles.css app/fonts firmware/src/band_logic.h tests/fixtures/wrist-cases.json tests/cards.test.js tests/guess.test.js
git commit -m "LET'S GUESS: the fourth card in every copy of the table, and its team-up" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The relay gives each room its show's quiz, and takes answers and team-ups

**Files:**
- Modify: `relay/server.js` (`quizFor` beside `spotsFor` ~356; `roomFor` ~369; restore ~1641; message switch ~1133)
- Create: `tests/guess-relay.test.js`

**Interfaces:**
- Consumes: `room.answer`, `room.team` (Tasks 2-3); shows that carry `quiz` (Task 1).
- Produces: socket messages `{ t: 'answer', q, choice }` and `{ t: 'team', handle }`.

- [ ] **Step 1: Write the failing tests**

`tests/guess-relay.test.js`:

```js
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
```

- [ ] **Step 2: Run them to see them fail**

Run: `npm run build && node --test tests/guess-relay.test.js`
Expected: FAIL: `v.quiz` is null for the listed venue (the room was made with no quiz).

- [ ] **Step 3: Give each room its show's quiz, and take the two messages**

In `relay/server.js`, after `spotsFor`, add:

```js
  /** Tonight's LET'S GUESS questions for a venue, with their answers, or null for a show with none. */
  function quizFor(key) {
    return shows.find((s) => s.id === key)?.quiz ?? null;
  }
```

In `roomFor`, change `createRoom({ spots: spotsFor(key), now, ledger: handles })` to:

```js
createRoom({ spots: spotsFor(key), quiz: quizFor(key), now, ledger: handles })
```

In the restore (`built = { rooms: saved.rooms.map(...)`), change `createRoom({ spots: spotsFor(e.key), now, restore: e.room, ...` to:

```js
createRoom({ spots: spotsFor(e.key), quiz: quizFor(String(e.key)), now, restore: e.room, ledger: handles, clipKept: (ref) => back[i].has(ref) })
```

In the message switch, after `case 'unlike': ...`, add:

```js
      case 'answer': room.answer(me, m.q, m.choice); break;
      case 'team': room.team(me, m.handle); break;
```

- [ ] **Step 4: Run the tests**

Run: `npm run build && node --test tests/guess-relay.test.js tests/server.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add relay/server.js tests/guess-relay.test.js
git commit -m "LET'S GUESS: each room gets its show's quiz; answers and team-ups travel" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The phone's two screens, and the match that shows two scores

**Files:**
- Create: `app/lib/guess.js`
- Create: `tests/guess-lib.test.js`
- Create: `app/screens/Guess.jsx`
- Modify: `app/App.jsx` (imports ~19-28; `EMPTY` ~32; `barFor` ~871; screen switch ~931)
- Modify: `app/screens/Met.jsx` (Match's `<div className="pair">` ~37-53)

**Interfaces:**
- Consumes: `view.quiz`, `view.teams`, a match's `score`/`yourScore` (Tasks 2-4); messages `answer`, `team` (Task 4).
- Produces: `quizNow(quiz) -> null | { total, index, current, done, score }`; `scoreText(score) -> string`; components `Quiz`, `Teams`.

- [ ] **Step 1: Write the failing tests**

`tests/guess-lib.test.js`:

```js
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
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --test tests/guess-lib.test.js`
Expected: FAIL, `Cannot find module '../app/lib/guess.js'`.

- [ ] **Step 3: Write `app/lib/guess.js`**

```js
// LET'S GUESS on the phone: where a person is in tonight's quiz, read from their own view.

/** From a view's `quiz`: null when there is none here, else how far they are and how they did. */
export function quizNow(quiz) {
  if (!quiz || !Array.isArray(quiz.questions) || !quiz.questions.length) return null;
  const answered = Array.isArray(quiz.answered) ? quiz.answered : [];
  const index = Math.min(answered.length, quiz.questions.length);
  return {
    total: quiz.questions.length,
    index,
    current: quiz.questions[index] ?? null,
    done: !!quiz.done,
    score: quiz.score ?? { right: 0, of: quiz.questions.length },
  };
}

/** A score as a list and a match show it: "3/5", or '' for none. */
export const scoreText = (s) => (s && Number.isInteger(s.right) && Number.isInteger(s.of) && s.of > 0 ? s.right + '/' + s.of : '');
```

Run: `node --test tests/guess-lib.test.js`
Expected: PASS.

- [ ] **Step 4: Write the screens**

`app/screens/Guess.jsx`:

```jsx
import { useEffect, useRef, useState } from 'react';
import { someone } from '../copy.js';
import { quizNow, scoreText } from '../lib/guess.js';
import { Back, Icon, More } from '../ui.jsx';

/** One question's options: pick one, or, once answered, see which was right. */
function Options({ options, chosen, result, onChoose }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {options.map((o, i) => {
        const cls = result ? (i === result.answer ? 'opt right' : i === result.choice ? 'opt wrong' : 'opt') : 'opt';
        return (
          <button key={o} type="button" className={cls} aria-pressed={!result && chosen === i} disabled={!!result} onClick={() => onChoose(i)}>
            {o}
          </button>
        );
      })}
    </div>
  );
}

/** LET'S GUESS — tonight's questions, one at a time. An answer is final, and only the relay knows the right one. */
export function Quiz({ quiz, offline, onBack, onAnswer, onTeams }) {
  const now = quizNow(quiz);
  const answeredN = quiz?.answered?.length ?? 0;
  const [chosen, setChosen] = useState(null);
  const [sent, setSent] = useState(-1);      // the question this phone locked and is waiting to hear about
  const [review, setReview] = useState(null); // an answered question shown with how it went, until NEXT
  const seen = useRef(answeredN);
  useEffect(() => {
    if (answeredN > seen.current) { setReview(answeredN - 1); setChosen(null); }
    seen.current = answeredN;
  }, [answeredN]);

  if (!now) {
    return (
      <div className="scr">
        <Back onClick={onBack} />
        <div className="empty">
          <span className="h2">No quiz here tonight.</span>
          <span className="body muted">LET'S GUESS needs tonight's questions, and this venue has none.</span>
        </div>
      </div>
    );
  }

  if (review !== null && quiz.answered[review]) {
    const r = quiz.answered[review];
    const last = review + 1 >= now.total;
    return (
      <div className="scr">
        <Back onClick={onBack} />
        <span className="micro" style={{ color: 'var(--guess)', marginTop: 6 }}>question {review + 1} of {now.total}</span>
        <h1 className="h1" style={{ margin: '6px 0 16px' }}>{quiz.questions[review].q}</h1>
        <Options options={quiz.questions[review].options} result={r} />
        <div className="row" role="status" style={{ marginTop: 16, flexDirection: 'row', alignItems: 'flex-start', gap: 10, borderColor: r.right ? 'var(--ok)' : 'var(--stop)' }}>
          <Icon name={r.right ? 'check_circle' : 'cancel'} size={19} color={r.right ? 'var(--ok)' : 'var(--stop)'} />
          <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span className="h2">{r.right ? 'Right!' : 'Not this one.'}</span>
            {r.fact ? <span className="small">{r.fact}</span> : null}
          </span>
        </div>
        <div style={{ marginTop: 'auto', padding: '16px 0 20px' }}>
          {last
            ? <button type="button" className="cta" style={{ '--c': 'var(--guess)' }} onClick={onTeams}>FIND A TEAMMATE · {scoreText(now.score)}</button>
            : <button type="button" className="cta" style={{ '--c': 'var(--guess)' }} onClick={() => setReview(null)}>NEXT QUESTION</button>}
        </div>
      </div>
    );
  }

  if (now.done) {
    return (
      <div className="scr">
        <Back onClick={onBack} />
        <h1 className="h1" style={{ margin: '6px 0 8px' }}>You got {scoreText(now.score)}.</h1>
        <span className="body muted">Now find a teammate: someone else here who finished. Nobody sees your answers, only your score.</span>
      </div>
    );
  }

  const waiting = sent === now.index;
  return (
    <div className="scr">
      <Back onClick={onBack} />
      <span className="micro" style={{ color: 'var(--guess)', marginTop: 6 }}>question {now.index + 1} of {now.total}</span>
      <h1 className="h1" style={{ margin: '6px 0 16px' }}>{now.current.q}</h1>
      <Options options={now.current.options} chosen={chosen} onChoose={(i) => !waiting && setChosen(i)} />
      <div style={{ marginTop: 'auto', padding: '16px 0 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {waiting ? <span className="small" role="status">{offline ? 'Saved. It’ll check when you’re back.' : 'Checking…'}</span> : null}
        <button type="button" className="cta" style={{ '--c': 'var(--guess)' }} disabled={chosen === null || waiting}
          onClick={() => { setSent(now.index); onAnswer(now.index, chosen); }}>
          LOCK IT IN
        </button>
        <span className="small">nobody sees your answers. only your score, once you finish.</span>
      </div>
    </div>
  );
}

/** LET'S GUESS's list — people who finished and want a teammate, by score. Team up, and if they team up back, you meet. */
export function Teams({ teams, score, onBack, onTeam, onMore }) {
  const [pending, setPending] = useState({});
  useEffect(() => setPending({}), [teams]);
  const asked = (t) => !!(pending[t.handle] || t.asked);
  return (
    <div className="scr">
      <Back onClick={onBack} />
      <h1 className="h1" style={{ margin: '6px 0 4px' }}>Find a teammate</h1>
      <span className="small" style={{ marginBottom: 12 }}>
        {score ? 'you got ' + scoreText(score) + '. ' : ''}a team-up both ways is a match — then a name, and where to meet.
      </span>
      <div className="scroll">
        {teams.length === 0 ? (
          <div className="empty">
            <span className="h2">Nobody else has finished yet.</span>
            <span className="body muted">Stay armed and they'll show up here.</span>
          </div>
        ) : null}
        {teams.map((t) => {
          const on = asked(t);
          return (
            <div key={t.handle} className="row" style={{ gap: 9, borderColor: on ? 'var(--guess)' : undefined }}>
              <div className="person" style={{ gap: 9 }}>
                <Icon name="quiz" size={19} color="var(--guess)" />
                <span className="h2" style={{ flex: 1, minWidth: 0 }}>{scoreText(t.score)}</span>
                <More className="more" onClick={() => onMore(t.handle, someone(t.band))} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingRight: 6 }}>
                <span className="small">{on ? 'You asked to team up' : someone(t.band)}</span>
                <button type="button" className="btn-s" aria-pressed={on} disabled={on}
                  onClick={() => { setPending((p) => ({ ...p, [t.handle]: true })); onTeam(t.handle); }}
                  style={{ margin: '-6px 0', '--c': on ? 'var(--guess)' : 'var(--line)', '--f': on ? 'var(--guess)' : '#fff' }}>
                  {on ? 'ASKED' : 'TEAM UP?'}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

Before using `className="cta"`, check it exists:

Run: `grep -nE "^\.cta|\.cta[ ,{]" app/styles.css; grep -n "export function Cta" app/ui.jsx`
Expected: one of them exists. If the stylesheet has no `.cta` but `ui.jsx` exports `Cta`, replace each `<button type="button" className="cta" style={{ '--c': 'var(--guess)' }} ...>` with `<Cta hue="guess" ...>` (props `onClick`, `disabled`), importing `Cta` from `'../ui.jsx'`.

- [ ] **Step 5: Wire them into the app**

In `app/App.jsx`:

Add to the imports, after the `Song.jsx` import:

```js
import { Quiz, Teams } from './screens/Guess.jsx';
```

Change `EMPTY` to:

```js
const EMPTY = { me: null, near: [], wall: [], floor: [], teams: [], quiz: null, matches: [] };
```

In `barFor`, after `floor: ...`, add:

```js
    quiz: view.quiz?.done ? { label: 'FIND A TEAMMATE', tap: () => go('teams') } : null,
    teams: { label: 'POCKET IT', tap: () => go('home') },
```

In the screen switch, after `case 'floor': ...`, add:

```jsx
    case 'quiz':
      body = <Quiz quiz={view.quiz} offline={status === 'offline'} onBack={back}
        onAnswer={(q, choice) => net.current?.send({ t: 'answer', q, choice })} onTeams={() => go('teams')} />;
      break;
    case 'teams':
      body = <Teams teams={view.teams || []} score={view.quiz?.score} onBack={back}
        onTeam={(handle) => net.current?.send({ t: 'team', handle })} onMore={personSheet} />;
      break;
```

In `app/screens/Met.jsx`, add `import { scoreText } from '../lib/guess.js';` and, in `Match`, wrap the existing `<div className="pair"> ... </div>` so a LET'S GUESS match shows the two scores where the picks would be:

```jsx
        {match.intent === 'guess' ? (
          <div className="pair">
            <div>
              <span className="micro">you</span>
              <span className="body">{scoreText(match.yourScore)}</span>
            </div>
            <div>
              <span className="micro" style={{ color: 'var(--c)' }}>{name}</span>
              <span className="body">{scoreText(match.score)}</span>
            </div>
          </div>
        ) : (
          /* the existing <div className="pair"> ... </div>, unchanged */
        )}
```

(Move the existing `<div className="pair">` block, unchanged, into the second branch in place of the comment.)

- [ ] **Step 6: Build, run the suite, and look at it**

Run: `npm test`
Expected: PASS.

Then `npm start` (Bash, `run_in_background`), and in the built-in browser at 375×812, with two tabs at `http://localhost:8790/` seeded as in CLAUDE.md "Verifying the phone in a browser" with `show: { id: 'test-night-zara-larsson', room: 'test-night-zara-larsson', venue: 'ON THE BEAT test night', act: 'ZARA LARSSON' }` and different `me` values (this needs Task 6's show in `relay/shows.json`; if Task 6 is not done yet, start the relay with `SHOWS` pointing at a file holding that show and the fixture quiz):
- tab A: arm LET'S GUESS, open it, answer all five (one deliberately wrong); see Right!/Not this one. with the fact, then "You got 4/5." and FIND A TEAMMATE;
- tab B: the same;
- each tab's teammate list shows the other's score; TEAM UP? on both; both show the match with "you 4/5" and the other's score;
- read `document.documentElement.scrollWidth` at 375 wide: 375.
Stop the relay by its port afterwards.

- [ ] **Step 7: Commit**

```bash
git add app/lib/guess.js tests/guess-lib.test.js app/screens/Guess.jsx app/App.jsx app/screens/Met.jsx
git commit -m "LET'S GUESS: the quiz and teammate screens, and a match that shows both scores" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Tonight's questions, the docs, the guards proved, and pushed

**Files:**
- Modify: `relay/shows.json`
- Modify: `README.md`, `docs/how-it-works.md`, `docs/show-night.md`, `docs/wristband-guide.md`, `docs/canvas.md`

- [ ] **Step 1: A test night with the quiz**

Append to the array in `relay/shows.json`:

```json
  {
    "id": "test-night-zara-larsson",
    "act": "ZARA LARSSON",
    "venue": "ON THE BEAT test night",
    "doors": "19:00", "support": "19:45", "break": "20:30", "headline": "20:45", "end": "22:30",
    "spots": ["by the door", "at the end of the bar", "by the cloakroom"],
    "setlist": ["Lush Life", "Never Forget You", "Symphony", "Ain't My Fault", "This One's for You", "Ruin My Life"],
    "quiz": <the five questions of tests/fixtures/quiz.json, copied verbatim>
  }
```

(Copy the array from `tests/fixtures/quiz.json` in place of the angle-bracket line; the shows file must stay plain JSON.)

Run: `node -e "import('./relay/server.js').then(m => console.log(m.chooseShows('relay/shows.json','relay/shows.json').find(s => s.id === 'test-night-zara-larsson').quiz.length))"`
Expected: `5`, and no `dropped` line.

- [ ] **Step 2: The docs**

- `README.md`: "You arm one of three cards" → "You arm one of four cards", and add after the LET'S DANCE! clause: "**LET'S GUESS!** (tonight's quiz: answer it, then team up with someone else who finished)".
- `docs/how-it-works.md`: in the table of what each kind of yes shows, add the row `| a team-up (LET'S GUESS!) | yes — a row of theirs shows ASKED to nobody; they see only your score until they team up back |` and in the `relay/shows.json` bullet add: "A show may carry `quiz`, one to five questions (`relay/quiz.js`); the relay keeps the answers, and the venue list phones get carries no quiz."
- `docs/show-night.md`, in "Changing tonight's shows": a short paragraph with the quiz format (the fixture's first question as the example) and the rules from Global Constraints, and that a bad quiz is dropped with a `shows: the quiz of …` log line while its show stands.
- `docs/wristband-guide.md`: "each press after steps HI, SONG, DANCE, OFF" → "HI, SONG, DANCE, GUESS, OFF", and in the lights table add `| LET'S GUESS (#8FB4FF) | your colour while LET'S GUESS! is armed |`.
- `docs/canvas.md`: a bullet "**A fourth card, LET'S GUESS!** The canvas has three. The owner chose on 13 Oct 2026, from the team's v3 flow, a quiz card: answer tonight's questions alone, then team up; the questions come with the show, and the relay keeps the answers."

Run: `npm test`
Expected: PASS (tests/guide.test.js holds the guide page to `app/copy.js`, which Task 3 changed the same way).

- [ ] **Step 3: Prove the guards that keep answers off phones**

For each mutation: make it, `npm run build` when the file is under `relay/` used by server tests, run the named test, see exactly that test go red, restore with `git checkout -- <file>`, rebuild.

| Mutation | File | Expected red |
|---|---|---|
| `JSON.stringify(shows.map(withoutQuiz))` → `JSON.stringify(shows)` | `relay/server.js` | `tests/quiz.test.js` "the venue list phones are given carries no quiz…" |
| in `viewFor`, `(answers.get(id) ?? []).map(` → `quiz.map((_, i) => (answers.get(id) ?? [])[i] ?? 0).map(` | `relay/room.js` | `tests/guess.test.js` "no view holds the answer or the fact…" |
| in `answer`, delete `q !== list.length \|\|` | `relay/room.js` | `tests/guess.test.js` "a person answers in order, once each…" |
| in `plays.guess.rows`, delete `&& doneOf(p.id)` | `relay/room.js` | `tests/guess.test.js` "teams: only people who finished…" |
| in `plays.guess.may`, delete `&& people.get(t).armed === 'guess'` | `relay/room.js` | `tests/guess.test.js` "no team-up to someone who has not finished, or who disarmed…" |

Run after restoring all: `git status --short` → only intended changes; `npm test` → PASS.

- [ ] **Step 4: Commit and push**

```bash
git add relay/shows.json README.md docs
git commit -m "LET'S GUESS: a test night with tonight's quiz, and the docs" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

```bash
git push -u origin lets-guess
```

Expected: the branch is on `origin`. It is not merged into `main`, not deployed, and no band is reflashed: each waits for our yes.
