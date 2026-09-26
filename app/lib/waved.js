// A wave at you, on the phone (docs/superpowers/specs/2026-09-25-wrist-waves-
// design.md §2 and §3). With a live wristband the band calls, and the phone
// does not buzz as well. Without one (none paired, or paired but flat, off or
// out of reach) the phone buzzes once for each new wave. A wave is marked seen
// either way, in the night's record, so neither a reload nor a band that later
// goes out of reach brings a buzz for a wave already called.

/** The SAY HI rows that waved at you and wait, which the phone has not seen before. */
export function newWaves(view, seen) {
  const known = new Set(seen);
  return (view?.near || []).filter((r) => r.wavedAtYou && !r.waved && !known.has(r.handle));
}

/** Whether new waves buzz the phone: only with no live wristband to call instead. */
export const buzzes = (fresh, view) => fresh.length > 0 && !view?.me?.wristband?.live;

/** A row's line once you waved: nothing about whether they wear a band. */
export const WAVED_LINE = "Waved — they'll be told";

/** "How this works": the wristband's part in a wave. */
export const WAVES_HOW = 'Someone waving shows on your wristband: press its face to see, and hold its side to wave back.';
