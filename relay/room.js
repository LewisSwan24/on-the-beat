// ON THE BEAT — one venue, one night, and what each person in it may see.
//
// This file is the product's promises, as code. Everything a phone is shown
// comes out of viewFor(), and viewFor() is where the four promises are kept:
//
//   1. Nobody sees where you are. A person carries a BAND — `in this room`,
//      `near the bar`, `by the stage`, `somewhere out the back` — and nothing
//      finer, ever. There is no position here to leak.
//   2. No name and no photo until you both say yes. Before a mutual yes a
//      person is a handle, a band and at most the track they picked. Handles
//      are per viewer: the same person has a different handle on every phone,
//      so two phones cannot compare notes about who is who.
//   3. One tap makes you invisible. An invisible person is in nobody's lists,
//      and sees nobody's either, until they turn it back on themselves.
//   4. If someone declines, you never see each other again tonight. The
//      decline here is Block: instant, silent, permanent for the night, and
//      both ways. It outlives leaving the room, so a phone that slept in a
//      pocket for ten minutes does not come back unblocked.
//
// What each kind of yes shows the other side, before it is returned:
//
//   - A wave (SAY HI) is seen by the person waved at, as a blue dot on a row
//     that is still only a band. That is what makes waving back possible.
//   - A like (FIRST SONG?) is never shown. It was for an answer, not a face.
//   - A dance back (LET'S DANCE!) is a clip sent straight to one person, so
//     they see it — five seconds of someone dancing, with no name on it.
//
// None of them is ever reported as declined. A yes that is not returned just
// never becomes a match.
//
// It holds nothing past the night: a room is a Map in memory, and when the
// relay stops it is gone. Pure and synchronous — no sockets, no clock of its
// own — so the promises can be tested without a network.

import { createHash, randomBytes, randomInt } from 'node:crypto';

export const INTENTS = ['hi', 'song', 'dance'];
export const BANDS = ['in this room', 'near the bar', 'by the stage', 'somewhere out the back'];
export const SPOTS = ["by the merch stand — it's the quietest corner", 'at the end of the bar, by the water', 'by the cloakroom'];

const NAME_MAX = 24;
const CONTACT_MAX = 60;
const TRACK_MAX = 60;
const REPORTS_MAX = 1000;      // the newest kept; a real venue forwards these to its own dashboard

/** A pair's key, the same whichever way round it is asked. */
const pairKey = (a, b) => (a < b ? a + '|' + b : b + '|' + a);
const clip = (s, n) => String(s ?? '').trim().slice(0, n);

