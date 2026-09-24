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

/** The line under the phase bar, as the canvas writes it. */
export function phaseLine(show, date = new Date()) {
  const now = minsOf(date);
  const t = timesOf(show);
  const phase = phaseOf(show, date);
  const act = String(show?.act || 'the headline').toLowerCase();
  switch (phase) {
    case 'DOORS': return now < t.doors ? 'DOORS · open at ' + (show?.doors || DEFAULT_TIMES.doors) : 'DOORS OPEN · support in ' + inMins(t.support - now);
    case 'SUPPORT': return 'SUPPORT ACT · break in ' + inMins(t.break - now);
    case 'BREAK': return 'BREAK · headline in ' + inMins(t.headline - now);
    case 'HEADLINE': return 'HEADLINE · ' + act + ', on now';
    default: return 'AFTER · lights up, last calls';
  }
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

/** "Doors 19:00 · Support 20:00 · Headline 21:30" */
export const timesLine = (show) =>
  'Doors ' + (show?.doors || DEFAULT_TIMES.doors) + ' · Support ' + (show?.support || DEFAULT_TIMES.support) +
  ' · Headline ' + (show?.headline || DEFAULT_TIMES.headline);
