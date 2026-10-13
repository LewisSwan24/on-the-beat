// ON THE BEAT — where you are, worked out on the phone. Its own place never leaves it: the relay sends every room's
// rough place and the phone sorts (docs/superpowers/specs/2026-10-13-venue-cards-design.md §2).

export const NEAR_M = 2000;
export const WRONG_M = 500;
const R = 6_371_000;
const rad = (d) => (d * Math.PI) / 180;
const placed = (p) => !!p && Number.isFinite(p.lat) && Number.isFinite(p.lon);

/** Metres between two places, along the ground. */
export function distanceM(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** "300 m", "3.2 km", "12 km". */
export function distanceLabel(m) {
  if (m < 1000) return Math.round(m / 50) * 50 + ' m';
  if (m < 10_000) return (Math.round(m / 100) / 10).toFixed(1) + ' km';
  return Math.round(m / 1000) + ' km';
}

/** Tonight's rooms within NEAR_M, nearest first with how far (`away`); then the rest as they came. */
export function byPlace(shows, here) {
  if (!placed(here)) return { near: [], rest: shows };
  const near = [];
  const rest = [];
  for (const s of shows) {
    const away = placed(s) ? distanceM(here, s) : Infinity;
    if (away <= NEAR_M) near.push({ ...s, away });
    else rest.push(s);
  }
  near.sort((a, b) => a.away - b.away);
  return { near, rest };
}

/** How far the room is when that is more than WRONG_M; null when it is not, or either place is unknown. */
export function wrongRoom(here, show) {
  if (!placed(here) || !placed(show)) return null;
  const m = distanceM(here, show);
  return m > WRONG_M ? m : null;
}

export const wrongLine = (m, show) =>
  "You're " + distanceLabel(m) + ' from ' + String(show?.venue || 'the venue').split(',')[0].trim() + '. Wrong place?';

export const roundPlace = (p) => ({ lat: Math.round(p.lat * 1000) / 1000, lon: Math.round(p.lon * 1000) / 1000 });

// What a venue card says, and so what it alone says once there is one.
const CARD_KEYS = ['venue', 'act', 'doors', 'support', 'break', 'headline', 'end', 'lat', 'lon'];

/**
 * The night's show with what the people there said in place of what it was when chosen: the card is the whole truth
 * for its fields, so one two people cleared is gone for everyone, and a typed show's placeholder act goes too.
 */
export function cardOver(show, card) {
  if (!show || !card) return show;
  const base = Object.fromEntries(Object.entries(show).filter(([k]) => !CARD_KEYS.includes(k)));
  return { ...base, act: '', ...card };
}

/** How long a found place stands for where the phone is. */
export const PLACE_FRESH_MS = 2 * 60_000;
/** The phone's place ({ lat, lon, at }) while it is fresh, as { lat, lon }; null once it is older, or never found. */
export const freshPlace = (p, now = Date.now()) => (p && now - p.at <= PLACE_FRESH_MS ? { lat: p.lat, lon: p.lon } : null);

/** What the phone keeps of a row it chose: never how far it was from it (spec §2.5). */
export const chosenRow = (s) => {
  const { away: _, ...row } = s;
  return row;
};