export function createRoom({
  now = () => Date.now(),
  salt = randomBytes(16).toString('hex'),
  // Quiet corners the venue suggests for a first hello. The first one free
  // goes to each new match, in order.
  spots = SPOTS,
  // Where someone new starts counting their revs: a random point, so two
  // people's revs are all but never equal, and a set chosen while a wristband
  // was someone else's cannot name this person's rev and land on them.
  firstRev = () => randomInt(2 ** 31) + 1,
} = {}) {
  const people = new Map();   // id -> person
  const blocks = new Map();   // id -> Set of ids they blocked; outlives leave()
  const waves = new Set();    // 'a>b': a waved at b (SAY HI)
  const likes = new Set();    // 'a>b': a liked b's pick (FIRST SONG?)
  const dances = new Map();   // 'a>b' -> clip ref: a danced back to b (LET'S DANCE!)
  const matches = new Map();  // pairKey -> match
  // id -> what the room keeps of someone who left tonight: their last rev, so a
  // person made again never reuses one. Outlives leave(), as blocks do.
  const tombs = new Map();
  const reports = [];
  let nextMatch = 1;

  const handle = (viewer, target) =>
    createHash('sha256').update(salt + '|' + viewer + '|' + target).digest('hex').slice(0, 10);

  /** Which person a viewer means by a handle they were shown, or null. */
  function resolve(viewer, h) {
    for (const id of people.keys()) if (id !== viewer && handle(viewer, id) === h) return id;
    return null;
  }

  const blocked = (a, b) => !!(blocks.get(a)?.has(b) || blocks.get(b)?.has(a));
  /** May a see b at all? Present, not the same, and no block either way. */
  const canSee = (a, b) => a !== b && people.has(a) && people.has(b) && !blocked(a, b);
  /** Is b showing anything to a right now? */
  const shows = (a, b) => canSee(a, b) && !people.get(b).invisible;

  function join(id, { band = BANDS[0] } = {}) {
    if (!people.has(id)) {
      people.set(id, {
        id, name: '', contact: '', band: BANDS.includes(band) ? band : BANDS[0],
        armed: null, invisible: false, pick: null, clip: null, joinedAt: now(),
        rev: tombs.has(id) ? tombs.get(id).rev + 1 : firstRev(), seq: 0, by: 'relay',
      });
    }
    return people.get(id);
  }

  /** Leaving the room ends broadcasting. Matches, yeses and blocks stay for the night. */
  function leave(id) {
    const p = people.get(id);
    if (p) tombs.set(id, { rev: p.rev });
    people.delete(id);
  }

  /**
   * Every change to armed or invisible, from anywhere, moves rev; `by` says who.
   * Each person counts only their own changes, so a rev says nothing about
   * anyone else in the room.
   */
  function changed(p, armed, invisible, by) {
    if (armed === p.armed && invisible === p.invisible) return;
    p.armed = armed;
    p.invisible = invisible;
    p.rev += 1;
    p.by = by;
  }

  function setBand(id, band) {
    const p = people.get(id);
    if (p && BANDS.includes(band)) p.band = band;
  }

  function setProfile(id, { name, contact } = {}) {
    const p = people.get(id);
    if (!p) return;
    if (name !== undefined) p.name = clip(name, NAME_MAX);
    if (contact !== undefined) {
      p.contact = clip(contact, CONTACT_MAX);
      for (const m of matches.values()) if (m.keep[id]) m.contacts[id] = p.contact;
    }
  }

  /** Arming one intent disarms the others: a card that arms is a switch, not a checkbox. */
  function arm(id, intent, by = 'phone') {
    const p = people.get(id);
    if (!p) return;
    const armed = INTENTS.includes(intent) ? intent : null;
    changed(p, armed, armed ? false : p.invisible, by);
  }

  /** NOT NOW. Disarms everything and stays off until the person turns it back on. */
  function setInvisible(id, on, by = 'phone') {
    const p = people.get(id);
    if (!p) return;
    changed(p, on ? null : p.armed, !!on, by);
  }

  function pick(id, track) {
    const p = people.get(id);
    if (!p) return;
    const t = clip(track, TRACK_MAX);
    if ((p.pick || '') === t) return;
    p.pick = t || null;
    // A like was for an answer. A changed answer takes its likes with it.
    for (const k of [...likes]) if (k.endsWith('>' + id)) likes.delete(k);
  }

  /** A clip for the floor, seen by everyone in the room. */
  function postClip(id, ref) {
    const p = people.get(id);
    if (!p) return;
    p.clip = ref ? { ref: String(ref), at: now() } : null;
  }

  function matchIfMutual(has, a, b, intent) {
    if (!has(a + '>' + b) || !has(b + '>' + a)) return null;
    const key = pairKey(a, b);
    if (matches.has(key)) return matches.get(key);
    // Two digits, so it reads from across a room on a wristband, and not shared
    // with another match while there is a free one. Past ninety at once, two
    // pairs share a number — they are also in different bands of the room.
    const taken = new Set([...matches.values()].map((m) => m.number));
    const first = 10 + (parseInt(handle(a < b ? a : b, a < b ? b : a).slice(0, 6), 16) % 90);
    let number = first;
    for (let i = 0; i < 90 && taken.has(number); i += 1) number = number === 99 ? 10 : number + 1;
    if (taken.has(number)) number = first;
    const used = new Set([...matches.values()].map((m) => m.spot));
    const spot = spots.find((s) => !used.has(s)) ?? spots[(nextMatch - 1) % spots.length];
    const m = {
      id: 'm' + nextMatch++, a, b, intent, at: now(), spot, number,
      names: { [a]: people.get(a).name, [b]: people.get(b).name },
      bands: { [a]: people.get(a).band, [b]: people.get(b).band },
      picks: { [a]: people.get(a).pick, [b]: people.get(b).pick },
      keep: { [a]: false, [b]: false },
      contacts: { [a]: '', [b]: '' },
    };
    matches.set(key, m);
    return m;
  }

  /** The person a viewer means, if they may act on them right now. */
  function target(viewer, h) {
    const t = resolve(viewer, h);
    if (!t || !shows(viewer, t) || people.get(viewer).invisible) return null;
    return t;
  }

  // Each yes answers false when it was refused, null when it was taken and is
  // not returned yet, and the match when it just made one.

  function wave(viewer, h) {
    const t = target(viewer, h);
    if (!t || people.get(t).armed !== 'hi') return false;
    waves.add(viewer + '>' + t);
    return matchIfMutual((k) => waves.has(k), viewer, t, 'hi');
  }

  function like(viewer, h) {
    const t = target(viewer, h);
    if (!t || !people.get(t).pick) return false;
    likes.add(viewer + '>' + t);
    return matchIfMutual((k) => likes.has(k), viewer, t, 'song');
  }

  function unlike(viewer, h) {
    const t = resolve(viewer, h);
    if (t) likes.delete(viewer + '>' + t);
  }

  /** Dance back: your own five seconds, straight to someone who danced where you could see. */
  function danceBack(viewer, h, ref) {
    const t = target(viewer, h);
    if (!t || !ref || !(people.get(t).clip || dances.has(t + '>' + viewer))) return false;
    dances.set(viewer + '>' + t, String(ref));
    return matchIfMutual((k) => dances.has(k), viewer, t, 'dance');
  }

  /** Instant, silent, and permanent for tonight. Also ends any match between them. */
  function block(viewer, h) {
    const t = resolve(viewer, h) ?? matchOther(viewer, h);
    if (!t) return false;
    if (!blocks.has(viewer)) blocks.set(viewer, new Set());
    blocks.get(viewer).add(t);
    matches.delete(pairKey(viewer, t));
    for (const k of [viewer + '>' + t, t + '>' + viewer]) {
      waves.delete(k);
      likes.delete(k);
      dances.delete(k);
    }
    return true;
  }

  /** To the venue team, with the time and the band. About someone, or about something. */
  function report(viewer, h, why = '') {
    if (!people.has(viewer)) return false;
    const t = h ? (resolve(viewer, h) ?? matchOther(viewer, h)) : null;
    if (h && !t) return false;
    reports.push({
      at: now(), from: viewer, about: t,
      band: t ? (people.get(t)?.band ?? null) : people.get(viewer).band, why: clip(why, 200),
    });
    if (reports.length > REPORTS_MAX) reports.splice(0, reports.length - REPORTS_MAX);
    return true;
  }

  /** A match is addressed by its id once it exists; this finds the other side of one. */
  function matchOther(viewer, id) {
    for (const m of matches.values()) {
      if (m.id === id && (m.a === viewer || m.b === viewer)) return m.a === viewer ? m.b : m.a;
    }
    return null;
  }

  /**
   * Keep anyone? Only if you both do. Nothing is shared otherwise. The contact
   * is taken when you keep, so it still reaches them if your phone has since
   * left the room.
   */
  function keep(viewer, matchId, on) {
    for (const m of matches.values()) {
      if (m.id !== matchId || (m.a !== viewer && m.b !== viewer)) continue;
      m.keep[viewer] = !!on;
      m.contacts[viewer] = on ? (people.get(viewer)?.contact ?? m.contacts[viewer] ?? '') : '';
    }
  }

  /** Everything one phone may know, and nothing else. */
  function viewFor(id) {
    const me = people.get(id);
    if (!me) return null;
    const quiet = me.invisible;
    const others = quiet ? [] : [...people.values()].filter((p) => shows(id, p.id));
    const row = (p) => ({ handle: handle(id, p.id), band: p.band });
    return {
      me: {
        armed: me.armed, invisible: me.invisible, pick: me.pick, band: me.band, name: me.name, clip: me.clip?.ref ?? null,
        rev: me.rev, seq: me.seq, by: me.by, fresh: me.by === 'relay',
      },
      // SAY HI: who is showing blue, as a band and at most a pick — and whether they waved at you.
      near: others.filter((p) => p.armed === 'hi').map((p) => ({
        ...row(p), pick: p.pick, waved: waves.has(id + '>' + p.id), wavedAtYou: waves.has(p.id + '>' + id),
      })),
      // FIRST SONG?: everyone's answer, liked as an answer, never as a face.
      wall: others.filter((p) => p.pick).map((p) => ({
        ...row(p), pick: p.pick, liked: likes.has(id + '>' + p.id),
      })),
      // LET'S DANCE!: five seconds each. One sent straight to you comes first, and says so.
      floor: others.flatMap((p) => {
        const toYou = dances.get(p.id + '>' + id);
        if (!toYou && !p.clip) return [];
        return [{ ...row(p), ref: toYou ?? p.clip.ref, toYou: !!toYou, dancedBack: dances.has(id + '>' + p.id) }];
      }).sort((a, b) => b.toYou - a.toYou),
      matches: [...matches.values()].filter((m) => m.a === id || m.b === id).map((m) => {
        const other = m.a === id ? m.b : m.a;
        const both = m.keep[m.a] && m.keep[m.b];
        return {
          id: m.id, intent: m.intent, at: m.at, spot: m.spot, number: m.number,
          name: people.get(other)?.name || m.names[other] || '', band: m.bands[other],
          pick: m.picks[other], yourPick: m.picks[id],
          kept: m.keep[id], keptByBoth: both,
          contact: both ? m.contacts[other] : '',
        };
      }),
    };
  }

  return {
    join, leave, setBand, setProfile, arm, setInvisible, pick, postClip,
    wave, like, unlike, danceBack, block, report, keep, viewFor,
    /** For the relay: who is here, so it knows whose view to push. */
    ids: () => [...people.keys()],
    has: (id) => people.has(id),
    /** The rev a wristband's `set` must name (rule 1), or null for someone not here. */
    revOf: (id) => people.get(id)?.rev ?? null,
    reports: () => reports.slice(),
    size: () => people.size,
  };
}
