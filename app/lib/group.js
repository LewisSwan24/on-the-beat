// ON THE BEAT — a meeting of three or four, on the phone.
//
// The relay keeps a meeting as pairs; the pairs of one meeting share its group id (a pair's own id, for two people),
// its number and its spot, and each names who else is still in it (`with`). This puts them back together where the
// phone shows a meeting as one thing.

const groupKey = (m) => m.group ?? m.id;

/**
 * The FINISH list: one row a meeting, newest first. A row names everyone still in it (everyone it had, once it is
 * over for you), says whether it is more than two of you, and the meeting LET'S FINISH is asked by: its newest one
 * still going, or its newest.
 */
export function finishRows(matches) {
  const groups = new Map();
  for (const m of matches || []) {
    const k = groupKey(m);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(m);
  }
  const rows = [...groups].map(([key, pairs]) => {
    const byAt = [...pairs].sort((a, b) => a.at - b.at);
    const open = byAt.filter((m) => !m.finishedAt);
    const shown = open.length ? open : byAt;
    return {
      key,
      names: shown.map((m) => m.name),
      many: open.length > 1 || open.some((m) => (m.with || []).length > 0),
      done: !open.length,
      match: shown[shown.length - 1],
      at: byAt[byAt.length - 1].at,
    };
  });
  return rows.sort((a, b) => b.at - a.at);
}

/** Who else is in a meeting, said once on its screen; nothing for two of you. */
export function alsoLine(m) {
  const w = m?.with || [];
  if (!w.length) return '';
  const names = w.length === 1 ? w[0] : w.slice(0, -1).join(', ') + ' and ' + w[w.length - 1];
  return names + (w.length === 1 ? ' is' : ' are') + ' in this meeting too.';
}
