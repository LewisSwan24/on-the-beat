// ON THE BEAT — which night a moment belongs to, at the venue.
//
// A night runs to 06:00: a gig that ends at one in the morning is still that
// evening's night. The relay ends a night at 06:00 in the venue's time zone
// (`nightTz`, an IANA name), which defaults to the relay machine's own.

const SIX_HOURS = 6 * 3_600_000;

/** The night `ms` belongs to, as YYYY-MM-DD in `tz`: before 06:00 it is still the night before. */
export function nightOf(ms, tz) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(ms - SIX_HOURS));
  const get = (type) => parts.find((p) => p.type === type).value;
  return get('year') + '-' + get('month') + '-' + get('day');
}
