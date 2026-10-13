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
