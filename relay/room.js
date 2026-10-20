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
import { trackKey } from './band.js';
import { INTENTS } from './cards.js';
import { QUIZ_DEAL, dealOf, quizHash } from './quiz.js';

export { INTENTS };
export const BANDS = ['in this room', 'near the bar', 'by the stage', 'somewhere out the back'];
export const SPOTS = ["by the merch stand — it's the quietest corner", 'at the end of the bar, by the water', 'by the cloakroom'];

const NAME_MAX = 24;
const CONTACT_MAX = 60;
const TRACK_MAX = 60;
const REPORTS_MAX = 1000;      // the newest kept a venue, handled ones dropped first, for its staff page (relay/server.js reportsTo())
const WHY_MAX = 200;           // a reporter's few words for the venue team
export const NOTICE_MAX = 140; // a notice from the venue's staff to every phone there

// A meeting of more than two: a newcomer joins only when everyone in it says yes, and the group holds GROUP_MAX.
export const GROUP_MAX = 4;
export const JOIN_MS = 10 * 60_000;   // an ask to let someone join that nobody answers runs out after this

// The show's times, in the night's order, as a shows file writes them.
export const TIME_KEYS = ['doors', 'support', 'break', 'headline', 'end'];

// A venue card: what the people at an unlisted gig say it is (docs/superpowers/specs/2026-10-13-venue-cards-design.md).
export const CARD_TEXT = { venue: 80, act: 60 };
export const CARD_FIELDS = ['venue', 'act', ...TIME_KEYS];
const WRONG_TO_CLEAR = 2;
const place = (x, lim) => (typeof x === 'number' && Number.isFinite(x) && Math.abs(x) <= lim ? Math.round(x * 1000) / 1000 : null);
const cardText = (v, max) => {
  if (typeof v !== 'string') return null;
  const t = v.replace(/\p{C}/gu, '').trim();
  return t && t.length <= max ? t : null;
};

// Near (docs/superpowers/specs/2026-09-26-wrist-near-design.md §2).
/** How long a practice lasts once it was last said: a phone closed mid-practice does not hide anyone all night. */
export const PRACTICE_MS = 5 * 60_000;
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
/**
 * The cards a venue closed for tonight, as staff sent them: known ids, each once, in the table's order, never every
 * card. [] for none closed; null for anything else, which changes nothing.
 */
export function closedOf(list) {
  if (!Array.isArray(list) || !list.every((id) => INTENTS.includes(id))) return null;
  const ids = INTENTS.filter((id) => list.includes(id));
  return ids.length < INTENTS.length ? ids : null;
}

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

// LET'S FINISH: after a not yet, the one who asked waits this long to ask again, and asks a meeting this often at most.
export const FINISH_AGAIN_MS = 2 * 60_000;
export const FINISH_ASKS = 3;
/** Telling each other where you are, between MEET and FOUND: a few words a note, one every NOTE_GAP_MS, NOTE_EACH a
 * person in a meeting, and the last NOTES_KEPT of them. */
export const NOTE_MAX = 60;
export const NOTE_GAP_MS = 1500;
export const NOTE_EACH = 20;
const NOTES_KEPT = 20;

