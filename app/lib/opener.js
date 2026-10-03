// ON THE BEAT — FIRST SONG?'s answer, once the venue's staff name the opener.
//
// A pick is typed, so it is matched as a song, not as a string: case, accents, punctuation and spacing do not count.
// Nothing here is about anyone but the phone's own person: the wall says how many called it, never who.

/** A track as the words that make it the song. */
export const trackKey = (t) => String(t ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
  .replace(/['’`]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();   // an apostrophe joins its word: thats = that's

/** Are these the same song? Nothing is the same as nothing. */
export const sameTrack = (a, b) => {
  const k = trackKey(a);
  return k !== '' && k === trackKey(b);
};

/**
 * What the wall says once the opener is named, for this phone: `opener` as the relay sends it ({ track, at } or null),
 * the person's own pick, and the wall's picks. Null until it is named.
 */
export function openerNews(opener, pick, wall = []) {
  if (!opener?.track) return null;
  const called = sameTrack(pick, opener.track);
  const others = wall.filter((w) => sameTrack(w.pick, opener.track)).length;
  const line = called ? 'You called it.' : pick ? 'Not this time.' : '';
  const crowd = called
    ? (others === 0 ? 'nobody else here did.' : others + ' more here did too.')
    : (others === 0 ? 'nobody here called it.' : others + ' here called it.');
  return { track: opener.track, called, line, crowd };
}

/** The line Tonight keeps for it. */
export const openerEvent = (news) => 'the opener was ' + news.track + (news.called ? ' — you called it' : '');

/**
 * What a view means for the phone's record of the night. `state` is the night's state (openerSeen, openerAt,
 * openerPick), `pick` the person's pick now. Null when there is nothing to do; otherwise `patch` for the state, the
 * Tonight line (`event`, null to take it out) and a toast (`say`). The pick is held as it was when the answer first
 * came, so changing it afterwards does not call it; if staff take the answer back, all of it goes.
 */
export function openerArrived(state = {}, view, pick) {
  if (!view?.me) return null;   // not a view from the room yet
  const o = view.opener;
  if (!o?.track) {
    if (state.openerSeen == null) return null;
    return { patch: { openerSeen: null, openerAt: null, openerPick: null }, event: null, say: null };
  }
  if (state.openerSeen === o.track && state.openerAt === o.at) return null;
  // Staff spelled the same song better: Tonight's line follows, and nobody is told again.
  if (state.openerAt === o.at && trackKey(state.openerSeen) === trackKey(o.track)) {
    return { patch: { openerSeen: o.track }, event: openerEvent(openerNews(o, state.openerPick ?? '')), say: null };
  }
  const held = state.openerPick ?? (pick || '');
  const news = openerNews(o, held);
  return {
    patch: { openerSeen: o.track, openerAt: o.at, openerPick: held },
    event: openerEvent(news),
    say: 'The opener was ' + o.track + '.' + (news.called ? ' You called it!' : ''),
  };
}
