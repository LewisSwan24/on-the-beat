// ON THE BEAT — what a phone says aloud when the relay refuses something it asked for
// (docs/superpowers/specs/2026-09-29-staff-security-design.md §3). A refusal not listed is not spoken.

const SAY = {
  'clip refused': "that didn't go. they may have left, or gone quiet.",
  'report refused': 'too many reports just now. please tell a member of staff.',
};

/** The words for a relay refusal (`{t:'error', why}`), or null when the phone says nothing for it. */
export const refusalWords = (m) => (m?.t === 'error' && Object.hasOwn(SAY, m.why) ? SAY[m.why] : null);
