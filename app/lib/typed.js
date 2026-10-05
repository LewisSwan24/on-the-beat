// ON THE BEAT — a venue nobody listed: a room named by what was typed.
//
// Two people at the same gig type its name their own way, and each typed name is a room of its own, so a
// difference that is only spelling must not split them. Before 5 Oct 2026 only case and spacing were let go:
// "Fortitude Music Hall" and "the Fortitude Music Hall" were two rooms, and neither saw the other.

/** The room a typed venue names: case, accents, punctuation, "&" for "and" and a leading "the" let go. */
export function roomOf(text) {
  const plain = String(text ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  // Accents go from Latin letters only: in other scripts a mark can be the letter (ド is not ト).
  const loose = plain.normalize('NFKC').replace(/[À-ɏ]/g, (ch) => ch.normalize('NFD').replace(/\p{M}/gu, ''))
    .replace(/&/g, ' and ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
    .replace(/^the /, '');
  // Nothing left (only punctuation, or only "the"): the words as typed are the name.
  return (loose && loose !== 'the' ? loose : plain).slice(0, 80);
}