export function createRoom({
  now = () => Date.now(),
  salt = randomBytes(16).toString('hex'),
  // Quiet corners the venue suggests for a first hello. The first one free
  // goes to each new match, in order.
  spots = SPOTS,
  // Tonight's LET'S GUESS questions, with their answers, as relay/quiz.js keeps them; null for a show with none.
  quiz = null,
  // Where someone new starts counting their revs: a random point, so two
  // people's revs are all but never equal, and a set chosen while a wristband
  // was someone else's cannot name this person's rev and land on them.
  firstRev = () => randomInt(2 ** 31) + 1,
  // A room's dump() from before a restart: the room comes back as it was
  // (docs/superpowers/specs/2026-09-29-restart-persistence-design.md §1).
  restore = null,
  // Which of the restored dump's clip refs came back with their video: the others restore as no clip, as every one did
  // before clips were kept across a restart.
  clipKept = () => false,
  // What a clip ref holds, as the relay kept it: 'photo' for a posed photo, else 'clip' (dance-or-pose spec §2).
  clipKind = () => 'clip',
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
  const likes = new Map();    // 'a>b' -> true: a liked b's pick (FIRST SONG?)
  const dances = new Map();   // 'a>b' -> clip ref: a danced back to b (LET'S DANCE!)
  const answers = new Map();  // id -> [option, ...] in the order of their deal (LET'S GUESS); outlives leave(), as likes do
  const lastAnswer = new Map();  // id -> when they last answered: what their band plays; a restart forgets it, on purpose
  const deals = new Map();    // id -> their deal (relay/quiz.js dealOf), worked out once: it never changes for them
  const dealFor = (id) => {
    let d = deals.get(id);
    if (!d) deals.set(id, (d = dealOf(quiz, id)));
    return d;
  };
  const teams = new Map();    // 'a>b' -> true: a asked b to team up (LET'S GUESS)
  const matches = new Map();  // pairKey -> match
  // Asks to let someone join a meeting: id -> { id, group, who, via, intent, at, yes: [ids], state, doneAt }, state
  // 'open' until everyone in it said yes ('in') or one said no ('no'). Kept once answered, so the same person is
  // never asked about again for that group, and the newcomer is told how it went.
  const joins = new Map();
  // A meeting's notes, by group: [{ by, text, at }]; and each person's ration in it, by group + '>' + id. Kept in
  // memory only, never in the night file, and gone once nobody in the meeting has anything left to find.
  const notes = new Map();
  const noteBy = new Map();
  let nextJoin = 1;
  // id -> what the room keeps of someone who left tonight: their last rev, so a
  // person made again never reuses one, and whether they were NOT NOW, so they
  // come back as they left. Outlives leave(), as blocks do.
  const tombs = new Map();
  // A match a block ended: its id -> the two in it, kept so the one blocked can still report the other (F12).
  const ended = new Map();
  const reports = [];         // oldest first: { id, at, from, about, aboutBand, fromBand, why, handledAt }
  // FIRST SONG?'s answer, as the venue's staff named it: { track, at }, or null until they do. Everyone sees it.
  let opener = null;
  // A notice the venue's staff sent every phone here: { text, at }, or null. Only the latest stands.
  let notice = null;
  // The show's times as the venue's staff moved them: the five, and when, or null while they stand as listed.
  let times = null;
  // The venue card, for a room nobody listed: { fields, lat, lon, at, wrong: { field: [ids] }, hidden }, or null.
  let card = null;
  // The cards the venue's staff closed for tonight, and when: { cards, at }, or null while every card is open.
  let closed = null;
  // LET'S GUESS is closed where the show has no quiz: there is nothing to answer.
  const isClosed = (id) => !!closed?.cards.includes(id) || (id === 'guess' && !quiz);
  // Never every card: a list that, with LET'S GUESS closed for want of a quiz, would leave none open.
  const leavesNone = (ids) => INTENTS.every((c) => ids.includes(c) || (c === 'guess' && !quiz));
  let nextReport = 1;
  let nextMatch = 1;
  // A match's id carries this room's own mark, so it is never another night's: a phone keeps its matches by id, and a
  // relay that lost its night (no NIGHT_FILE, a lost volume) counts from 1 again. A room carried across a restart is the
  // same room, and keeps its mark; a dump from before there was one gets a new mark, and its count goes on.
  let era = randomBytes(4).toString('hex');
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
    const kept = (ref) => (typeof ref === 'string' && clipKept(ref) ? ref : null);
    // A floor clip comes back only if its video did.
    const floorOf = (c) => (c && kept(c.ref) && Number.isFinite(c.at) ? { ref: c.ref, at: c.at } : null);
    for (const p of restore.people) people.set(p.id, { ...p, clip: floorOf(p.clip) });
    for (const [id, ids] of restore.blocks) blocks.set(id, new Set(ids));
    for (const [k, n] of restore.waves) waves.set(k, n);
    for (const [id, n] of restore.latest) latest.set(id, n);
    for (const k of restore.likes) likes.set(k, true);
    // A dance back comes back as the yes it was, and with its clip only if its video did. A file from before clips
    // were kept has no danceClips.
    for (const k of restore.dances) dances.set(k, null);
    for (const [k, ref] of Array.isArray(restore.danceClips) ? restore.danceClips : []) if (dances.has(k)) dances.set(k, kept(ref));
    for (const m of restore.matches) matches.set(pairKey(m.a, m.b), m);
    // A file from before groups has no asks to join.
    for (const j of Array.isArray(restore.joins) ? restore.joins : []) {
      if (j && typeof j.id === 'string' && typeof j.group === 'string' && Array.isArray(j.yes)) joins.set(j.id, { ...j, yes: [...j.yes] });
    }
    if (Number.isInteger(restore.nextJoin)) nextJoin = restore.nextJoin;
    // A file from before F12 has none.
    for (const e of Array.isArray(restore.ended) ? restore.ended : []) if (e && typeof e.id === 'string') ended.set(e.id, { a: e.a, b: e.b });
    for (const [id, tomb] of restore.tombs) tombs.set(id, tomb);
    reports.push(...restore.reports);
    nextReport = restore.nextReport;
    nextMatch = restore.nextMatch;
    if (typeof restore.era === 'string' && /^[0-9a-f]{8}$/.test(restore.era)) era = restore.era;
    // A file from before there was an opener has none.
    const o = restore.opener;
    if (o && typeof o.track === 'string' && o.track && Number.isFinite(o.at)) opener = { track: clip(o.track, TRACK_MAX), at: o.at };
    // Nor, from before there were these, a notice or moved times.
    const n = restore.notice;
    if (n && typeof n.text === 'string' && n.text && Number.isFinite(n.at)) notice = { text: clip(n.text, NOTICE_MAX), at: n.at };
    const t = timesOf(restore.times);
    if (t && Number.isFinite(restore.times.at)) times = { ...t, at: restore.times.at };
    // Nor closed cards. A card the file names that this build does not have is not closed here.
    const c = restore.closed;
    const shut = c && Array.isArray(c.cards) ? closedOf(c.cards.filter((id) => INTENTS.includes(id))) : null;
    if (shut?.length && !leavesNone(shut) && Number.isFinite(c.at)) closed = { cards: shut, at: c.at };
    // Nor, from before venue cards, a card.
    const v = restore.card;
    if (v && typeof v === 'object' && v.fields && typeof v.fields.venue === 'string') {
      card = { fields: { ...v.fields }, lat: v.lat ?? null, lon: v.lon ?? null, at: Number(v.at) || 0, wrong: { ...(v.wrong || {}) }, hidden: !!v.hidden };
    }
    // Answers are for the quiz they were given against: a corrected quiz starts everyone again.
    // And for the deal they were asked in: answers saved before deals, or with another size of deal, are in another order.
    if (quiz && restore.quizHash === quizHash(quiz) && restore.quizDeal === QUIZ_DEAL) {
      for (const [id, list] of Array.isArray(restore.answers) ? restore.answers : []) {
        if (typeof id === 'string' && Array.isArray(list)) answers.set(id, list.filter((c) => Number.isInteger(c) && c >= 0 && c <= 3).slice(0, dealFor(id).length));
      }
      for (const k of Array.isArray(restore.teams) ? restore.teams : []) if (typeof k === 'string') teams.set(k, true);
    }
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
  // Practising (the wristband guide): until when, by person. Never in dump(): a restart ends it, and a phone still on
  // its practice screen says it again when it joins.
  const practising = new Map();
  const practises = (id) => (practising.get(id) ?? 0) > now();
  /** Is b showing anything to a right now? Not while invisible, nor while practising. */
  const shows = (a, b) => canSee(a, b) && !people.get(b).invisible && !practises(b);

  // ---------- LET'S GUESS: answers ----------
  // An answer is kept as the option's place in the quiz, in the order of the person's own deal.
  const doneOf = (id) => !!quiz && (answers.get(id)?.length ?? 0) >= dealFor(id).length;
  const scoreOf = (id) => {
    if (!quiz) return { right: 0, of: 0 };
    const deal = dealFor(id);
    return { right: (answers.get(id) ?? []).filter((c, i) => c === quiz[deal[i].q].answer).length, of: deal.length };
  };

  /** LET'S GUESS: a person's answer to the first question they have not answered, as the place they tapped. Final once given; true when taken. */
  function answer(id, q, choice) {
    if (!quiz || isClosed('guess') || !people.has(id)) return false;
    const list = answers.get(id) ?? [];
    const deal = dealFor(id);
    if (q !== list.length || q >= deal.length || !Number.isInteger(choice) || choice < 0 || choice > 3) return false;
    answers.set(id, [...list, deal[q].order[choice]]);
    lastAnswer.set(id, now());
    return true;
  }

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
      // Back in a meeting someone asked to join while they were out: if all of them already said yes, it is done.
      for (const j of joins.values()) if (joinOpen(j) && inGroup(j.group).has(id)) settle(j);
    }
    return people.get(id);
  }

  /** Leaving the room ends broadcasting. Matches, yeses, blocks and NOT NOW stay for the night. */
  function leave(id) {
    const p = people.get(id);
    if (p) tombs.set(id, { rev: p.rev, invisible: p.invisible, joinedAt: p.joinedAt });
    people.delete(id);
    practising.delete(id);
    // Their handles go with them: the ones they were shown, and everyone else's of them.
    ledger.held -= handles.get(id)?.size ?? 0;
    handles.delete(id);
    for (const row of handles.values()) if (row.delete(id)) ledger.held -= 1;
  }

  /**
   * Their night is over: they leave, and everything the room kept of them goes with it — matches, yeses either way,
   * blocks either way, waves, and how they left. A person forgotten and joined again starts with nothing.
   */
  function forgetPerson(id) {
    leave(id);
    tombs.delete(id);
    latest.delete(id);
    answers.delete(id);
    deals.delete(id);
    lastAnswer.delete(id);
    blocks.delete(id);
    for (const ids of blocks.values()) ids.delete(id);
    const theirs = (k) => k.split('>').includes(id);
    for (const map of [waves, likes, dances, teams]) for (const k of [...map.keys()]) if (theirs(k)) map.delete(k);
    for (const [k, m] of [...matches]) if (m.a === id || m.b === id) matches.delete(k);
    for (const [k, e] of [...ended]) if (e.a === id || e.b === id) ended.delete(k);
    for (const [k, j] of [...joins]) if (j.who === id || j.via === id || j.yes.includes(id)) joins.delete(k);
  }

  /**
   * Everyone who has left and last joined at a time `isOver` says belongs to a night that has ended, forgotten as
   * forgetPerson forgets: their ids. A tomb from before tombs kept the time is kept, as every tomb was.
   */
  function forgetLeft(isOver) {
    const over = [...tombs].filter(([, t]) => Number.isFinite(t.joinedAt) && isOver(t.joinedAt)).map(([id]) => id);
    for (const id of over) forgetPerson(id);
    return over;
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
    // Off the card they asked on, a newcomer is looking no more: their asks on it end.
    endAsks((j) => j.who === p.id && j.intent !== armed);
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
    if (armed && isClosed(armed)) return;   // closed tonight: refused where it came from (fromPhone, the relay's set)
    p.was = null;   // a card chosen, or OFF, is what they come back on now (N3)
    changed(p, armed, armed ? false : p.invisible, by);
  }

  /** Practice on (again, for PRACTICE_MS) or off. Only for someone here. */
  function setPractice(id, on) {
    if (!people.has(id)) return;
    if (on) practising.set(id, now() + PRACTICE_MS);
    else practising.delete(id);
  }

  /** Lets go of practices past their time. True when one ended, so the relay pushes views. */
  function sweepPractice(at = now()) {
    let ended = false;
    for (const [id, until] of practising) if (until <= at || !people.has(id)) { practising.delete(id); ended = true; }
    return ended;
  }

  /**
   * NOT NOW. Disarms everything and stays off until the person turns it back on, which puts back the card they had
   * (N3), unless they chose another meanwhile or the venue closed it.
   */
  function setInvisible(id, on, by = 'phone') {
    const p = people.get(id);
    if (!p) return;
    if (on) {
      if (!p.invisible) p.was = p.armed;
      changed(p, null, true, by);
      // Hidden, they are let into no meeting and let nobody into theirs: their open asks end.
      endAsks((j) => j.who === id || inGroup(j.group).has(id));
      return;
    }
    const back = p.invisible ? comeBackTo(p) : p.armed;
    p.was = null;
    changed(p, back, false, by);
  }

  /** The card NOT NOW will come back to: the one they had, while it is still open tonight; else none. */
  const comeBackTo = (p) => (p.was && !isClosed(p.was) ? p.was : null);

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
    } else if (!hides && (isClosed(m.intent) || (Number.isInteger(m.basis) && m.basis !== p.rev))) {
      return 'changed';   // the rev moved, or the venue closed that card tonight
    }
    if (m.t === 'invisible') setInvisible(id, m.on, 'phone');
    else arm(id, m.intent, 'phone');
    return null;
  }

  /** The venue's staff name the opener, or take it back with an empty one. True when that changed it. */
  function setOpener(track) {
    const t = clip(track, TRACK_MAX);
    if ((opener?.track || '') === t) return false;
    // The same song spelled better keeps its moment, so no phone or band is told it twice.
    const same = opener && t && trackKey(opener.track) === trackKey(t);
    opener = t ? { track: t, at: same ? opener.at : now() } : null;
    return true;
  }

  /** Fill a venue card, first in wins (spec §1). Making one needs `venue`; its place comes only then. */
  function fillCard(viewer, fields) {
    if (!people.has(viewer) || !fields || typeof fields !== 'object') return 'bad';
    const set = {};
    for (const k of CARD_FIELDS) {
      if (!(k in fields)) continue;
      const v = k in CARD_TEXT ? cardText(fields[k], CARD_TEXT[k]) : (typeof fields[k] === 'string' && nightMinsOf(fields[k]) !== null ? fields[k] : null);
      if (v === null) return 'bad';
      set[k] = v;
    }
    const placed = 'lat' in fields || 'lon' in fields;
    if (!card) {
      if (!set.venue) return 'bad';
      const lat = placed ? place(fields.lat, 90) : null;
      const lon = placed ? place(fields.lon, 180) : null;
      if (placed && (lat === null || lon === null)) return 'bad';
      card = { fields: set, lat, lon, at: now(), wrong: {}, hidden: false };
      return 'ok';
    }
    if (placed || !Object.keys(set).length) return 'bad';
    if (Object.keys(set).some((k) => k in card.fields)) return 'taken';
    Object.assign(card.fields, set);
    return 'ok';
  }

  /** "Something's wrong here": two different people on one field clear it; on `venue`, the card leaves every list. */
  function wrongCard(viewer, field) {
    if (!card || !people.has(viewer) || !CARD_FIELDS.includes(field) || !(field in card.fields)) return false;
    const who = card.wrong[field] || (card.wrong[field] = []);
    if (who.includes(viewer)) return false;
    who.push(viewer);
    if (who.length < WRONG_TO_CLEAR) return false;
    delete card.wrong[field];
    if (field === 'venue') card.hidden = true;
    else delete card.fields[field];
    return true;
  }

  const cardOut = () => (card ? { ...card.fields, ...(card.lat !== null ? { lat: card.lat, lon: card.lon } : {}), made: true } : null);

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

  /**
   * The venue's staff close cards for tonight, or open them all again with []. Anyone showing a card that closes goes
   * off, said by staff. False when the list is not one (closedOf) or changes nothing.
   */
  function setClosed(list) {
    const ids = closedOf(list);
    if (ids && leavesNone(ids)) return false;
    if (!ids || ids.join() === (closed?.cards ?? []).join()) return false;
    closed = ids.length ? { cards: ids, at: now() } : null;
    for (const p of people.values()) if (isClosed(p.armed)) changed(p, null, p.invisible, 'staff');
    endAsks((j) => isClosed(j.intent));
    return true;
  }

  /** The night ends: what staff said for it (the opener, a notice, moved times, closed cards) goes if `isOld(when it was said)`. */
  function letGo(isOld) {
    let gone = false;
    if (opener && isOld(opener.at)) { opener = null; gone = true; }
    if (notice && isOld(notice.at)) { notice = null; gone = true; }
    if (times && isOld(times.at)) { times = null; gone = true; }
    if (closed && isOld(closed.at)) { closed = null; gone = true; }
    if (card && isOld(card.at)) { card = null; gone = true; }
    return gone;
  }

  function pick(id, track) {
    const p = people.get(id);
    if (!p) return;
    const t = clip(track, TRACK_MAX);
    if ((p.pick || '') === t) return;
    p.pick = t || null;
    // A match made with no pick takes the first one made after it: PICK ONE on a match asks for exactly that (F1).
    // A match made over a pick keeps the track it was made over.
    for (const m of matches.values()) if ((m.a === id || m.b === id) && !m.picks[id]) m.picks[id] = p.pick;
    // A like was for an answer. A changed answer takes its likes with it.
    for (const k of [...likes.keys()]) if (k.endsWith('>' + id)) likes.delete(k);
  }

  /** A clip for the floor, seen by everyone in the room. */
  function postClip(id, ref) {
    const p = people.get(id);
    if (!p) return false;
    if (ref && isClosed('dance')) return false;   // nobody's floor tonight
    p.clip = ref ? { ref: String(ref), at: now() } : null;
    return true;
  }

  // ---------- meetings, of two and of more ----------
  //
  // A meeting is pairs: a group is the pairs that share its id (a pair's own id, for the first two), one number and
  // one spot. Keeping, found and the wristband stay between two people; a group is who else is there.
  const groupOf = (m) => m.group ?? m.id;
  /**
   * Everyone still in a group: in one of its pairs not finished, in the room right now or not. Someone who stepped
   * out is still in the meeting, and is still asked before anyone joins it.
   */
  const inGroup = (g) => {
    const ids = new Set();
    for (const m of matches.values()) {
      if (groupOf(m) !== g || m.finishedAt) continue;
      ids.add(m.a);
      ids.add(m.b);
    }
    return ids;
  };
  /** The newest group on this card a person is still in, or null. */
  const openGroup = (id, intent) => {
    let best = null;
    for (const m of matches.values()) {
      if (m.finishedAt || m.intent !== intent || (m.a !== id && m.b !== id)) continue;
      if (!best || m.at > best.at) best = m;
    }
    return best ? groupOf(best) : null;
  };
  const joinOpen = (j) => j.state === 'open' && now() - j.at <= JOIN_MS;
  /** How an ask ended, for the newcomer: 'in', 'no' (a no, or nobody answered in time), or 'open'. */
  const joinState = (j) => (j.state === 'open' && !joinOpen(j) ? 'no' : j.state);
  const joinEnd = (j) => j.doneAt ?? j.at + JOIN_MS;
  /** Ends every open ask `test` picks out, as a no. */
  const endAsks = (test) => { for (const j of joins.values()) if (j.state === 'open' && test(j)) { j.state = 'no'; j.doneAt = now(); } };
  /** The name someone met under in meeting `group`, and in no other. */
  const metAs = (id, group) => { for (const m of matches.values()) if (groupOf(m) === group && m.names?.[id]) return m.names[id]; return ''; };
  /** What someone in meeting `group` is called: the name they give now, or, out of the room just now, the one they met under in it. */
  const nameIn = (id, group) => (people.has(id) ? people.get(id).name : metAs(id, group));

  function makePair(a, b, intent, { group = null, number = null, spot = null } = {}) {
    let n = number;
    if (n === null) {
      // Two digits, so it reads from across a room on a wristband, and not shared
      // with another match while there is a free one. Past ninety at once, two
      // pairs share a number — they are also in different bands of the room.
      const taken = new Set([...matches.values()].map((m) => m.number));
      const first = 10 + (parseInt(handle(a < b ? a : b, a < b ? b : a).slice(0, 6), 16) % 90);
      n = first;
      for (let i = 0; i < 90 && taken.has(n); i += 1) n = n === 99 ? 10 : n + 1;
      if (taken.has(n)) n = first;
    }
    let where = spot;
    if (where === null) {
      const used = new Set([...matches.values()].map((m) => m.spot));
      where = spots.find((s) => !used.has(s)) ?? spots[(nextMatch - 1) % spots.length];
    }
    const m = {
      id: 'm' + nextMatch++ + '-' + era, a, b, intent, at: now(), spot: where, number: n,
      ...(group ? { group } : {}),
      // Back in the room, a phone says its name only after it joins: until then, the name met under in this meeting.
      names: { [a]: people.get(a).name || metAs(a, group), [b]: people.get(b).name || metAs(b, group) },
      bands: { [a]: people.get(a).band, [b]: people.get(b).band },
      picks: { [a]: people.get(a).pick, [b]: people.get(b).pick },
      // Only a team-up shows scores: a match over another card never tells either one how the other did.
      scores: intent === 'guess' ? { [a]: scoreOf(a), [b]: scoreOf(b) } : { [a]: null, [b]: null },
      keep: { [a]: false, [b]: false },
      contacts: { [a]: '', [b]: '' },
      found: { [a]: 0, [b]: 0 },   // when each said they found the other; 0 not yet
    };
    matches.set(pairKey(a, b), m);
    return m;
  }

  /**
   * A yes each way. Between two people in no meeting on this card, a pair, as always. When one of them is already in
   * one and the other is in none, the newcomer is asked about to everyone else in it instead, and joins once they all
   * say yes (admit); never twice for the same group, and never past GROUP_MAX. Anything else is a pair of its own.
   */
  function matchIfMutual(has, a, b, intent) {
    if (!has(a + '>' + b) || !has(b + '>' + a)) return null;
    const key = pairKey(a, b);
    if (matches.has(key)) return matches.get(key);
    const ga = openGroup(a, intent);
    const gb = openGroup(b, intent);
    if (!ga !== !gb) {
      const group = ga ?? gb;
      const who = ga ? b : a;
      const via = ga ? a : b;
      const members = inGroup(group);
      const waiting = [...joins.values()].filter((j) => j.group === group && joinOpen(j)).length;
      if (members.size + waiting < GROUP_MAX) {
        if ([...joins.values()].some((j) => j.group === group && j.who === who)) return null;
        if ([...members].some((id) => blocked(id, who))) return null;
        const j = { id: 'j' + nextJoin++ + '-' + era, group, who, via, intent, at: now(), yes: [via], state: 'open', doneAt: null };
        joins.set(j.id, j);
        return null;
      }
    }
    return makePair(a, b, intent);
  }

  /**
   * Someone in a meeting answers an ask to let a newcomer join: 'yes' or 'no'. One no keeps them out; once everyone
   * still in it said yes, the newcomer meets each of them under the group's number, at its spot. False for an ask
   * that is not theirs to answer, already answered, or run out.
   */
  function admit(viewer, joinId, word) {
    const j = joins.get(joinId);
    if (!j || !joinOpen(j) || viewer === j.who || !['yes', 'no'].includes(word)) return false;
    const members = inGroup(j.group);
    if (!members.has(viewer) || j.yes.includes(viewer)) return false;
    if (word === 'no') {
      j.state = 'no';
      j.doneAt = now();
      return true;
    }
    j.yes.push(viewer);
    settle(j);
    return true;
  }

  function settle(j) {
    const members = [...inGroup(j.group)];
    // Everyone said yes; someone out of the room just now is met when they are back (or the ask runs out).
    if (!members.every((id) => j.yes.includes(id)) || !members.every((id) => people.has(id))) return;
    j.doneAt = now();
    // What made the ask fair must still hold now that everyone answered: the newcomer is here and showing, in no
    // meeting on this card already, blocked by nobody in this one, and there is room for them.
    const p = people.get(j.who);
    const fits = members.length > 0 && members.length < GROUP_MAX && p && !p.invisible && !practises(j.who) && p.armed === j.intent
      && !openGroup(j.who, j.intent) && members.every((id) => !blocked(id, j.who))
      && members.includes(j.via) && !isClosed(j.intent)
      && members.every((id) => !people.get(id).invisible && !practises(id));
    if (!fits) { j.state = 'no'; return; }
    j.state = 'in';
    // In one meeting on a card, never two: the newcomer's other asks end.
    for (const o of joins.values()) if (o !== j && o.who === j.who && o.state === 'open') { o.state = 'no'; o.doneAt = now(); }
    const first = [...matches.values()].find((m) => groupOf(m) === j.group);
    for (const id of members) makePair(j.who, id, j.intent, { group: j.group, number: first.number, spot: first.spot });
    // A meeting of more than two finishes one person at a time: an ask from before is gone.
    for (const m of matches.values()) if (groupOf(m) === j.group) { m.finishAsk = null; m.finishNo = null; }
  }

  /** The person a viewer means, if they may act on them right now. */
  function target(viewer, h) {
    const t = resolve(viewer, h);
    // Hidden, by NOT NOW or by practice, a person acts on nobody: a handle kept from before reaches no one.
    if (!t || !shows(viewer, t) || people.get(viewer).invisible || practises(viewer)) return null;
    return t;
  }

  // ---------- each card's yes ----------
  //
  // What someone may send a card's wearer once it is armed: who may be sent one (may), what is kept of it (yeses,
  // 'a>b' -> what it carries, set by take), and the list a phone sees of the people it is for (list, made by rows).
  // A yes each way is a match. Every card in relay/cards.js has its play here; tests/cards.test.js holds the two
  // together, so a card added there without one fails.
  const plays = {
    // SAY HI: a wave, to someone showing blue.
    hi: {
      yeses: waves,
      may: (viewer, t) => people.get(t).armed === 'hi',
      take: (viewer, t) => {
        const k = viewer + '>' + t;
        // A second wave keeps the first one's number: it is not newer.
        if (waves.has(k)) return;
        const n = Math.max(now(), (latest.get(t) ?? 0) + 1);
        latest.set(t, n);
        waves.set(k, n);
      },
      // Who is showing blue, as a band and at most a pick — and whether they waved at you.
      list: 'near',
      rows: (id, others, row) => blueOf(id, others).map((p) => ({
        ...row(p), pick: p.pick, waved: waves.has(id + '>' + p.id), wavedAtYou: waves.has(p.id + '>' + id),
      })),
    },
    // FIRST SONG?: a like, for an answer.
    song: {
      yeses: likes,
      may: (viewer, t) => !!people.get(t).pick,
      take: (viewer, t) => { likes.set(viewer + '>' + t, true); },
      // Everyone's answer, liked as an answer, never as a face.
      list: 'wall',
      rows: (id, others, row) => others.filter((p) => p.pick).map((p) => ({
        ...row(p), pick: p.pick, liked: likes.has(id + '>' + p.id),
      })),
    },
    // LET'S DANCE!: a dance back, your own five seconds or a pose, straight to someone who danced where you could see.
    dance: {
      yeses: dances,
      may: (viewer, t, ref) => !!ref && !!(people.get(t).clip || dances.has(t + '>' + viewer)),
      take: (viewer, t, ref) => { dances.set(viewer + '>' + t, String(ref)); },
      // Five seconds each. One sent straight to you comes first, and says so.
      list: 'floor',
      rows: (id, others, row) => others.flatMap((p) => {
        const toYou = dances.get(p.id + '>' + id);
        if (!toYou && !p.clip) return [];
        const ref = toYou ?? p.clip.ref;
        return [{ ...row(p), ref, kind: clipKind(ref), toYou: !!toYou, dancedBack: dances.has(id + '>' + p.id) }];
      }).sort((a, b) => b.toYou - a.toYou),
    },
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
  };

  // A yes answers false when it was refused, null when it was taken and is not returned yet, and the match when it
  // just made one.
  function yes(card, viewer, h, what) {
    const play = plays[card];
    const t = target(viewer, h);
    if (!t || isClosed(card) || !play.may(viewer, t, what)) return false;
    play.take(viewer, t, what);
    return matchIfMutual((k) => play.yeses.has(k), viewer, t, card);
  }

  const wave = (viewer, h) => yes('hi', viewer, h);

  /** Has the person behind this handle waved at the viewer? */
  function wavedAtYou(viewer, h) {
    const t = resolve(viewer, h);
    return !!t && waves.has(t + '>' + viewer);
  }

  const like = (viewer, h) => yes('song', viewer, h);

  function unlike(viewer, h) {
    const t = resolve(viewer, h);
    if (!t) return;
    likes.delete(viewer + '>' + t);
    // A yes taken back ends an ask it made: nobody is let into a meeting on a yes they no longer give.
    for (const j of joins.values()) {
      if (j.state === 'open' && j.intent === 'song' && [j.who, j.via].includes(viewer) && [j.who, j.via].includes(t)) {
        j.state = 'no';
        j.doneAt = now();
      }
    }
  }

  const danceBack = (viewer, h, ref) => yes('dance', viewer, h, ref);
  const team = (viewer, h) => yes('guess', viewer, h);

  /** Instant, silent, and permanent for tonight. Also ends any match between them. */
  function block(viewer, h) {
    const t = resolve(viewer, h) ?? matchOther(viewer, h);
    if (!t) return false;
    if (!blocks.has(viewer)) blocks.set(viewer, new Set());
    blocks.get(viewer).add(t);
    const m = matches.get(pairKey(viewer, t));
    if (m) ended.set(m.id, { a: m.a, b: m.b });
    matches.delete(pairKey(viewer, t));
    // An ask to let one of them into a meeting the other is in ends.
    for (const j of joins.values()) {
      if (j.state !== 'open') continue;
      if ((j.who === t && inGroup(j.group).has(viewer)) || (j.who === viewer && inGroup(j.group).has(t))) { j.state = 'no'; j.doneAt = now(); }
    }
    // In a meeting of more than two, the one who blocked leaves it: never at one spot, under one number, with them.
    if (m) {
      for (const x of matches.values()) {
        if (groupOf(x) !== groupOf(m) || x.finishedAt || (x.a !== viewer && x.b !== viewer)) continue;
        x.finishedAt = now();
        x.left = viewer;
        x.finishAsk = null;
      }
      endAsks((j) => j.group === groupOf(m) && j.via === viewer);
    }
    for (const k of [viewer + '>' + t, t + '>' + viewer]) for (const play of Object.values(plays)) play.yeses.delete(k);
    return true;
  }

  /**
   * To the venue team: about someone, or about something. It keeps when, each side's band then, and the
   * reporter's own words — a string, or none.
   */
  function report(viewer, h, why = '') {
    if (!people.has(viewer)) return false;
    const t = h ? (resolve(viewer, h) ?? matchOther(viewer, h) ?? endedOther(viewer, h)) : null;
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
  /** The other one in a match a block ended, for the two in it only: what lets the one blocked still report (F12). */
  function endedOther(viewer, id) {
    const e = ended.get(id);
    return e && (e.a === viewer || e.b === viewer) ? (e.a === viewer ? e.b : e.a) : null;
  }

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
  /** Code points a note keeps: printable, and no marks that turn the text around. */
  const plain = (s) => [...String(s ?? '')].filter((c) => {
    const k = c.codePointAt(0);
    return k >= 32 && k !== 127 && !(k >= 0x202a && k <= 0x202e) && !(k >= 0x2066 && k <= 0x2069);
  }).join('').trim();
  /** Is anyone in this meeting still looking for someone: a pair in it not finished and not found by both. */
  const looking = (g) => [...matches.values()].some((x) => groupOf(x) === g && !x.finishedAt && !(x.found[x.a] && x.found[x.b]));
  /** May `id` read and write meeting `g`'s notes: still in it, and someone in it still looking. */
  const talkOpen = (g, id) => looking(g)
    && [...matches.values()].some((x) => groupOf(x) === g && !x.finishedAt && (x.a === id || x.b === id));

  /**
   * After MEET and before everyone said FOUND: a few words to everyone in the meeting about where you are. False for
   * a meeting that is not theirs, closed, an empty note, or one past the ration.
   */
  function note(viewer, matchId, text) {
    const m = [...matches.values()].find((x) => x.id === matchId && (x.a === viewer || x.b === viewer));
    if (!m) return false;
    const group = groupOf(m);
    if (!talkOpen(group, viewer)) return false;
    const said = [...plain(text)].slice(0, NOTE_MAX).join('');
    if (!said) return false;
    const key = group + '>' + viewer;
    const mine = noteBy.get(key) ?? { n: 0, at: -Infinity };
    if (mine.n >= NOTE_EACH || now() - mine.at < NOTE_GAP_MS) return false;
    noteBy.set(key, { n: mine.n + 1, at: now() });
    notes.set(group, [...(notes.get(group) ?? []), { by: viewer, text: said, at: now() }].slice(-NOTES_KEPT));
    sweepNotes();
    return true;
  }

  /** A meeting nobody is looking in any more keeps no notes: found by everyone, or ended. */
  function sweepNotes() {
    for (const g of notes.keys()) {
      if (looking(g)) continue;
      notes.delete(g);
      for (const k of noteBy.keys()) if (k.startsWith(g + '>')) noteBy.delete(k);
    }
  }
  /** When `id` came into meeting `g`: their first pair in it still going. */
  const cameInto = (g, id) => Math.min(...[...matches.values()]
    .filter((x) => groupOf(x) === g && !x.finishedAt && (x.a === id || x.b === id)).map((x) => x.at));

  function found(viewer, matchId) {
    for (const m of matches.values()) {
      if (m.id !== matchId || (m.a !== viewer && m.b !== viewer)) continue;
      // In a meeting of more than two, one FOUND counts for every pair the viewer is in: one number, one spot.
      for (const x of matches.values()) {
        if (groupOf(x) !== groupOf(m) || x.finishedAt || (x.a !== viewer && x.b !== viewer)) continue;
        if (!x.found[viewer]) x.found[viewer] = now();
      }
      if (!m.found[viewer]) m.found[viewer] = now();
      sweepNotes();
      return true;
    }
    return false;
  }

  /**
   * LET'S FINISH: one side asks to end the meeting kindly ('ask'); the other says yes ('yes', and it is finished for
   * both) or not yet ('no', and the ask is gone). A finished meeting stays finished. False for a match that is not
   * theirs, one already finished, or a word that does not fit where it is.
   */
  function finish(viewer, matchId, word) {
    for (const m of matches.values()) {
      if (m.id !== matchId || (m.a !== viewer && m.b !== viewer)) continue;
      if (m.finishedAt) return false;
      const group = groupOf(m);
      if (word === 'ask' && inGroup(group).size > 2) {
        // In a meeting of three or four, LET'S FINISH takes only you out, at once: the others go on.
        for (const x of matches.values()) {
          if (groupOf(x) !== group || x.finishedAt || (x.a !== viewer && x.b !== viewer)) continue;
          x.finishedAt = now();
          x.left = viewer;
          x.finishAsk = null;
        }
        endAsks((j) => j.group === group && j.via === viewer);
        if (people.get(viewer)?.armed === m.intent) arm(viewer, null, 'finish');
        return true;
      }
      if (word === 'ask') {
        // The ask takes the other's screen, so it is rationed: not again for FINISH_AGAIN_MS after a not yet, and
        // FINISH_ASKS a meeting at most from each side.
        if (m.finishAsk) return m.finishAsk.by === viewer;
        if (m.finishNo && m.finishNo.by !== viewer && now() - m.finishNo.at < FINISH_AGAIN_MS) return false;
        m.finishAsks = { ...(m.finishAsks || {}) };
        if ((m.finishAsks[viewer] || 0) >= FINISH_ASKS) return false;
        m.finishAsks[viewer] = (m.finishAsks[viewer] || 0) + 1;
        m.finishAsk = { by: viewer, at: now() };
        m.finishNo = null;
        return true;
      }
      if (!m.finishAsk || m.finishAsk.by === viewer) return false;
      if (word === 'yes') {
        m.finishedAt = now();
        m.finishAsk = null;
        // Finished, they are done with the card they met on: whoever is still on it is back to READY. A card chosen
        // since stays.
        for (const id of [m.a, m.b]) if (people.get(id)?.armed === m.intent) arm(id, null, 'finish');
        return true;
      }
      if (word === 'no') {
        m.finishNo = { by: viewer, at: now() };
        m.finishAsk = null;
        return true;
      }
      return false;
    }
    return false;
  }

  /** The other person in one of this person's matches, or null. Only the relay asks: no view carries it. */
  function partnerIn(viewer, matchId) {
    for (const m of matches.values()) {
      if (m.id !== matchId || (m.a !== viewer && m.b !== viewer)) continue;
      return m.a === viewer ? m.b : m.a;
    }
    return null;
  }

  /** Everyone a person may see right now: nobody while they are NOT NOW. */
  const seen = (id) => (people.get(id)?.invisible || practises(id) ? [] : [...people.values()].filter((p) => shows(id, p.id)));
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
        armed: me.armed, invisible: me.invisible, was: me.invisible ? comeBackTo(me) : null, practice: practises(id), pick: me.pick, band: me.band, name: me.name, clip: me.clip?.ref ?? null, clipKind: me.clip ? clipKind(me.clip.ref) : null,
        rev: me.rev, seq: me.seq, by: me.by, fresh: me.by === 'relay',
      },
      // Each card's list: near, wall and floor (plays, above).
      // A card the venue closed tonight lists nobody.
      ...Object.fromEntries(Object.entries(plays).map(([card, play]) => [play.list, isClosed(card) ? [] : play.rows(id, others, row)])),
      // The cards open here tonight, in their order: the ones a phone lays out and a person may arm.
      cards: INTENTS.filter((c) => !isClosed(c)),
      // Shown greyed beside them, never armed: LET'S GUESS where there are no questions. A card the staff closed is not.
      resting: !quiz && !closed?.cards.includes('guess') ? ['guess'] : [],
      // LET'S GUESS: the questions, and for each one this person answered, how it went. Never anyone else's.
      quiz: quiz && !isClosed('guess') ? {
        questions: dealFor(id).map(({ q, order }) => ({ q: quiz[q].q, options: order.map((o) => quiz[q].options[o]) })),
        answered: (answers.get(id) ?? []).map((c, i) => {
          const { q, order } = dealFor(id)[i];
          return { choice: order.indexOf(c), right: c === quiz[q].answer, answer: order.indexOf(quiz[q].answer), fact: quiz[q].fact };
        }),
        done: doneOf(id),
        score: scoreOf(id),
        lastAt: lastAnswer.get(id) ?? null,
      } : null,
      // And, once the venue's staff name FIRST SONG?'s answer: the same for everyone.
      opener: opener ? { ...opener } : null,
      // What the venue's staff told everyone here, and the show's times if they moved them: the same for everyone.
      notice: notice ? { ...notice } : null,
      times: times ? { ...times } : null,
      // What the people here said this venue is, when nobody listed it.
      card: cardOut(),
      matches:[...matches.values()].filter((m) => m.a === id || m.b === id).map((m) => {
        const other = m.a === id ? m.b : m.a;
        const both = m.keep[m.a] && m.keep[m.b];
        const rest = m.finishedAt ? [] : [...inGroup(groupOf(m))].filter((x) => x !== id && x !== other);
        return {
          id: m.id, intent: m.intent, at: m.at, spot: m.spot, number: m.number,
          // The meeting it is part of, and who else is still in it, by the names they gave.
          group: groupOf(m), with: rest.map((x) => nameIn(x, groupOf(m))).sort(),
          // Out of a meeting of more than two: 'you' left it, or 'them'.
          left: m.left ? (m.left === id ? 'you' : 'them') : null,
          name: people.get(other)?.name || m.names[other] || '', band: m.bands[other],
          pick: m.picks[other], yourPick: m.picks[id],
          score: m.scores?.[other] ?? null, yourScore: m.scores?.[id] ?? null,
          kept: m.keep[id], keptByBoth: both,
          contact: both ? m.contacts[other] : '',
          // Your own found; the time only once both said it, the later of the two.
          found: !!m.found[id],
          foundAt: m.found[m.a] && m.found[m.b] ? Math.max(m.found[m.a], m.found[m.b]) : null,
          // LET'S FINISH: who asked to end it ('you' or 'them'), when it ended, and, to the one who asked, when the
          // other said not yet.
          finishAsked: m.finishAsk ? (m.finishAsk.by === id ? 'you' : 'them') : null,
          finishedAt: m.finishedAt ?? null,
          notYetAt: m.finishNo && m.finishNo.by !== id ? m.finishNo.at : null,
        };
      }),
      // Each meeting you are in where someone is still looking: what its people said about where they are, by group.
      // Only what was said since you came into it. (A block takes the blocker out of the meeting, so nobody here is
      // someone they blocked.)
      talk: Object.fromEntries([...new Set([...matches.values()]
        .filter((m) => (m.a === id || m.b === id) && !m.finishedAt).map(groupOf))]
        .filter((g) => talkOpen(g, id))
        .map((g) => [g, { group: g, notes: (notes.get(g) ?? []).filter((n) => n.at >= cameInto(g, id)).map((n) => ({ name: n.by === id ? '' : nameIn(n.by, g), text: n.text, at: n.at, mine: n.by === id })) }])),
      // Asks to let someone join a meeting you are in, yours to answer: the newcomer as a band and a pick, never a
      // name before the yes, and who they came by.
      joinAsks: [...joins.values()].filter((j) => joinOpen(j) && j.who !== id && !j.yes.includes(id) && inGroup(j.group).has(id))
        .map((j) => ({ id: j.id, intent: j.intent, at: j.at, band: people.get(j.who)?.band ?? null, pick: people.get(j.who)?.pick ?? null,
          via: people.get(j.via)?.name || '' })),
      // Your own asks to join: how many yes are still to come, or when it did not happen. Never who said what.
      joining: [...joins.values()].filter((j) => j.who === id && joinState(j) !== 'in' && (joinState(j) === 'open' || now() - joinEnd(j) < JOIN_MS))
        .map((j) => ({ id: j.id, intent: j.intent, at: j.at,
          waiting: [...inGroup(j.group)].filter((x) => !j.yes.includes(x)).length,
          refusedAt: joinState(j) === 'no' ? joinEnd(j) : null })),
    };
  }

  /**
   * What a restart must carry (docs/superpowers/specs/2026-09-29-restart-persistence-design.md §1), as plain data:
   * no clip ref, and nothing a band heard.
   */
  function dump() {
    return {
      salt,
      people: [...people.values()].map((p) => ({ ...p })),
      blocks: [...blocks].map(([id, ids]) => [id, [...ids]]),
      waves: [...waves],
      latest: [...latest],
      likes: [...likes.keys()],
      dances: [...dances.keys()],
      // Kept apart from `dances`, so a build from before clips were kept reads this dump as it always did.
      danceClips: [...dances].filter(([, ref]) => ref),
      matches: [...matches.values()],
      joins: [...joins.values()],
      nextJoin,
      tombs: [...tombs],
      ended: [...ended].map(([id, e]) => ({ id, ...e })),
      reports: reports.slice(),
      nextReport,
      nextMatch,
      era,
      opener,
      notice,
      times,
      closed,
      card: card ? { fields: { ...card.fields }, lat: card.lat, lon: card.lon, at: card.at, wrong: { ...card.wrong }, hidden: card.hidden } : null,
      answers: [...answers],
      teams: [...teams.keys()],
      quizHash: quiz ? quizHash(quiz) : null,
      quizDeal: quiz ? QUIZ_DEAL : null,
    };
  }

  return {
    finish, admit, note,
    join, leave, forgetPerson, forgetLeft, setProfile, arm, setInvisible, setPractice, sweepPractice, fromPhone, pick, postClip, setOpener, setNotice, setTimes, letGo,
    /** The opener as staff named it ({ track, at }), or null. */
    opener: () => (opener ? { ...opener } : null),
    /** The notice standing ({ text, at }), or null. */
    notice: () => (notice ? { ...notice } : null),
    /** The times as staff moved them (the five, and at), or null. */
    times: () => (times ? { ...times } : null),
    /** The cards staff closed tonight ({ cards, at }), or null while every card is open. */
    closed: () => (closed ? { cards: [...closed.cards], at: closed.at } : null),
    setClosed,
    /** Is this card closed here tonight: by staff, or LET'S GUESS for want of a quiz. */
    isClosed,
    /** Whether tonight's show brought LET'S GUESS its questions. */
    hasQuiz: () => !!quiz,
    fillCard, wrongCard,
    /** The venue card as the people here made it, `hidden` once two said its venue is wrong; null for none. */
    card: () => (card ? { ...cardOut(), hidden: card.hidden } : null),
    wave,wavedAtYou, wavesAt, like, unlike, danceBack, block, answer, team,
    /** The cards that have a yes here, in their order (tests/cards.test.js holds them to relay/cards.js). */
    played: () => Object.keys(plays),
    report, keep, found, partnerIn, heard, nearTick, viewFor, dump,
    /** How many handles the room holds now (a count for the tests, so the ones of people who left are seen to go). */
    handlesHeld: () => { let n = 0; for (const row of handles.values()) n += row.size; return n; },
    /** For the relay: who is here, so it knows whose view to push. */
    ids: () => [...people.keys()],
    has: (id) => people.has(id),
    /** When someone here was made in this room, or null for someone not here. */
    joinedAt: (id) => people.get(id)?.joinedAt ?? null,
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
