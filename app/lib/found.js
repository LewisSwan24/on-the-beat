// Found each other, on the phone (docs/superpowers/specs/2026-09-26-wrist-found-
// design.md §1). Either person says it, from the wrist or from S11, and it
// counts only once both have. Then both phones say when, Tonight counts the
// meeting as met, and a phone buzzes only when no live wristband of its person
// plays it instead, as for a wave (app/lib/waved.js buzzes()).

import { MEET_MS } from '../../relay/band.js';
import { matchName } from '../copy.js';
import { hhmm } from './phase.js';

/**
 * The match a screen shows: the relay's live copy. A live view without it means the match is over — a block
 * from either side ends it — so nothing is shown, as the band shows nothing. Before any view, the stored copy.
 */
export const shownMatch = (view, stored, id) => {
  if (!id) return null;
  if (view?.me) return (view.matches || []).find((m) => m.id === id) || null;
  return stored?.[id] || null;
};

/** Tonight's matches a report can be about: the live ones, then any a block ended (the relay still takes those, F12). */
export const reportable = (view, stored) => {
  const live = view?.matches || [];
  const ids = new Set(live.map((m) => m.id));
  return [...live, ...Object.values(stored || {}).filter((m) => !ids.has(m.id))];
};

/** Where a meeting's screen goes as it is answered: found on either side moves on to S11; an ended one goes home. */
export const matchScreen = (screen, m) => {
  if (screen !== 'match' && screen !== 'mate') return screen;
  if (!m) return 'home';
  return screen === 'match' && (m.found || m.foundAt) ? 'mate' : screen;
};

/** S11 shows the number to look for while the meeting is on: under MEET_MS old, and not yet found by both. */
export const meetingOn = (m, now = Date.now()) => !m.foundAt && !m.finishedAt && now - m.at < MEET_MS;

/** The matches in a view found by both that the phone has not seen found before. */
export const newlyFound = (view, seen) => (view?.matches || []).filter((m) => m.foundAt && !seen.has(m.id));

/** Tonight's line for a meeting found by both: `met <name>`, at the time it was found. Null for one not found. */
export const metItem = (m) => (m.foundAt ? { at: m.foundAt, text: 'met ' + (m.name || matchName(m).toLowerCase()) } : null);

/** Tonight's count: the meetings found by both. A match never found is not a meeting. */
export const metCount = (stored) => stored.filter((m) => m.foundAt).length;

/** S11's words: said on your side, and said by both. */
export const FOUND_MINE = "found on your side. they won't know unless they say so too.";
export const foundBoth = (at) => 'you found each other at ' + hhmm(at);
