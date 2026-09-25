// What the phone remembers. The relay forgets the night when it stops; the
// phone keeps its own account of it — where it was, what it did, who it met —
// and, for good, the contacts that both sides chose to keep.
//
// A night gets its own random id, so a person is not the same stranger to the
// relay two nights running.

import { nightOf } from './phase.js';

const KEY = 'otb:v1';
const NIGHTS_KEPT = 14;

const read = () => {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
};

export function load() {
  const s = read();
  return {
    name: typeof s.name === 'string' ? s.name : '',
    contact: typeof s.contact === 'string' ? s.contact : '',
    promisesSeen: !!s.promisesSeen,
    bandSound: s.bandSound !== false,   // the wristband's sound switch: the person's own, on unless kept off
    nights: s.nights && typeof s.nights === 'object' ? s.nights : {},
    kept: Array.isArray(s.kept) ? s.kept : [],
  };
}

export function save(s) {
  const dates = Object.keys(s.nights).sort().slice(-NIGHTS_KEPT);
  const nights = Object.fromEntries(dates.map((d) => [d, s.nights[d]]));
  try { localStorage.setItem(KEY, JSON.stringify({ ...s, nights })); } catch { /* private mode: live for now */ }
}

const hex = (n) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, '0')).join('');

export const tonightKey = () => nightOf(new Date());

/** Tonight's page of the record, made on first use. */
export function tonight(s) {
  return s.nights[tonightKey()] || null;
}

export function startNight(s, show) {
  const key = tonightKey();
  const was = s.nights[key];
  // Choosing the same venue again keeps the night; a different one starts a new room.
  const same = was && was.show && was.show.room === show.room;
  // A second venue on the same night is a new room and a new stranger, but the
  // same night on the record.
  const night = same ? { ...was, show } : {
    me: hex(16), show, state: {},
    events: [...(was?.events || []), { at: Date.now(), kind: 'arrived', text: 'arrived at ' + placeOf(show) }],
    matches: was?.matches || {},
  };
  return { ...s, nights: { ...s.nights, [key]: { ...night, left: false, leaving: false } } };
}

/** "The Roundhouse, Camden" -> "the roundhouse" */
export const placeOf = (show) => String(show?.venue || show?.act || 'the venue').split(',')[0].trim().toLowerCase();

export function addEvent(s, kind, text, at = Date.now()) {
  const key = tonightKey();
  const n = s.nights[key];
  if (!n) return s;
  return { ...s, nights: { ...s.nights, [key]: { ...n, events: [...n.events, { at, kind, text }] } } };
}

export function hasEvent(s, kind) {
  return !!tonight(s)?.events.some((e) => e.kind === kind);
}

/** A match as the phone last saw it — kept even after the relay has forgotten it. */
export function noteMatch(s, m) {
  const key = tonightKey();
  const n = s.nights[key];
  if (!n) return s;
  const prev = n.matches[m.id] || {};
  const next = { ...prev, ...m, seenAt: prev.seenAt || Date.now() };
  if (JSON.stringify(prev) === JSON.stringify(next)) return s;
  let kept = s.kept;
  if (m.keptByBoth && m.contact && !kept.some((k) => k.night === key && k.id === m.id)) {
    kept = [...kept, { night: key, id: m.id, name: m.name, contact: m.contact, at: m.at, venue: n.show?.venue || '' }];
  }
  return { ...s, kept, nights: { ...s.nights, [key]: { ...n, matches: { ...n.matches, [m.id]: next } } } };
}
