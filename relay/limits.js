// ON THE BEAT — counting how often something happened, over a sliding window
// (docs/superpowers/specs/2026-09-29-staff-security-design.md §3).

/**
 * How often each key may do something: `max` times in any `ms`. Every attempt is counted, a refused one too, so
 * someone who keeps trying while refused is not let back in until an hour after they stop. A key keeps only its
 * newest `max` times, so a flood cannot make it grow.
 */
export function rolling({ ms, max }) {
  const seen = new Map();   // key -> its newest times, oldest first
  return {
    /** Records an attempt at `at`, and says whether it is within the limit. */
    take(key, at) {
      const list = (seen.get(key) ?? []).filter((t) => at - t < ms);
      const within = list.length < max;
      list.push(at);
      if (list.length > max) list.shift();
      seen.set(key, list);
      return within;
    },
    /** Forgets every key whose times are all older than the window. */
    prune(at) {
      for (const [key, list] of seen) if (list.every((t) => at - t >= ms)) seen.delete(key);
    },
    /** For tests: how many keys are held, and how many times a key holds. */
    size: () => seen.size,
    held: (key) => (seen.get(key) ?? []).length,
  };
}
