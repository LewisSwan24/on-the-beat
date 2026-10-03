// ON THE BEAT — what the venue's staff tell every phone there: a notice, and the show's times when they move them.
//
// Both come in every view from the relay, the same for everyone. The phone tells its person once, as a toast; a
// notice is also kept on Tonight, and the times it draws are the moved ones until staff put them back.

import { DEFAULT_TIMES } from './phase.js';

const KEYS = Object.keys(DEFAULT_TIMES);
const NAMES = { doors: 'Doors', support: 'Support', break: 'Break', headline: 'Headline', end: 'End' };

/** The show as tonight runs it: its own, with the times staff moved, if they did. */
export function showWith(show, times) {
  if (!show || !times) return show;
  const moved = { ...show };
  for (const k of KEYS) if (typeof times[k] === 'string') moved[k] = times[k];
  return moved;
}

/** What moved, as a line: "Support 20:15 · Headline 21:50". Empty when nothing did. */
export function movedLine(before, after) {
  const was = (k) => before?.[k] || DEFAULT_TIMES[k];
  const now = (k) => after?.[k] || DEFAULT_TIMES[k];
  return KEYS.filter((k) => was(k) !== now(k)).map((k) => NAMES[k] + ' ' + now(k)).join(' · ');
}

/**
 * What a view's notice means for the phone's record of the night (`state`: noticeSeen, the `at` of the last one told).
 * Null when there is nothing to do; otherwise `patch` for the state, a line for Tonight (`event`) and a toast (`say`).
 * One taken down is not taken out of Tonight: it was said.
 */
export function noticeArrived(state = {}, view) {
  if (!view?.me) return null;   // not a view from the room yet
  const n = view.notice;
  if (!n?.text || state.noticeSeen === n.at) return null;
  return { patch: { noticeSeen: n.at }, event: 'the venue said: ' + n.text, say: 'From the venue: ' + n.text };
}

/**
 * What a view's times mean (`state`: timesSeen, the `at` of the moved times last told, or null). `show` is the show as
 * listed. Null when there is nothing to tell; otherwise `patch` and a toast saying what moved.
 */
export function timesArrived(state = {}, view, show) {
  if (!view?.me) return null;
  const t = view.times;
  const seen = state.timesSeen ?? null;
  if ((t?.at ?? null) === seen) return null;
  if (!t) return { patch: { timesSeen: null }, say: seen === null ? null : 'The times are back as listed.' };
  const what = movedLine(show, showWith(show, t));
  return { patch: { timesSeen: t.at }, say: what ? 'The venue moved the times: ' + what + '.' : null };
}

const nightMins = (hhmm) => {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm ?? '');
  if (!m) return null;
  const t = Number(m[1]) * 60 + Number(m[2]);
  return t < 360 ? t + 1440 : t;
};

/** The five times as a show lists them, each falling back to an ordinary evening's. */
export const fiveOf = (show) => Object.fromEntries(KEYS.map((k) => [k, show?.[k] || DEFAULT_TIMES[k]]));

/** Are these five clock times, none before the one ahead of it in the night? As the relay checks them. */
export function inOrder(times) {
  let last = -1;
  for (const k of KEYS) {
    const n = nightMins(times?.[k]);
    if (n === null || n < last) return false;
    last = n;
  }
  return true;
}

/** `times` with `key` and every time after it moved by `mins`: a late start pushes the rest of the night with it. */
export function shiftFrom(times, key, mins) {
  const out = { ...times };
  for (const k of KEYS.slice(KEYS.indexOf(key))) {
    const n = nightMins(out[k]);
    if (n === null) continue;
    const t = (((n + mins) % 1440) + 1440) % 1440;
    out[k] = String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0');
  }
  return out;
}
