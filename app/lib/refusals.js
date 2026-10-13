// ON THE BEAT — what a phone says aloud when the relay refuses something it asked for
// (docs/superpowers/specs/2026-09-29-staff-security-design.md §3). A refusal not listed is not spoken.

import { WHERE } from '../copy.js';

const SAY = {
  'clip refused': "that didn't go. they may have left, or gone quiet.",
  'clip too fast': 'one at a time. give it a few seconds before the next clip.',
  'report refused': 'too many reports just now. please tell a member of staff.',
  // A venue card fill (docs/superpowers/specs/2026-10-13-venue-cards-design.md §3).
  ...Object.fromEntries(['taken', 'limit', 'full', 'listed', 'bad'].map((why) => ['fill ' + why, WHERE[why]])),
};

/** The words for a relay refusal (`{t:'error', why}`), or null when the phone says nothing for it. */
export const refusalWords = (m) => (m?.t === 'error' && Object.hasOwn(SAY, m.why) ? SAY[m.why] : null);
