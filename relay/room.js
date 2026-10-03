// ON THE BEAT — one venue, one night, and what each person in it may see.
//
// This file is the product's promises, as code. Everything a phone is shown
// comes out of viewFor(), and viewFor() is where the four promises are kept:
//
//   1. Nobody sees where you are. A person carries a BAND — `in this room`,
//      `near the bar`, `by the stage`, `somewhere out the back` — and nothing
//      finer, ever. There is no position here to leak. Only a marker the
//      venue put up, heard clearly by the person's own wristband, names a
//      band other than `in this room`. What wristbands hear of each other only
//      takes people off SAY HI's list, and what they heard never leaves the room.
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
//     that is still only a band, and on their wristband as a short call and a
//     count of who waits. That is what makes waving back possible.
//   - A like (FIRST SONG?) is never shown. It was for an answer, not a face.
//   - A dance back (LET'S DANCE!) is a clip sent straight to one person, so
//     they see it — five seconds of someone dancing, with no name on it.
//
// None of them is ever reported as declined. A yes that is not returned just
// never becomes a match.
//
// A report goes to the venue's own team and to nobody in the room. staffReports() is all the team is shown: the
// person reported only as a tag the relay makes, their band then and now, and the reporter's own words — never
// a name, a contact, a handle, or who reported.
//
// It holds nothing past the night: a room is a Map in memory. dump() is how
// the relay writes it to its night file so a restart carries the night on, and
// that file never outlives the night either
// (docs/superpowers/specs/2026-09-29-restart-persistence-design.md). Pure and
// synchronous — no sockets, no clock of its own — so the promises can be
// tested without a network.

import { createHash, randomBytes, randomInt } from 'node:crypto';

export const INTENTS = ['hi', 'song', 'dance'];
export const BANDS = ['in this room', 'near the bar', 'by the stage', 'somewhere out the back'];
export const SPOTS = ["by the merch stand — it's the quietest corner", 'at the end of the bar, by the water', 'by the cloakroom'];

const NAME_MAX = 24;
const CONTACT_MAX = 60;
const TRACK_MAX = 60;
const REPORTS_MAX = 1000;      // the newest kept a venue, handled ones dropped first, for its staff page (relay/server.js reportsTo())
const WHY_MAX = 200;           // a reporter's few words for the venue team
export const NOTICE_MAX = 140; // a notice from the venue's staff to every phone there

// The show's times, in the night's order, as a shows file writes them.
export const TIME_KEYS = ['doors', 'support', 'break', 'headline', 'end'];

// Near (docs/superpowers/specs/2026-09-26-wrist-near-design.md §2).
export const HEARD_MS = 30_000;   // what a band heard, and that it listened at all, counts this long
export const NEAR_FIVE = 5;       // of the people wearing a band, the most a list shows
export const NEAR_KEEP = 10;      // one of the five stays while still among this many heard most strongly

// Markers (docs/superpowers/specs/2026-09-27-wrist-markers-design.md §3): the band each area names.
export const MARKS = { bar: 'near the bar', stage: 'by the stage', back: 'somewhere out the back' };
export const MARK_FLOOR = -56;    // dBm: the loudest marker names a person's band if heard this loud or louder
export const MARK_HOLD = 4;       // dB: a band holds this far under the floor, and until another is this much louder

/** The middle of some readings, or null for none. */
const median = (list) => {
  const s = list.map((x) => x.rssi).sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};

/** A pair's key, the same whichever way round it is asked. */
const pairKey = (a, b) => (a < b ? a + '|' + b : b + '|' + a);
const clip = (s, n) => String(s ?? '').trim().slice(0, n);

/** A clock time as the night reads it, in minutes: before 06:00 is after midnight. Null for anything but HH:MM. */
const nightMinsOf = (hhmm) => {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm);
  if (!m) return null;
  const t = Number(m[1]) * 60 + Number(m[2]);
  return t < 360 ? t + 1440 : t;
};

/** The five times, each HH:MM and none before the one ahead of it in the night, or null. */
export function timesOf(t) {
  if (!t || typeof t !== 'object') return null;
  const out = {};
  let last = -1;
  for (const k of TIME_KEYS) {
    const n = typeof t[k] === 'string' ? nightMinsOf(t[k]) : null;
    if (n === null || n < last) return null;
    last = n;
    out[k] = t[k];
  }
  return out;
}

