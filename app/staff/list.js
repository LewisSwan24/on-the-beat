// ON THE BEAT — the staff page's words for a report, and their order
// (docs/superpowers/specs/2026-09-28-staff-reports-design.md §4). Pure, so they are tested without a browser.

/** What the page says for each way the relay can refuse a sign-in. */
export const REFUSED = {
  'no staff page': 'This venue has no staff page yet.',
  'wrong code': 'That passcode is not right.',
  'too many tries': 'Too many tries. Wait a minute, then try again.',
  expired: 'Signed out: it is a new night, or the passcode was changed. Enter the passcode again.',
  'bad staff': 'This page could not sign in. Reload it and try again.',
  'too many venues': 'The relay is full right now. Try again in a minute.',
  'signed out': 'Signed out. Enter the passcode again.',
};

/** Open reports first, then handled ones; each newest first, as the relay sends them. */
export const ordered = (reports) => [...reports].sort((a, b) => (a.handledAt ? 1 : 0) - (b.handledAt ? 1 : 0));

export const openCount = (reports) => reports.filter((r) => !r.handledAt).length;

/** About someone · P-4F2A91 · reported 3 times by 2 people, or Something else. */
export function whoLine(r) {
  if (!r.about) return 'Something else';
  const times = r.times === 1 ? 'reported once' : 'reported ' + r.times + ' times';
  const by = r.people === 1 ? 'by 1 person' : 'by ' + r.people + ' people';
  return 'About someone · ' + r.about + ' · ' + times + ' ' + by;
}

/** now near the bar · then near the bar · reporter was by the stage; now: left once they have gone. */
export function whereLine(r) {
  const parts = [];
  if (r.about) {
    parts.push(r.bandNow === 'left' ? 'now: left' : 'now ' + r.bandNow);
    if (r.bandThen) parts.push('then ' + r.bandThen);
  }
  parts.push('reporter was ' + r.fromThen);
  return parts.join(' · ');
}

/** The ids in this list the last one did not have. The first list, after a sign-in, has none new. */
export const freshIds = (seen, reports) => (seen ? reports.filter((r) => !seen.has(r.id)).map((r) => r.id) : []);

/** The tab's title: how many are open, and where. */
export const titleFor = (label, open) => (open ? '(' + open + ') ' : '') + 'Staff · ' + label;

/** When a report was made, on a 24-hour clock: 20:05. */
export const timeOf = (at) => new Date(at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
