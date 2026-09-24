// ON THE BEAT — the phone following the relay.
//
// The relay is the one place a person's state lives; the wrist and the phone
// both change it there. So the phone never asserts a card or NOT NOW it has
// not just been asked for: it draws what it last knew, and each view from the
// relay decides. This is that decision, pure, so every row of it is tested
// (tests/follow.test.js) without React, a socket or a clock.
//
// It never sends anything. What it returns for `said` is only kept, to be
// re-said after a reconnect, and carries the view's own seq, so a re-said fact
// the phone learned from the relay is never news to it (relay rule 3).

import { HUE } from '../copy.js';

/** Arriving on one of these arms its card, as the canvas does. */
export const INTENT_OF = { beacon: 'hi', near: 'hi', pick: 'song', wall: 'song', camera: 'dance', floor: 'dance' };

export const FOLLOW_SAY = {
  armed: (intent) => 'Armed from your wristband: ' + HUE[intent].label,
  off: 'Your wristband turned your card off',
  visible: 'Visible again, from your wristband',
  backOn: (intent) => 'Back on, from your wristband: ' + HUE[intent].label,
  away: 'You were away a while, so your card went off.',
  lost: 'That didn’t go through — tap again',
  changed: 'Something changed — check and tap again.',
};

/**
 * @param {object} phone  what this phone holds: { armed, invisible, seq, asked, refused, screen }
 *                        seq: the last seq it sent or followed; asked: the seq of its own last tap;
 *                        refused: the seq of its last showing tap the relay refused as `changed`
 * @param {object} view   the relay's view
 * @returns {null | { armed, invisible, seq, said, screen, clearStack, toast, events }}
 *          null when the view is older than what this phone last said (rule 4) and is not followed
 */
export function follow(phone, view) {
  const me = view?.me;
  if (!me || !Number.isFinite(me.seq) || me.seq < phone.seq) return null;
  const armed = me.armed ?? null;
  const invisible = !!me.invisible;
  const out = {
    armed,
    invisible,
    seq: me.seq,
    said: { arm: { t: 'arm', intent: armed, seq: me.seq }, invisible: { t: 'invisible', on: invisible, seq: me.seq } },
    screen: phone.screen,
    clearStack: false,
    toast: null,
    events: [],
  };
  const cardMoved = armed !== (phone.armed ?? null);
  const quietMoved = invisible !== !!phone.invisible;
  if (!cardMoved && !quietMoved) return out;

  out.clearStack = true;
  if (armed === 'hi' && cardMoved) out.events.push('hi');
  if (invisible) out.screen = 'quiet';
  else if (phone.screen === 'quiet' || (INTENT_OF[phone.screen] && INTENT_OF[phone.screen] !== armed)) out.screen = 'home';

  const toast = (text, unpair = false) => { out.toast = { text, unpair }; };
  if (me.fresh && phone.armed && !armed) {
    toast(FOLLOW_SAY.away);
  } else if (me.by === 'band') {
    // Going dark from the wrist says itself: the quiet screen, as before.
    if (!invisible && quietMoved) toast(armed ? FOLLOW_SAY.backOn(armed) : FOLLOW_SAY.visible, true);
    else if (!invisible) toast(armed ? FOLLOW_SAY.armed(armed) : FOLLOW_SAY.off, true);
  } else if (phone.asked === phone.seq) {
    // This phone's own tap was the last thing it said, and the relay shows otherwise.
    toast(phone.refused === phone.seq ? FOLLOW_SAY.changed : FOLLOW_SAY.lost);
  }
  return out;
}

/** A tap's seq: above the last one this phone sent or followed, and at least the clock (rule 4). */
export const nextSeq = (last, now) => Math.max(last + 1, now);

/**
 * What a tap on this phone sends. A change that shows the person names the
 * rev of the view it was chosen from (rule 5); a change that hides never does,
 * and is always taken.
 */
export function tapMessage(t, value, seq, rev) {
  if (t === 'arm') return value ? { t, intent: value, seq, basis: rev } : { t, intent: null, seq };
  return value ? { t, on: true, seq } : { t, on: false, seq, basis: rev };
}