/**
 * How many handles (a viewer's name for one other person) a relay's rooms may hold between them. A room works each one out
 * once and keeps it, which is cheaper than hashing every pair every push, but the pairs are the square of the room: measured
 * 1 Oct 2026 at about 62 bytes each, so 500 people hold 15 MB, 1000 hold 58 MB and 1500 hold 151 MB, where the Fly machine
 * gives its process 207 MB and nothing stops a venue reaching those sizes. The ledger is the one number every room of a relay
 * spends from; a pair past it is worked out each time it is asked for, as it was before any were held, and shows the same
 * handle. 400,000 pairs is about 25 MB: a room of 630 people, or more rooms of fewer.
 */
export const HANDLES_MAX = 400_000;
export const handleLedger = (max = HANDLES_MAX) => ({ held: 0, max });

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
  // A room's dump() from before a restart: the room comes back as it was
  // (docs/superpowers/specs/2026-09-29-restart-persistence-design.md §1).
  restore = null,
  // The budget of held handles this room spends from (handleLedger): a relay gives all its rooms the one, and a room made
  // alone gets its own.
  ledger = handleLedger(),
} = {}) {
  // Handles come from the salt, so a room carried across a restart keeps the one it had.
  if (restore) salt = restore.salt;
  const people = new Map();   // id -> person
  const blocks = new Map();   // id -> Set of ids they blocked; outlives leave()
  // 'a>b' -> its number: a waved at b (SAY HI). The number is the time it was made, and at least one past
  // the last wave b was sent, so a wristband that kept the number it last called for is called by the next.
  const waves = new Map();
  const latest = new Map();   // id -> the number of the last wave they were sent; outlives leave()
  const likes = new Set();    // 'a>b': a liked b's pick (FIRST SONG?)
  const dances = new Map();   // 'a>b' -> clip ref: a danced back to b (LET'S DANCE!)
  const matches = new Map();  // pairKey -> match
  // id -> what the room keeps of someone who left tonight: their last rev, so a
  // person made again never reuses one, and whether they were NOT NOW, so they
  // come back as they left. Outlives leave(), as blocks do.
  const tombs = new Map();
  const reports = [];         // oldest first: { id, at, from, about, aboutBand, fromBand, why, handledAt }
  // FIRST SONG?'s answer, as the venue's staff named it: { track, at }, or null until they do. Everyone sees it.
  let opener = null;
  // A notice the venue's staff sent every phone here: { text, at }, or null. Only the latest stands.
  let notice = null;
  // The show's times as the venue's staff moved them: the five, and when, or null while they stand as listed.
  let times = null;
  let nextReport = 1;
  let nextMatch = 1;
  // Near: what each person's wristband heard, never shown to anyone. 'a>b' -> [{ at, rssi }], a's band
  // hearing b's — each person's own band only, so a band that lies moves no list but its own person's;
  // id -> { at, ch }, when their band last reported and on which Wi-Fi
  // channel; id -> the five nearTick() last worked out for them; id -> area -> [{ at, rssi }], the
  // markers their band heard.
  const samples = new Map();
  const listening = new Map();
  const fives = new Map();
  const marked = new Map();

  if (restore) {
    if (!Number.isInteger(restore.nextReport) || !Number.isInteger(restore.nextMatch)) throw new TypeError('not a room dump');
    for (const p of restore.people) people.set(p.id, { ...p, clip: null });
    for (const [id, ids] of restore.blocks) blocks.set(id, new Set(ids));
    for (const [k, n] of restore.waves) waves.set(k, n);
    for (const [id, n] of restore.latest) latest.set(id, n);
    for (const k of restore.likes) likes.add(k);
    // A dance back comes back as the yes it was; its clip does not.
    for (const k of restore.dances) dances.set(k, null);
    for (const m of restore.matches) matches.set(pairKey(m.a, m.b), m);
    for (const [id, tomb] of restore.tombs) tombs.set(id, tomb);
    reports.push(...restore.reports);
    nextReport = restore.nextReport;
    nextMatch = restore.nextMatch;
    // A file from before there was an opener has none.
    const o = restore.opener;
    if (o && typeof o.track === 'string' && o.track && Number.isFinite(o.at)) opener = { track: clip(o.track, TRACK_MAX), at: o.at };
    // Nor, from before there were these, a notice or moved times.
    const n = restore.notice;
    if (n && typeof n.text === 'string' && n.text && Number.isFinite(n.at)) notice = { text: clip(n.text, NOTICE_MAX), at: n.at };
    const t = timesOf(restore.times);
    if (t && Number.isFinite(restore.times.at)) times = { ...t, at: restore.times.at };
  }

  // A handle is a function of the salt and the two ids alone, and a push asks for P*P of them (every person's view of
  // everyone), so each pair is worked out once and held: hashing them again every push was a third of what a full room cost
  // (docs/show-night.md). leave() lets go of a person's pairs, so what is held never outgrows who is here, and dump() never
  // writes any of it down: a room carried across a restart works its handles out again, the same ones. What is held is
  // counted against the ledger, and a pair that finds it spent is worked out and not kept: the handle is the same either way.
  const handles = new Map();   // viewer -> Map(target -> handle)
  const handle = (viewer, target) => {
    let row = handles.get(viewer);
    const kept = row?.get(target);
    if (kept !== undefined) return kept;
    const h = createHash('sha256').update(salt + '|' + viewer + '|' + target).digest('hex').slice(0, 10);
    if (ledger.held < ledger.max) {
      if (!row) handles.set(viewer, (row = new Map()));
      row.set(target, h);
      ledger.held += 1;
    }
    return h;
  };

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

  /**
   * In the room. A person made here starts invisible if they left invisible
   * tonight, or if their phone joined holding NOT NOW (`quiet`); for someone
   * already here, `quiet` is ignored, so an old NOT NOW cannot undo a newer
   * change from the wrist.
   */
  function join(id, { quiet = false } = {}) {
    if (!people.has(id)) {
      // In this room until a marker says otherwise (nearTick()).
      people.set(id, {
        id, name: '', contact: '', band: BANDS[0],
        armed: null, invisible: !!quiet || !!tombs.get(id)?.invisible, pick: null, clip: null, joinedAt: now(),
        rev: tombs.has(id) ? tombs.get(id).rev + 1 : firstRev(), seq: 0, by: 'relay',
      });
    }
    return people.get(id);
  }

  /** Leaving the room ends broadcasting. Matches, yeses, blocks and NOT NOW stay for the night. */
  function leave(id) {
    const p = people.get(id);
    if (p) tombs.set(id, { rev: p.rev, invisible: p.invisible });
    people.delete(id);
    // Their handles go with them: the ones they were shown, and everyone else's of them.
    ledger.held -= handles.get(id)?.size ?? 0;
    handles.delete(id);
    for (const row of handles.values()) if (row.delete(id)) ledger.held -= 1;
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

  /**
   * An arm or an invisible from a phone. Its seq is noted whether or not it is
   * applied (rule 4). A copy said `again` after a reconnect is applied only if
   * the relay never saw it and it hides the person (rule 3). A change that
   * shows the person and names the rev it was chosen from is refused if that
   * rev has moved (rule 5). Returns 'changed' for that refusal, else null.
   */
  function fromPhone(id, m) {
    const p = people.get(id);
    if (!p) return null;
    const seq = Number.isFinite(m.seq) ? m.seq : 0;
    const news = seq > p.seq;
    p.seq = Math.max(p.seq, seq);
    const hides = m.t === 'invisible' ? !!m.on : !INTENTS.includes(m.intent);
    if (m.again) {
      if (!news || !hides) return null;
    } else if (!hides && Number.isInteger(m.basis) && m.basis !== p.rev) {
      return 'changed';
    }
    if (m.t === 'invisible') setInvisible(id, m.on, 'phone');
    else arm(id, m.intent, 'phone');
    return null;
  }

  /** The venue's staff name the opener, or take it back with an empty one. True when that changed it. */
  function setOpener(track) {
    const t = clip(track, TRACK_MAX);
    if ((opener?.track || '') === t) return false;
    opener = t ? { track: t, at: now() } : null;
    return true;
  }

  /** The venue's staff send every phone here a notice, or take it down with an empty one. True when that changed it. */
  function setNotice(text) {
    const t = clip(String(text ?? '').replace(/\s+/g, ' '), NOTICE_MAX);
    if ((notice?.text || '') === t) return false;
    notice = t ? { text: t, at: now() } : null;
    return true;
  }

  /**
   * The venue's staff move the show's times, or put them back as listed with null. Five times in the night's order, or
   * nothing changes. True when that changed them.
   */
  function setTimes(next) {
    if (next === null) {
      if (!times) return false;
      times = null;
      return true;
    }
    const t = timesOf(next);
    if (!t || (times && TIME_KEYS.every((k) => times[k] === t[k]))) return false;
    times = { ...t, at: now() };
    return true;
  }

  /** The night ends: what staff said for it (the opener, a notice, moved times) goes if `isOld(when it was said)`. */
  function letGo(isOld) {
    let gone = false;
    if (opener && isOld(opener.at)) { opener = null; gone = true; }
    if (notice && isOld(notice.at)) { notice = null; gone = true; }
    if (times && isOld(times.at)) { times = null; gone = true; }
    return gone;
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
      found: { [a]: 0, [b]: 0 },   // when each said they found the other; 0 not yet
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
    const k = viewer + '>' + t;
    // A second wave keeps the first one's number: it is not newer.
    if (!waves.has(k)) {
      const n = Math.max(now(), (latest.get(t) ?? 0) + 1);
      latest.set(t, n);
      waves.set(k, n);
    }
    return matchIfMutual((x) => waves.has(x), viewer, t, 'hi');
  }

  /** Has the person behind this handle waved at the viewer? */
  function wavedAtYou(viewer, h) {
    const t = resolve(viewer, h);
    return !!t && waves.has(t + '>' + viewer);
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

  /**
   * To the venue team: about someone, or about something. It keeps when, each side's band then, and the
   * reporter's own words — a string, or none.
   */
  function report(viewer, h, why = '') {
    if (!people.has(viewer)) return false;
    const t = h ? (resolve(viewer, h) ?? matchOther(viewer, h)) : null;
    if (h && !t) return false;
    reports.push({
      id: 'r' + nextReport++, at: now(), from: viewer, about: t,
      aboutBand: t ? (people.get(t)?.band ?? null) : null, fromBand: people.get(viewer).band,
      why: typeof why === 'string' ? clip(why, WHY_MAX) : '', handledAt: 0,
    });
    // Full: a report the team has handled goes first, the oldest of those, and only then the oldest of the rest.
    while (reports.length > REPORTS_MAX) {
      const handled = reports.findIndex((x) => x.handledAt);
      reports.splice(handled === -1 ? 0 : handled, 1);
    }
    return true;
  }

  /**
   * What the venue's staff may see, newest first: when; the person as `tagOf(id)`, with how many reports
   * tonight are about them and from how many people; their band then and now, or `left`; the reporter's band
   * then; the words; and when it was handled, or 0. Nothing names who reported.
   */
  function staffReports(tagOf) {
    const about = new Map();   // id -> { times, from: Set of reporters }
    for (const r of reports) {
      if (!r.about) continue;
      if (!about.has(r.about)) about.set(r.about, { times: 0, from: new Set() });
      about.get(r.about).times += 1;
      about.get(r.about).from.add(r.from);
    }
    return reports.map((r) => ({
      id: r.id, at: r.at, about: r.about ? tagOf(r.about) : null,
      times: r.about ? about.get(r.about).times : 0,
      people: r.about ? about.get(r.about).from.size : 0,
      bandNow: r.about ? (people.get(r.about)?.band ?? 'left') : null,
      bandThen: r.aboutBand, fromThen: r.fromBand, why: r.why, handledAt: r.handledAt,
    })).reverse();
  }

  /** Staff mark a report handled, or open it again. Marking it twice keeps the first time. False if it is not here. */
  function markHandled(reportId, on) {
    const r = reports.find((x) => x.id === reportId);
    if (!r) return false;
    r.handledAt = on ? (r.handledAt || now()) : 0;
    return true;
  }

  /** At 06:00: the reports `old(at)` says are a night that is over. Kept in order, so the oldest go until one is not. */
  function forgetReports(old) {
    let n = 0;
    while (n < reports.length && old(reports[n].at)) n += 1;
    reports.splice(0, n);
    return n > 0;
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

  /**
   * We found each other: like keeping, it counts only once both say so, and
   * one side's is never shown to the other. The first time each said it is
   * kept. False for a match that is not theirs, or is gone.
   */
  function found(viewer, matchId) {
    for (const m of matches.values()) {
      if (m.id !== matchId || (m.a !== viewer && m.b !== viewer)) continue;
      if (!m.found[viewer]) m.found[viewer] = now();
      return true;
    }
    return false;
  }

  /** Everyone a person may see right now: nobody while they are NOT NOW. */
  const seen = (id) => (people.get(id)?.invisible ? [] : [...people.values()].filter((p) => shows(id, p.id)));
  /**
   * SAY HI's list: who is showing blue to this person, less anyone near hides
   * (below). The phone's list and wavesAt() both come from here.
   */
  const blueOf = (id, others) => others.filter((p) => p.armed === 'hi' && !hidden(id, p.id));
  const blue = (id) => blueOf(id, seen(id));

  // ---------- near ----------

  /** Has this person's band reported in the last HEARD_MS? */
  const listens = (id) => listening.has(id) && now() - listening.get(id).at <= HEARD_MS;
  /** Listed whatever the bands say: a wave either way, or a match tonight. */
  const bound = (a, b) => waves.has(a + '>' + b) || waves.has(b + '>' + a) || matches.has(pairKey(a, b));

  /**
   * Hidden from a viewer only on evidence: both bands listening, on one
   * channel, the viewer's five worked out, and the other not in it nor bound
   * to them. A band just on, gone quiet or on another channel hides nobody.
   */
  function hidden(viewer, t) {
    if (!fives.has(viewer) || !listens(viewer) || !listens(t) || bound(viewer, t)) return false;
    return listening.get(viewer).ch === listening.get(t).ch && !fives.get(viewer).has(t);
  }

  /**
   * What one person's band heard: `near` is [{ id, rssi }] of other people in
   * the room, `marks` [{ area, rssi }] of the markers, each area a key of MARKS.
   */
  function heard(id, { ch, near = [], marks = [] } = {}) {
    if (!people.has(id)) return;
    const at = now();
    listening.set(id, { at, ch });
    for (const { id: other, rssi } of near) {
      if (other === id || !people.has(other)) continue;
      const k = id + '>' + other;
      if (!samples.has(k)) samples.set(k, []);
      samples.get(k).push({ at, rssi });
    }
    for (const { area, rssi } of marks) {
      if (!Object.hasOwn(MARKS, area)) continue;
      if (!marked.has(id)) marked.set(id, new Map());
      const m = marked.get(id);
      if (!m.has(area)) m.set(area, []);
      m.get(area).push({ at, rssi });
    }
  }

  /** How near b is to a: the median of what a's own band heard of b's, or null. nearTick() drops the old first. */
  const score = (a, b) => median(samples.get(a + '>' + b) ?? []);

  /**
   * A person's band, from the markers their band heard in HEARD_MS: the one
   * they are in while it is MARK_FLOOR - MARK_HOLD or louder and no other is
   * MARK_HOLD louder; else the loudest, if MARK_FLOOR or louder; else in this room.
   */
  function areaOf(p) {
    // Its readings go with its last report: a band gone quiet HEARD_MS has none.
    const loud = [...(marked.get(p.id) ?? [])]
      .map(([area, list]) => ({ band: MARKS[area], s: median(list) }))
      .sort((x, y) => y.s - x.s);
    const here = loud.find((x) => x.band === p.band);
    if (here && here.s >= MARK_FLOOR - MARK_HOLD && loud[0].s < here.s + MARK_HOLD) return p.band;
    return loud.length && loud[0].s >= MARK_FLOOR ? loud[0].band : BANDS[0];
  }

  /**
   * Works out each listening person's five: of the people on SAY HI whose
   * bands have a score with theirs, last time's five stay while among the
   * NEAR_KEEP strongest, and the free places go to the strongest others.
   * People bound to them take no place. Then each person's band, from the
   * markers (areaOf()). True if anyone's five or band changed.
   */
  function nearTick() {
    const fresh = (list) => list.filter((x) => now() - x.at <= HEARD_MS);
    for (const [k, list] of samples) {
      const kept = fresh(list);
      if (kept.length) samples.set(k, kept);
      else samples.delete(k);
    }
    for (const [id, m] of marked) {
      for (const [area, list] of m) {
        const kept = fresh(list);
        if (kept.length) m.set(area, kept);
        else m.delete(area);
      }
      if (!m.size) marked.delete(id);
    }
    for (const id of [...listening.keys()]) if (!people.has(id) || !listens(id)) listening.delete(id);
    let changed = false;
    for (const id of [...fives.keys()]) {
      if (!listening.has(id)) {
        fives.delete(id);
        changed = true;
      }
    }
    for (const id of listening.keys()) {
      const ranked = seen(id)
        .filter((p) => p.armed === 'hi' && listening.has(p.id) && !bound(id, p.id))
        .map((p) => ({ id: p.id, s: score(id, p.id) }))
        .filter((x) => x.s !== null)
        .sort((x, y) => y.s - x.s);
      const strongest = new Set(ranked.slice(0, NEAR_KEEP).map((x) => x.id));
      const last = fives.get(id) ?? new Set();
      const five = [...last].filter((x) => strongest.has(x));
      for (const x of ranked) if (five.length < NEAR_FIVE && !five.includes(x.id)) five.push(x.id);
      if (!fives.has(id) || five.length !== last.size || five.some((x) => !last.has(x))) changed = true;
      fives.set(id, new Set(five));
    }
    for (const p of people.values()) {
      const band = areaOf(p);
      if (band !== p.band) {
        p.band = band;
        changed = true;
      }
    }
    return changed;
  }

  /**
   * The waves a person's phone lists as waved at them and not yet waved back,
   * newest first, each with its number: what their wristband is told.
   */
  function wavesAt(id) {
    return blue(id)
      .filter((p) => waves.has(p.id + '>' + id) && !waves.has(id + '>' + p.id))
      .map((p) => ({ handle: handle(id, p.id), n: waves.get(p.id + '>' + id) }))
      .sort((a, b) => b.n - a.n);
  }

  /** Everything one phone may know, and nothing else. */
  function viewFor(id) {
    const me = people.get(id);
    if (!me) return null;
    const others = seen(id);
    const row = (p) => ({ handle: handle(id, p.id), band: p.band });
    return {
      me: {
        armed: me.armed, invisible: me.invisible, pick: me.pick, band: me.band, name: me.name, clip: me.clip?.ref ?? null,
        rev: me.rev, seq: me.seq, by: me.by, fresh: me.by === 'relay',
      },
      // SAY HI: who is showing blue, as a band and at most a pick — and whether they waved at you.
      near: blueOf(id, others).map((p) => ({
        ...row(p), pick: p.pick, waved: waves.has(id + '>' + p.id), wavedAtYou: waves.has(p.id + '>' + id),
      })),
      // FIRST SONG?: everyone's answer, liked as an answer, never as a face.
      wall: others.filter((p) => p.pick).map((p) => ({
        ...row(p), pick: p.pick, liked: likes.has(id + '>' + p.id),
      })),
      // And, once the venue's staff name it, the answer: the same for everyone.
      opener: opener ? { ...opener } : null,
      // What the venue's staff told everyone here, and the show's times if they moved them: the same for everyone.
      notice: notice ? { ...notice } : null,
      times: times ? { ...times } : null,
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
          // Your own found; the time only once both said it, the later of the two.
          found: !!m.found[id],
          foundAt: m.found[m.a] && m.found[m.b] ? Math.max(m.found[m.a], m.found[m.b]) : null,
        };
      }),
    };
  }

  /**
   * What a restart must carry (docs/superpowers/specs/2026-09-29-restart-persistence-design.md §1), as plain data:
   * no clip ref, and nothing a band heard.
   */
  function dump() {
    return {
      salt,
      people: [...people.values()].map((p) => ({ ...p, clip: null })),
      blocks: [...blocks].map(([id, ids]) => [id, [...ids]]),
      waves: [...waves],
      latest: [...latest],
      likes: [...likes],
      dances: [...dances.keys()],
      matches: [...matches.values()],
      tombs: [...tombs],
      reports: reports.slice(),
      nextReport,
      nextMatch,
      opener,
      notice,
      times,
    };
  }

  return {
    join, leave, setProfile, arm, setInvisible, fromPhone, pick, postClip, setOpener, setNotice, setTimes, letGo,
    /** The opener as staff named it ({ track, at }), or null. */
    opener: () => (opener ? { ...opener } : null),
    /** The notice standing ({ text, at }), or null. */
    notice: () => (notice ? { ...notice } : null),
    /** The times as staff moved them (the five, and at), or null. */
    times: () => (times ? { ...times } : null),
    wave, wavedAtYou, wavesAt, like, unlike, danceBack, block, report, keep, found, heard, nearTick, viewFor, dump,
    /** How many handles the room holds now (a count for the tests, so the ones of people who left are seen to go). */
    handlesHeld: () => { let n = 0; for (const row of handles.values()) n += row.size; return n; },    /** For the relay: who is here, so it knows whose view to push. */
    ids: () => [...people.keys()],
    has: (id) => people.has(id),
    /** The rev a wristband's `set` must name (rule 1), or null for someone not here. */
    revOf: (id) => people.get(id)?.rev ?? null,
    /** What a wristband's wave back needs its person to show: SAY HI. */
    armedOf: (id) => people.get(id)?.armed ?? null,
    reports: () => reports.slice(),
    staffReports, markHandled, forgetReports,
    /** For the relay: does this venue hold any reports tonight? */
    hasReports: () => reports.length > 0,
    size: () => people.size,
  };
}
