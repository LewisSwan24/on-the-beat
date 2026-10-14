// The poster's own logic, kept out of the page so the tests can hold it.

/** The venue a poster address names: /poster/<id>, or null for the poster with no venue. */
export function venueFromPath(pathname) {
  const m = /^\/poster\/([^/]+)\/?$/.exec(String(pathname || ''));
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return null;
  }
}

/** How many play at the venue tonight, in words. Before the relay has said, nothing: a wrong zero would put people off. */
export function hereLine(n) {
  if (!Number.isInteger(n) || n < 0) return '';
  if (n === 0) return 'nobody yet. be the first.';
  return n === 1 ? '1 person playing tonight' : n + ' people playing tonight';
}

const TIMES = [['doors', 'DOORS'], ['support', 'SUPPORT'], ['break', 'BREAK'], ['headline', 'HEADLINE'], ['end', 'ENDS']];

/** Tonight's times as [label, time] pairs: only those the venue gave, in the night's order. */
export function posterTimes(show) {
  return TIMES.filter(([k]) => typeof show?.[k] === 'string' && show[k]).map(([k, label]) => [label, show[k]]);
}
