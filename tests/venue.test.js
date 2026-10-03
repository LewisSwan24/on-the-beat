import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fiveOf, inOrder, movedLine, noticeArrived, shiftFrom, showWith, timesArrived } from '../app/lib/venue.js';
import { phaseLine, phaseOf } from '../app/lib/phase.js';

const SHOW = { id: 'v', room: 'v', venue: 'Moth Club, Hackney', act: 'KAYO LANE',
  doors: '19:30', support: '20:15', break: '20:50', headline: '21:00', end: '22:45' };
const MOVED = { doors: '19:30', support: '20:15', break: '21:10', headline: '21:20', end: '23:05', at: 7 };
const view = (more) => ({ me: { pick: null }, notice: null, times: null, ...more });

test('the show as tonight runs it takes the moved times and keeps everything else', () => {
  assert.equal(showWith(SHOW, null), SHOW);
  assert.equal(showWith(null, MOVED), null);
  const run = showWith(SHOW, MOVED);
  assert.deepEqual(run, { ...SHOW, break: '21:10', headline: '21:20', end: '23:05' });
  assert.equal(run.at, undefined, 'when they moved is not a time of the show');
  // 21:12: listed, the headline is on; as moved, it is the break.
  const at = new Date(2026, 9, 3, 21, 12);
  assert.equal(phaseOf(SHOW, at), 'HEADLINE');
  assert.equal(phaseOf(run, at), 'BREAK');
  assert.equal(phaseLine(run, at), 'BREAK · headline in 8 min');
});

test('what moved is said as the parts that moved, at their new times', () => {
  assert.equal(movedLine(SHOW, showWith(SHOW, MOVED)), 'Break 21:10 · Headline 21:20 · End 23:05');
  assert.equal(movedLine(SHOW, SHOW), '');
  assert.equal(movedLine({}, { headline: '21:45' }), 'Headline 21:45', 'a show with no times is an ordinary evening');
});

test('a notice is told once, kept on Tonight, and one taken down is not taken out', () => {
  assert.equal(noticeArrived({}, { me: null, notice: { text: 'x', at: 1 } }), null, 'no view from the room yet');
  assert.equal(noticeArrived({}, view()), null);
  const first = noticeArrived({}, view({ notice: { text: 'Exit is on the left', at: 5 } }));
  assert.deepEqual(first, { patch: { noticeSeen: 5 }, event: 'the venue said: Exit is on the left', say: 'From the venue: Exit is on the left' });
  assert.equal(noticeArrived(first.patch, view({ notice: { text: 'Exit is on the left', at: 5 } })), null, 'told once');
  assert.equal(noticeArrived(first.patch, view()), null, 'taken down: nothing to say');
  assert.equal(noticeArrived(first.patch, view({ notice: { text: 'Exit is on the left', at: 9 } })).patch.noticeSeen, 9, 'sent again is told again');
});

test('moved times are told once, with what moved; back as listed is told too', () => {
  assert.equal(timesArrived({}, { me: null, times: MOVED }, SHOW), null);
  assert.equal(timesArrived({}, view(), SHOW), null, 'as listed, and never moved: nothing');
  const moved = timesArrived({}, view({ times: MOVED }), SHOW);
  assert.deepEqual(moved, { patch: { timesSeen: 7 }, say: 'The venue moved the times: Break 21:10 · Headline 21:20 · End 23:05.' });
  assert.equal(timesArrived(moved.patch, view({ times: MOVED }), SHOW), null);
  assert.deepEqual(timesArrived(moved.patch, view(), SHOW), { patch: { timesSeen: null }, say: 'The times are back as listed.' });
});

test('the staff page moves a time and everything after it, and checks the order as the relay does', () => {
  const five = fiveOf(SHOW);
  assert.deepEqual(five, { doors: '19:30', support: '20:15', break: '20:50', headline: '21:00', end: '22:45' });
  assert.deepEqual(fiveOf({}), { doors: '19:00', support: '20:00', break: '20:45', headline: '21:30', end: '23:00' });
  assert.deepEqual(shiftFrom(five, 'break', 20), { ...five, break: '21:10', headline: '21:20', end: '23:05' });
  assert.deepEqual(shiftFrom(five, 'doors', -5).doors, '19:25');
  assert.equal(shiftFrom({ ...five, end: '23:58' }, 'end', 5).end, '00:03', 'past midnight wraps the clock');
  assert.equal(inOrder(five), true);
  assert.equal(inOrder({ ...five, end: '00:30' }), true, 'past midnight is later');
  assert.equal(inOrder({ ...five, headline: '20:00' }), false);
  assert.equal(inOrder({ ...five, end: '' }), false);
  assert.equal(inOrder({ ...five, break: '20:15', support: '20:15' }), true, 'two parts may start together');
});
