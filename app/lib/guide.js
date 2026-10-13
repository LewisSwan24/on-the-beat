// ON THE BEAT — the wristband guide's logic (docs/superpowers/specs/2026-10-13-wristband-guide-design.md): whether a
// practice step is done, and the page's sound rows. Pure: every word is in app/copy.js (GUIDE).

import { GUIDE } from '../copy.js';
import { SOUNDS } from './wrist.js';

export const PRACTICE_STEPS = ['wake', 'card', 'dark', 'back', 'meet'];

/** What a step is measured from: the person's card, NOT NOW and rev when it began. */
export const snapshot = (view) => ({ armed: view?.me?.armed ?? null, invisible: !!view?.me?.invisible, rev: view?.me?.rev ?? 0 });

/** Is the person's wristband on the relay now, and not turned off? */
export const bandLive = (view) => !!(view?.me?.wristband?.live && !view.me.wristband.off);

/**
 * Has the wrist done this step since `before`? Only a change the band made counts (`by === 'band'`), and only in the
 * step's own direction. A wake is never heard by the relay, and the meeting is drawn: both are the person's to say.
 */
export function stepDone(step, before, view) {
  const me = view?.me;
  if (!me || me.by !== 'band' || !(me.rev > before.rev)) return false;
  if (step === 'card') return !me.invisible && (me.armed ?? null) !== before.armed;
  if (step === 'dark') return !!me.invisible && !before.invisible;
  if (step === 'back') return !me.invisible && !!before.invisible;
  return false;
}

/**
 * The taps that put back what the practice opened on (`was`: its card and NOT NOW then), as [kind, value] for
 * App.jsx to say in order. The relay refuses a tap that shows the person once their rev has moved, so at most one
 * tap here shows them, and it goes last: an arm with a card clears NOT NOW by itself, and an arm of none while dark
 * changes nothing but lets go of the card NOT NOW would come back to, which may be one only practised with. A card
 * the venue closed meanwhile (not in `cards`) is not asked for.
 */
export function restoreTaps(was, me, cards) {
  if (!was || !me) return [];
  const dark = !!me.invisible;
  const now = me.armed ?? null;
  if (was.invisible) return dark ? [] : [['arm', null], ['invisible', true]];
  const card = was.armed && (!Array.isArray(cards) || cards.includes(was.armed)) ? was.armed : null;
  if (card) return dark || now !== card ? [['arm', card]] : [];
  if (dark) return [['arm', null], ['invisible', false]];
  return now !== null ? [['arm', null]] : [];
}

/** One row per sound the band makes, in its own order, with what it means. */
export const GUIDE_SOUNDS = Object.keys(SOUNDS).map((sound) => ({ sound, says: GUIDE.sounds[sound] }));
