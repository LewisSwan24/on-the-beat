// Where the night is, from the show's own times and the phone's clock.
//
// A night runs from noon to six in the morning: a time before six belongs to
// the evening before, so a show that ends at 00:30 is still tonight's, and so
// is the walk home.

export const PHASES = ['DOORS', 'SUPPORT', 'BREAK', 'HEADLINE', 'AFTER'];

/** A venue nobody listed gets an ordinary evening. */
export const DEFAULT_TIMES = { doors: '19:00', support: '20:00', break: '20:45', headline: '21:30', end: '23:00' };

const clockMins = (hhmm) => {
  const [h, m] = String(hhmm).split(':').map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
};
const nightMins = (m) => (m < 360 ? m + 1440 : m);
const minsOf = (date) => nightMins(date.getHours() * 60 + date.getMinutes());

export function timesOf(show) {
  const t = {};
  for (const k of Object.keys(DEFAULT_TIMES)) t[k] = nightMins(clockMins(show?.[k]) ?? clockMins(DEFAULT_TIMES[k]));
  return t;
}

/** The phase a moment falls in. */
export function phaseOf(show, date = new Date()) {
  const now = minsOf(date);
  const t = timesOf(show);
  if (now >= t.end) return 'AFTER';
  if (now >= t.headline) return 'HEADLINE';
  if (now >= t.break) return 'BREAK';
  if (now >= t.support) return 'SUPPORT';
  return 'DOORS';
}

const inMins = (n) => {
  const m = Math.max(1, Math.ceil(n));
  return m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + (m % 60 ? (m % 60) + ' min' : '').trim();
};

/** Where you are tonight, as the show is listed: the act, then the venue (F4). */
export const whereLine = (show) => [show?.act, show?.venue].filter(Boolean).join(' · ');

/** The line under the phase bar, as the canvas writes it. */
export function phaseLine(show, date = new Date()) {
  const now = minsOf(date);
  const t = timesOf(show);
  const phase = phaseOf(show, date);
  const act = String(show?.act || 'the headline').toLowerCase();
  // A time nobody gave is never shown, nor counted down to (N1): the phase still runs on an ordinary evening.
  if (!givenTimes(show).length) return NO_TIMES;
  const till = (label, k) => (show?.[k] ? label + ' · ' + k + ' in ' + inMins(t[k] - now) : label);
  switch (phase) {
    case 'DOORS':
      if (now < t.doors) return show?.doors ? 'DOORS · open at ' + show.doors : 'DOORS';
      return till('DOORS OPEN', 'support');
    case 'SUPPORT': return till('SUPPORT ACT', 'break');
    case 'BREAK': return till('BREAK', 'headline');
    case 'HEADLINE': return 'HEADLINE · ' + act + ', on now';
    default: return 'AFTER · lights up, last calls';
  }
}

/** How long the bar takes to fill AFTER's fifth, from the end of the show. */
const AFTER_MINS = 60;

/**
 * The bar over the phases, 0 to 1: each phase fills its own fifth, under its own name, as the clock runs through
 * it. Null when the show was given no times: no progress is made up (N1).
 */
export function nightProgress(show, date = new Date()) {
  if (!givenTimes(show).length) return null;
  const now = minsOf(date);
  const t = timesOf(show);
  const edges = [t.doors, t.support, t.break, t.headline, t.end, t.end + AFTER_MINS];
  if (now <= edges[0]) return 0;
  for (let i = 0; i < 5; i++) {
    if (now < edges[i + 1]) return (i + (now - edges[i]) / Math.max(1, edges[i + 1] - edges[i])) / 5;
  }
  return 1;
}

/** The calendar day a night is filed under. */
export function nightOf(date = new Date()) {
  const d = new Date(date);
  if (d.getHours() < 6) d.setDate(d.getDate() - 1);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

export const hhmm = (ms) => {
  const d = new Date(ms);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
};

/** What a room says before anyone has given it a time. */
export const NO_TIMES = 'no times yet';

/** The times a show was given, of the five, in the night's order. */
const givenTimes = (show) => Object.keys(DEFAULT_TIMES).filter((k) => show?.[k]);

/** "Doors 19:00 · Support 20:00 · Headline 21:30": only the times given, or NO_TIMES (N1). */
export function timesLine(show) {
  const shown = ['doors', 'support', 'headline'].filter((k) => show?.[k]);
  if (!shown.length) return givenTimes(show).length ? '' : NO_TIMES;
  return shown.map((k) => k[0].toUpperCase() + k.slice(1) + ' ' + show[k]).join(' · ');
}
