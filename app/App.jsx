import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cardOf } from '../relay/cards.js';
import { BAND_OFF, FINISH, GUIDE, HOW, HUE, LEAVE, PROMISES, REPORT, WHERE, matchName, someone, teamHere } from './copy.js';
import { BEAT_HOW, BEAT_SAY, beatRow } from './lib/bandbeat.js';
import { SOUND_SAY, soundRow } from './lib/bandsound.js';
import { battery, buzz, locate, locationGranted, toBase64 } from './lib/device.js';
import { FOLLOW_SAY, follow, intentFor, nextSeq, tapMessage } from './lib/follow.js';
import { restoreTaps } from './lib/guide.js';
import { matchScreen, meetingOn, newlyFound, reportable, shownMatch } from './lib/found.js';
import { connect } from './lib/net.js';
import { openerArrived, openerNews } from './lib/opener.js';
import { noticeArrived, showWith, timesArrived } from './lib/venue.js';
import { DEFAULT_TIMES, phaseLine, phaseOf } from './lib/phase.js';
import { refusalWords } from './lib/refusals.js';
import { roomOf } from './lib/typed.js';
import { saveCard } from './lib/vcard.js';
import { cardOver, chosenRow, freshPlace, roundPlace, wrongRoom } from './lib/where.js';
import * as store from './lib/store.js';
import { WAVES_HOW, WAVE_SAY, buzzes, newWaves, steady, unlooked } from './lib/waved.js';
import { Bar, Home } from './screens/Home.jsx';
import { Beacon, Near, WristBeacon } from './screens/Hi.jsx';
import { Pair, bandLine } from './screens/Band.jsx';
import { BandGuide, Practice } from './screens/Guide.jsx';
import { Scan } from './screens/Scan.jsx';
import { PAIR_SAY, codeFrom } from './lib/pairing.js';
import { Name, Promises, Splash, Venue } from './screens/Onboard.jsx';
import { Pick, Wall } from './screens/Song.jsx';
import { Quiz, Teams } from './screens/Guess.jsx';
import { PHOTO_MAX } from './lib/pose.js';
import { Camera, Floor } from './screens/Dance.jsx';
import { Finish, Leaving, Match, Mate, Quiet, Thanks, Tonight } from './screens/Met.jsx';
import { Cta, Sheet } from './ui.jsx';

const ONBOARDING = new Set(['splash', 'promises', 'venue', 'name']);
const EMPTY = { me: null, near: [], wall: [], floor: [], teams: [], quiz: null, matches: [] };

function useStore() {
  const [s, set] = useState(store.load);
  const update = useCallback((fn) => set((prev) => {
    const next = fn(prev);
    if (next !== prev) store.save(next);
    return next;
  }), []);
  return [s, update];
}

/** The contact asked for the first time someone keeps a match. Its own state, so typing never reaches the app. */
function ContactForm({ initial, onSave }) {
  const [v, setV] = useState(initial || '');
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (v.trim()) onSave(v.trim()); }} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="field" style={{ '--c': 'var(--ok)' }}>
        <input value={v} onChange={(e) => setV(e.target.value.slice(0, 60))} placeholder="@handle, number, anything" aria-label="How they can reach you" />
      </div>
      <button type="submit" className="cta" style={{ '--c': 'var(--ok)', '--g': 'transparent' }} disabled={!v.trim()}>KEEP IT</button>
    </form>
  );
}

const TIMES = Object.keys(DEFAULT_TIMES);
const TIME_NAMES = { doors: 'Doors', support: 'Support', break: 'Break', headline: 'Headline', end: 'End' };

/** A made room's empty fields, to fill (venue cards spec §2.3). Only what is empty is asked; the first to say it has it. */
function CardForm({ show, onSave }) {
  const empty = ['act', ...TIMES].filter((k) => !show[k]);
  const [v, setV] = useState({});
  const said = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x.trim()]).filter(([, x]) => x));
  const ok = Object.keys(said).length > 0;
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (ok) onSave(said); }} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {empty.includes('act') ? (
        <div className="field" style={{ '--c': 'var(--hi)' }}>
          <input value={v.act || ''} onChange={(e) => setV({ ...v, act: e.target.value.slice(0, 60) })} placeholder="who's playing" aria-label="Who is playing" />
        </div>
      ) : null}
      {empty.filter((k) => k !== 'act').map((k) => (
        <label key={k} className="field" style={{ '--c': 'var(--hi)', justifyContent: 'space-between' }}>
          <span className="small">{TIME_NAMES[k]}</span>
          <input type="time" value={v[k] || ''} onChange={(e) => setV({ ...v, [k]: e.target.value })} aria-label={TIME_NAMES[k] + ' time'} style={{ flex: 'none', width: 'auto' }} />
        </label>
      ))}
      <button type="submit" className="cta" style={{ '--c': 'var(--hi)', '--g': 'transparent' }} disabled={!ok}>SAVE</button>
    </form>
  );
}

const WORDS_MAX = 200;   // relay/room.js keeps no more

/** A report's few words for the venue team, if any. Its own state, so typing never reaches the app. */
function ReportForm({ onSend }) {
  const [v, setV] = useState('');
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSend(v.trim()); }} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <textarea className="words" rows={3} value={v} onChange={(e) => setV(e.target.value.slice(0, WORDS_MAX))}
        placeholder="a few words for the venue team (optional)" aria-label="A few words for the venue team, optional" />
      <div className="small" style={{ textAlign: 'right' }} aria-hidden="true">{v.length}/{WORDS_MAX}</div>
      <button type="submit" className="cta" style={{ '--c': 'var(--stop)', '--g': 'transparent' }}>SEND REPORT</button>
    </form>
  );
}

export default function App() {
  const [s, update] = useStore();
  const night = store.tonight(s);
  const listed = night?.show || null;

  const [screen, setScreen] = useState('splash');
  const [stack, setStack] = useState([]);
  const [shows, setShows] = useState(null);
  const [view, setView] = useState(EMPTY);
  const viewRoom = useRef(null);   // the room the view on screen came from
  // The show as tonight runs it: what the people there said it is, for a room nobody listed, and its times as the
  // venue's staff moved them, if they did.
  const show = showWith(cardOver(listed, view.card), view.times);
  // Where the phone is, when it was asked ({ lat, lon, at }): in memory only, never stored (venue cards spec §2.5),
  // and stood for where it is only while fresh: a place found at home is not the gig.
  const [here, setHere] = useState(null);
  const placeNow = freshPlace(here);
  // SEE NEARBY: the venue screen opens on the nearest room, not on the one the phone is in.
  const [nearbyAsked, setNearbyAsked] = useState(false);
  const [finding, setFinding] = useState(false);
  const [status, setStatus] = useState('connecting');
  const [sheet, setSheet] = useState(null);
  const [toast, setToast] = useState(null);
  const [now, setNow] = useState(() => new Date());
  const [ci, setCi] = useState(0);
  // The card the wrist just lit, for the home carousel to turn to once; cleared once it has.
  const [focusCard, setFocusCard] = useState(null);
  const [pickText, setPickText] = useState(night?.state?.pick || '');
  const [matchId, setMatchId] = useState(null);
  const [pickFor, setPickFor] = useState(null);   // the match a PICK ONE came from, or none
  const nearOrder = useRef([]);   // SAY HI handles in the order first seen tonight (F3)
  const [backTo, setBackTo] = useState(null);
  const [dim, setDim] = useState(false);
  const [pairError, setPairError] = useState(null);
  const [pairCode, setPairCode] = useState(null);
  const [pairPending, setPairPending] = useState(false);
  // Opened by a phone's own camera from a wristband's code: /pair/ABCD. Kept
  // for this tab until it pairs, so a reload during onboarding does not lose it.
  const [linked, setLinked] = useState(() => {
    const code = codeFrom(location.href);
    try {
      if (code) sessionStorage.setItem('otb:pair-link', code);
      return code || sessionStorage.getItem('otb:pair-link');
    } catch { return code; }
  });
  const net = useRef(null);
  const stageRef = useRef(null);
  const toastTimer = useRef(null);

  const invisible = !!night?.state?.invisible;
  // What this phone last knew, kept with the night and drawn at once; the relay's next view decides (§3).
  const armed = night?.state?.armed ?? null;
  const seqRef = useRef(night?.state?.seq ?? 0);   // the last seq this phone sent or followed
  const asked = useRef(-1);                         // the seq of this phone's own last tap
  const refused = useRef(-1);                       // the seq of its last showing tap refused `changed`
  useEffect(() => { seqRef.current = night?.state?.seq ?? 0; }, [night?.me]);
  const pick = night?.state?.pick || '';
  const phase = show ? phaseOf(show, now) : 'DOORS';
  const line = show ? phaseLine(show, now) : '';
  // The wristband, as the relay last said — or, before it has said, as this phone remembers.
  const bandId = night?.state?.wristband || null;
  const band = view.me?.wristband ?? (bandId ? { battery: null, live: false } : null);
  const paired = !!band;
  // A pairing waiting for YES (§0). It belongs to the person, so every view carries it until it is answered.
  const check = view.me?.check ?? null;
  // Away for two minutes, the chip says so and offers to pair again.
  const [bandAwaySince, setBandAwaySince] = useState(null);
  useEffect(() => {
    if (!band || band.live) setBandAwaySince(null);
    else setBandAwaySince((t) => t ?? Date.now());
  }, [band?.live, !!band]);
  // Turned off on the wrist is not away: it says OFF at once, and never OFFLINE.
  const bandShown = band ? { ...band, offline: !band.live && !band.off && bandAwaySince !== null && now - bandAwaySince >= 120_000 } : null;

  const say = useCallback((text, action = null) => {
    clearTimeout(toastTimer.current);
    setToast({ text, action });
    toastTimer.current = setTimeout(() => setToast(null), action ? 5000 : 2600);
  }, []);
  const closeSheet = useCallback(() => setSheet(null), []);
  // LET'S FINISH, on the side that asked: say once when it is finished, or when the other says not yet.
  const finishSeen = useRef(null);
  const finishedNow = useRef(null);   // a meeting that just finished, for the screens below to leave
  useEffect(() => {
    const was = finishSeen.current;
    const nowSeen = new Map((view.matches || []).map((m) => [m.id, { done: m.finishedAt, no: m.notYetAt, asked: m.finishAsked }]));
    finishSeen.current = nowSeen;
    if (!was) return;
    for (const m of view.matches || []) {
      const before = was.get(m.id);
      if (!before) continue;
      if (m.finishedAt && !before.done) {
        finishedNow.current = m.id;
        if (before.asked === 'you') say(matchName(m) + ' finished too. enjoy the show.');
      } else if (m.notYetAt && m.notYetAt !== before.no) say(FINISH.notYet(matchName(m)));
    }
  }, [view.matches, say]);

  const setNightState = useCallback((patch) => update((prev) => {
    const key = store.tonightKey();
    const n = prev.nights[key];
    if (!n) return prev;
    return { ...prev, nights: { ...prev.nights, [key]: { ...n, state: { ...(n.state || {}), ...patch } } } };
  }), [update]);

  // ---------- the clock and the shows ----------

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  // Tonight's rooms, read again each time the venue screen opens: a room someone made a minute ago is on it.
  const onVenue = screen === 'venue';
  useEffect(() => {
    if (!onVenue && shows) return undefined;
    let off = false;
    fetch('/api/shows').then((r) => r.json()).then((list) => {
      if (!off) setShows(list.map((x) => ({ ...x, room: x.id })));
    }).catch(() => { if (!off) setShows((was) => was || []); });
    return () => { off = true; };
  }, [onVenue]);   // eslint-disable-line react-hooks/exhaustive-deps

  const find = useCallback(async () => {
    setFinding(true);
    const p = await locate();
    setFinding(false);
    if (p) setHere({ ...p, at: Date.now() }); else say(WHERE.cant);
  }, [say]);
  // Granted before: the venue screen finds the phone afresh with no tap, each time it opens.
  useEffect(() => { if (!onVenue) setNearbyAsked(false); else locationGranted().then((ok) => { if (ok) find(); }); }, [onVenue]);   // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- the room ----------

  const room = show?.room;
  const inRoom = !!(room && night?.me && s.name && s.promisesSeen && !night.left);

  useEffect(() => {
    if (!inRoom) return undefined;
    const n = connect({
      venue: room, me: night.me,
      onView: (v) => { viewRoom.current = room; setView(v); },
      onStatus: setStatus,
      onMessage: (m) => onRelay.current?.(m),
    });
    net.current = n;
    // A page load says nothing new (§3): what this phone holds is kept, and re-said only as again copies.
    const st = night.state || {};
    const seq = st.seq ?? 0;
    n.keep('sound', { t: 'sound', on: s.bandSound });
    n.keep('beat', { t: 'beat', on: s.bandBeat });
    n.keep('profile', { t: 'profile', name: s.name, contact: s.contact });
    n.keep('invisible', { t: 'invisible', on: !!st.invisible, seq });
    n.keep('arm', { t: 'arm', intent: st.armed ?? null, seq });
    if (st.pick) n.keep('pick', { t: 'pick', track: st.pick });
    if (st.wristband) n.keep('pair', { t: 'pair', band: st.wristband, secret: st.bandSecret || '' });
    if (night.leaving) n.keep('leave', { t: 'leave' });
    return () => { n.close(); net.current = null; setView(EMPTY); };
    // Only a new room, or a new night, makes a new connection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inRoom, room, night?.me]);

  useEffect(() => {
    net.current?.say('profile', { t: 'profile', name: s.name, contact: s.contact });
  }, [s.name, s.contact]);

  // The address is only a way in: the app lives at /, and a back gesture must
  // never walk into a pairing code that has since been used.
  useEffect(() => {
    if (location.pathname !== '/' && codeFrom(location.href)) history.replaceState(history.state, '', '/');
  }, []);

  // Pairing, whether the letters were typed, scanned, or came in the address.
  const pairWith = useCallback((code) => {
    setPairError(null);
    setPairCode(code);
    setPairPending(true);
    net.current?.send({ t: 'pair', code });
  }, []);

  // The answer to the check. NO is said here at once; YES waits for the relay's paired.
  const answerCheck = useCallback((yes) => {
    net.current?.send({ t: 'confirm', yes });
    if (!yes) {
      setPairPending(false);
      setPairCode(null);
      if (screen === 'pair') setPairError(PAIR_SAY.no); else say(PAIR_SAY.no);
    }
  }, [screen, say]);

  // A code from the address lands on the pair screen pre-filled. It pairs
  // nothing on its own: like typed or scanned letters, it only starts the
  // check, and the person must see the number on their own wrist and say yes.
  // A decoy QR puts that number on someone else's wrist. Once the check has
  // started it belongs to the person, so the stored copy is dropped: a reload
  // brings the check back, not the letters a second time.
  useEffect(() => {
    if (!linked || !inRoom || !net.current) return;
    setLinked(null);
    try { sessionStorage.removeItem('otb:pair-link'); } catch { /* private window */ }
    setSheet(null);
    setStack([]);
    setScreen('pair');
    pairWith(linked);
  }, [linked, inRoom, pairWith]);

  // What the relay answers that is not a view. Read through a ref, so the one
  // long-lived connection always acts on this render's state.
  const onRelay = useRef(null);
  onRelay.current = (m) => {
    const refusal = refusalWords(m);
    if (refusal) say(refusal);
    if (m.t === 'refused' && m.why === 'changed') refused.current = m.seq;
    if (m.t === 'left') {
      net.current?.forget('leave');
      const key = store.tonightKey();
      update((prev) => (prev.nights[key] ? { ...prev, nights: { ...prev.nights, [key]: { ...prev.nights[key], left: true, leaving: false, state: {} } } } : prev));
      setStack([]);
      setScreen('venue');
    }
    // 06:00 at the venue: the relay has ended the night this phone was in. The record of it stays on Tonight.
    if (m.t === 'over') {
      net.current?.forget('leave');
      const key = Object.keys(s.nights).find((k) => s.nights[k].me === night?.me);
      if (key) update((prev) => ({ ...prev, nights: { ...prev.nights, [key]: { ...prev.nights[key], left: true, leaving: false, state: {} } } }));
      setStack([]);
      setScreen('venue');
      say('The night is over. See you at the next one.');
    }
    const pairFailed = (words) => {
      setPairPending(false);
      setPairCode(null);
      if (screen === 'pair') setPairError(words); else say(words);
    };
    if (m.t === 'paired') {
      setPairPending(false);
      setPairCode(null);
      setNightState({ wristband: m.band, bandSecret: m.secret });
      // Kept, not said: re-said as a claim only after a reconnect.
      net.current?.keep('pair', { t: 'pair', band: m.band, secret: m.secret });
      setPairError(null);
      say(PAIR_SAY.paired);
      // A first pairing on this phone opens the practice (the wristband guide); after that, home as before.
      if (!s.guideSeen) startPractice();
      else if (screen === 'pair') { setStack([]); setScreen('home'); }
    }
    // A check that ended without YES: no answer in time, or turned away on the wrist it reached.
    if (m.t === 'check' && m.ok === false) pairFailed(m.why === 'refused' ? PAIR_SAY.refused : PAIR_SAY.timeout);
    // Every refusal while pairing has its own words — the relay's throttle
    // included, which a real person only meets after a run of mistypes.
    if (m.t === 'error' && PAIR_SAY[m.why] && m.why !== 'gone') pairFailed(PAIR_SAY[m.why]);
    // The only way this phone decides its wristband is gone: the relay says so to its claim.
    if (m.t === 'claim' && m.ok === false && m.why === 'gone' && bandId) {
      net.current?.forget('pair');
      setNightState({ wristband: null, bandSecret: null });
      say(PAIR_SAY.gone);
    }
  };

  // A match the phone has not seen before: record it, buzz, and show it.
  const seen = useRef(null);
  useEffect(() => {
    if (!view.me) return;
    const known = seen.current ?? new Set(Object.keys(night?.matches || {}));
    const fresh = view.matches.filter((m) => !known.has(m.id));
    for (const m of view.matches) known.add(m.id);
    seen.current = known;
    update((prev) => view.matches.reduce((acc, m) => store.noteMatch(acc, m), prev));
    if (!fresh.length) return;
    buzz([70, 50, 70]);
    if (screen === 'camera') { say('you both said yes — it’s on Tonight.'); return; }
    setMatchId(fresh[0].id);
    setSheet(null);
    setStack((st) => [...st, screen].slice(-12));
    setScreen('match');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);
  useEffect(() => { seen.current = null; nearOrder.current = []; }, [night?.me]);

  // A wave at you the phone has not seen: one buzz, unless a live wristband calls instead. Seen either way.
  const wavesSeen = useRef(null);
  useEffect(() => {
    if (!view.me) return;
    const known = wavesSeen.current ?? new Set(night?.waves || []);
    wavesSeen.current = known;
    const fresh = newWaves(view, known);
    if (!fresh.length) return;
    for (const r of fresh) known.add(r.handle);
    update((prev) => store.noteWaves(prev, fresh.map((r) => r.handle)));
    if (buzzes(fresh, view)) {
      buzz([90]);
      // A buzz alone is easy to miss in a loud room: say it, and where to look, unless WHO'S NEAR is already open.
      if (screen !== 'near') say(WAVE_SAY, { label: "SEE WHO'S NEAR", fg: 'var(--hi)', onTap: () => go('near') });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);
  useEffect(() => { wavesSeen.current = null; }, [night?.me]);

  // WHO'S NEAR open is a wave looked at: its dot on SAY HI goes. Kept in the night, so a reload does not bring it back.
  const looked = night?.state?.wavesLooked;
  const waveDot = unlooked(view, looked).length > 0;
  useEffect(() => {
    if (screen !== 'near') return;
    const fresh = unlooked({ near: view.near }, looked);
    if (fresh.length) setNightState({ wavesLooked: [...(looked || []), ...fresh].slice(-200) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, view.near]);

  // FIRST SONG?'s answer, once the venue's staff name it: told once, kept on Tonight, against the pick held when it came.
  useEffect(() => {
    const step = openerArrived(night?.state || {}, view, pick);
    if (!step) return;
    setNightState(step.patch);
    update((prev) => store.setEvent(prev, 'opener', step.event, view.opener?.at));
    if (step.say) say(step.say);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.opener?.track, view.opener?.at, !!view.me, night?.me]);
  const opener = openerNews(view.opener, night?.state?.openerPick ?? pick, view.wall);

  // What the venue's staff tell everyone: a notice, told once and kept on Tonight, and the times when they move them.
  useEffect(() => {
    const step = noticeArrived(night?.state || {}, view);
    if (!step) return;
    setNightState(step.patch);
    update((prev) => store.addEvent(prev, 'notice', step.event, view.notice.at));
    say(step.say);
    buzz([60, 80, 60]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.notice?.at, !!view.me, night?.me]);
  useEffect(() => {
    const step = timesArrived(night?.state || {}, view, listed);
    if (!step) return;
    setNightState(step.patch);
    if (step.say) say(step.say);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.times?.at, !!view.me, night?.me]);
  const notice = view.notice && night?.state?.noticeHidden !== view.notice.at ? view.notice : null;

  // Found by both, news to this phone: a buzz, unless a live wristband plays it instead (found §1). The record
  // keeps foundAt (noteMatch, above), so a reload buzzes for nothing already found.
  const foundSeen = useRef(null);
  useEffect(() => {
    if (!view.me) return;
    const known = foundSeen.current ?? new Set(Object.values(night?.matches || {}).filter((m) => m.foundAt).map((m) => m.id));
    foundSeen.current = known;
    const fresh = newlyFound(view, known);
    if (!fresh.length) return;
    for (const m of fresh) known.add(m.id);
    if (buzzes(fresh, view)) buzz([70, 50, 70, 50, 70]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);
  useEffect(() => { foundSeen.current = null; }, [night?.me]);

  // The relay decides (§3): a view that passes rule 4 sets the cards, the screen and what is re-said.
  useEffect(() => {
    if (!view.me) return;
    const f = follow({ armed, invisible, seq: seqRef.current, asked: asked.current, refused: refused.current, screen }, view);
    if (!f) return;
    seqRef.current = f.seq;
    net.current?.keep('arm', f.said.arm);
    net.current?.keep('invisible', f.said.invisible);
    if (f.armed !== armed || f.invisible !== invisible || f.seq !== (night?.state?.seq ?? 0)) {
      setNightState({ armed: f.armed, invisible: f.invisible, seq: f.seq });
    }
    if (f.events.includes('hi') && !store.hasEvent(s, 'hi')) update((prev) => store.addEvent(prev, 'hi', 'started saying hi'));
    for (const e of f.events) if (e?.kind === 'closed') update((prev) => store.addEvent(prev, e.kind, e.text));
    if (f.clearStack) { setStack([]); setSheet(null); }
    if (f.card) setFocusCard(f.card);
    if (f.screen !== screen && !ONBOARDING.has(screen) && screen !== 'leaving') setScreen(f.screen);
    if (f.toast) say(f.toast.text, f.toast.unpair ? { label: 'NOT YOU? UNPAIR', onTap: unpair } : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  // ---------- what this phone is doing ----------

  // A tap (§2 rules 4 and 5): a new seq, and the rev it was chosen from when it shows the person.
  const tap = useCallback((t, value) => {
    const seq = nextSeq(seqRef.current, Date.now());
    seqRef.current = seq;
    asked.current = seq;
    net.current?.say(t, tapMessage(t, value, seq, view.me?.rev));
    return seq;
  }, [view.me?.rev]);
  // Showing someone needs the relay now. Offline, only what hides is queued:
  // NOT NOW, and a card turned off.
  const cannotShow = useCallback(() => {
    if (net.current?.live() && Number.isInteger(view.me?.rev)) return false;
    say('Not connected — try again');
    return true;
  }, [view.me?.rev, say]);

  const arm = useCallback((intent) => {
    if (intent && cannotShow()) return false;   // arm(null) hides: queued offline
    const seq = tap('arm', intent);
    // Arming makes them visible on the relay; the kept NOT NOW follows without being sent.
    if (intent) net.current?.keep('invisible', { t: 'invisible', on: false, seq });
    setNightState({ armed: intent, ...(intent ? { invisible: false } : {}), seq });
    if (intent === 'hi' && !store.hasEvent(s, 'hi')) update((prev) => store.addEvent(prev, 'hi', 'started saying hi'));
    return true;
  }, [s, setNightState, update, tap, cannotShow]);

  const go = useCallback((to, { replace = false, keepCard = false } = {}) => {
    const intent = intentFor(to, { keepCard });
    // Nothing moves when the card could not be armed.
    if (intent && armed !== intent && !arm(intent)) return;
    setSheet(null);
    if (!replace) setStack((st) => (to === screen ? st : [...st, screen].slice(-12)));
    if (to !== 'camera') setBackTo(null);
    setScreen(to);
  }, [screen, armed, arm]);

  // Back walks the stack, never into onboarding or a match already answered —
  // and while invisible, nowhere at all.
  const now_ = useRef({ stack, invisible: false, screen });
  now_.current = { stack, invisible, screen };
  const back = useCallback(() => {
    setSheet(null);
    setBackTo(null);
    const { stack: st, invisible: quiet, screen: on } = now_.current;
    // Leaving the practice, by any back, ends it and puts back what it opened on.
    if (on === 'guide') { endPracticeRef.current?.(); return; }
    if (quiet) { setStack([]); setScreen('quiet'); return; }
    const prev = st[st.length - 1];
    setStack(st.slice(0, -1));
    // The guide's page can be opened from onboarding (How this works): back from it returns there.
    setScreen(prev && (on === 'band-guide' || !ONBOARDING.has(prev)) && prev !== 'match' ? prev : 'home');
  }, []);

  // The phone's own back gesture walks the app's stack instead of leaving it.
  useEffect(() => {
    if (ONBOARDING.has(screen)) return undefined;
    history.pushState({ otb: true }, '');
    const onPop = () => back();
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [screen, back]);

  const notNow = () => {
    const seq = tap('invisible', true);   // queued when offline, and re-said
    net.current?.keep('arm', { t: 'arm', intent: null, seq });
    setNightState({ armed: null, invisible: true, seq });
    setStack([]);
    setSheet(null);
    setScreen('quiet');
  };

  const backOn = () => {
    if (cannotShow()) return;
    const seq = tap('invisible', false);
    // The relay puts back the card they had (N3); expect it, so it is not taken for a tap that did not go through.
    setNightState({ invisible: false, armed: view.me?.was ?? null, seq });
    setStack([]);
    setScreen('home');
  };

  // The wristband guide's practice (spec section 1): what it opened on is put back on every way out, then practice ends.
  const practiceFrom = useRef(null);
  const startPractice = () => {
    practiceFrom.current = { armed: view.me?.armed ?? null, invisible: !!view.me?.invisible };
    net.current?.say('practice', { t: 'practice', on: true });
    setSheet(null);
    setStack([]);
    setScreen('guide');
  };
  const endPractice = () => {
    const was = practiceFrom.current;
    const steps = restoreTaps(was, view.me, view.cards);
    // A tap that shows the person needs the relay now: offline, the practice stays on (and says so) rather than end
    // with the practice's own card waiting to show them.
    if (steps.some(([kind, v]) => (kind === 'arm' ? !!v : v === false)) && cannotShow()) return;
    practiceFrom.current = null;
    for (const [kind, v] of steps) {
      if (kind === 'arm') arm(v);
      else setNightState({ invisible: v, armed: null, seq: tap('invisible', v) });
    }
    // The card it opened on was closed by the venue meanwhile: said here, as the practice kept it quiet (follow()).
    if (was?.armed && Array.isArray(view.cards) && !view.cards.includes(was.armed)) say(FOLLOW_SAY.closed(was.armed));
    net.current?.forget('practice');
    net.current?.send({ t: 'practice', on: false });
    update((prev) => ({ ...prev, guideSeen: true }));
    setStack([]);
    setScreen(was?.invisible ? 'quiet' : 'home');
  };
  const endPracticeRef = useRef(endPractice);
  endPracticeRef.current = endPractice;
  // While on the guide, practice is said again each minute, so it never lapses mid-step.
  useEffect(() => {
    if (screen !== 'guide') return undefined;
    const iv = setInterval(() => net.current?.send({ t: 'practice', on: true }), 60_000);
    return () => clearInterval(iv);
  }, [screen]);

  const savePick = () => {
    const t = pickText.trim();
    if (!t) return;
    if (t !== pick) {
      net.current?.say('pick', { t: 'pick', track: t });
      setNightState({ pick: t });
      update((prev) => store.addEvent(prev, 'pick', 'picked ' + t));
    }
    // Picked for a match (PICK ONE): back to that match, its card left as it was (F1).
    if (pickFor) { setMatchId(pickFor); setPickFor(null); go('match', { replace: true }); return; }
    go('wall');
  };

  const block = (handle, done = 'blocked. they can’t see you for the rest of tonight.') => {
    net.current?.send({ t: 'block', handle });
    setSheet(null);
    say(done);
  };
  // "Not this one" is a block, and a block cannot be taken back tonight: one tap on a match screen is too easy to make by
  // mistake, so it asks first. They are not told either way.
  const notThis = (m) => setSheet({
    title: 'Block them for tonight?', sub: 'you won’t see each other again tonight. they aren’t told.', close: 'Cancel',
    rows: [{ icon: 'block', label: 'Block for tonight', fg: 'var(--stop)', onTap: () => {
      block(m.id, 'okay. you won’t see each other again tonight.'); setStack([]); setScreen('home');
    } }],
  });
  // A few words first, which the venue team sees with the report; none is fine. Where the venue has no team, it says so.
  const team = teamHere(view);
  const report = (handle) => setSheet(team ? {
    title: handle ? 'Report' : 'Report something else', sub: REPORT.goes, close: 'Cancel',
    body: <ReportForm onSend={(why) => {
      net.current?.send({ t: 'report', handle: handle || null, why });
      setSheet(null);
      say(REPORT.sent);
    }} />,
  } : { title: REPORT.noTeam, sub: REPORT.noTeamSub, close: 'OK', rows: [] });

  const personSheet = (handle, title) => setSheet({
    title, sub: 'they are never told either way.', close: 'Cancel',
    rows: [
      { icon: 'block', label: 'Block', sub: 'instant, silent, and permanent for tonight.', fg: 'var(--stop)', onTap: () => block(handle) },
      { icon: 'flag', label: 'Report', sub: team ? REPORT.goes : REPORT.noTeamSub, fg: 'var(--stop)', onTap: () => report(handle) },
    ],
  });

  // A made room's card: fill what is empty, or say a field is wrong (venue cards spec §2.3).
  const wrongSheet = () => setSheet({
    title: WHERE.wrongHere, sub: 'which part? if someone else here says so too, it clears.', close: 'Cancel',
    rows: ['venue', 'act', ...TIMES].filter((k) => show?.[k]).map((k) => ({
      icon: 'flag', label: k === 'venue' ? 'the venue: ' + show.venue : k === 'act' ? 'the act: ' + show.act : TIME_NAMES[k] + ' ' + show[k],
      fg: 'var(--stop)', onTap: () => { net.current?.send({ t: 'wrong', field: k }); setSheet(null); say(WHERE.wrongSaid); },
    })),
  });
  const cardSheet = () => setSheet({
    title: show?.venue || 'This venue', sub: 'made by people here tonight. the first to say each thing has it.', close: 'Cancel',
    body: ['act', ...TIMES].some((k) => !show?.[k])
      ? <CardForm show={show} onSave={(fields) => { net.current?.send({ t: 'fill', ...fields }); setSheet(null); }} />
      : null,
    rows: [{ icon: 'flag', label: WHERE.wrongHere, sub: 'two people saying so clears it.', fg: 'var(--stop)', onTap: wrongSheet }],
  });

  // Wrong room: on joining and each time the app comes back, with location granted and the room's place known,
  // more than 500 m away asks once; I'M HERE stops it for this room tonight (spec §2.4).
  const [away, setAway] = useState(null);
  const hereOk = night?.state?.hereOk;
  const checkHere = useCallback(async () => {
    if (!inRoom || !show || hereOk === show.room || !(await locationGranted())) { setAway(null); return; }
    const p = await locate();
    if (p) setHere({ ...p, at: Date.now() });
    setAway(p ? wrongRoom(p, show) : null);
  }, [inRoom, show, hereOk]);
  const checkRef = useRef(checkHere);
  checkRef.current = checkHere;
  useEffect(() => { checkRef.current(); }, [inRoom, show?.room, show?.lat, hereOk]);
  useEffect(() => {
    const on = () => { if (document.visibilityState === 'visible') checkRef.current(); };
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);

  const howSheet = () => setSheet({
    title: 'How this works', sub: 'four promises. they hold all night.', close: 'Got it',
    rows: [
      ...PROMISES.map((p) => ({ icon: p.icon, label: p.main, sub: p.sub, fg: '#fff', onTap: () => {} })),
      { icon: 'queue_music', label: HOW.cards, fg: '#fff', onTap: () => {} },
      { icon: 'favorite', label: HOW.both, fg: '#fff', onTap: () => {} },
      { icon: 'watch', label: 'Hold the face button on your wristband to go invisible. Hold its side button to come back.', fg: '#fff', onTap: () => {} },
      { icon: 'touch_app', label: 'Press the side button to see your card, and again to change it. Your phone follows.', fg: '#fff', onTap: () => {} },
      { icon: 'waving_hand', label: WAVES_HOW, fg: '#fff', onTap: () => {} },
      { icon: 'watch', label: BAND_OFF.how, fg: '#fff', onTap: () => {} },
      { icon: 'graphic_eq', label: BEAT_HOW, fg: '#fff', onTap: () => {} },
      { icon: 'touch_app', label: GUIDE.page.how, fg: '#fff', onTap: () => { setSheet(null); go('band-guide'); } },
    ],
  });

  const unpair = () => {
    net.current?.send({ t: 'unpair' });
    net.current?.forget('pair');
    setNightState({ wristband: null, bandSecret: null });
    setSheet(null);
    say('unpaired. your phone is your light again.');
  };

  // The wristband's sound: the person's own, kept across nights; the relay carries it to their band.
  const flipSound = () => {
    const on = !s.bandSound;
    update((prev) => ({ ...prev, bandSound: on }));
    net.current?.say('sound', { t: 'sound', on });
    setSheet(null);
    say(on ? SOUND_SAY.on : SOUND_SAY.off);
  };

  // Its beat, the same way: whether a lit card pulses on the beat, and so whether the band may listen.
  const flipBeat = () => {
    const on = !s.bandBeat;
    update((prev) => ({ ...prev, bandBeat: on }));
    net.current?.say('beat', { t: 'beat', on });
    setSheet(null);
    say(on ? BEAT_SAY.on : BEAT_SAY.off);
  };

  const bandSheet = () => setSheet({
    title: 'Your wristband', sub: bandLine(bandShown), close: 'Done',
    rows: [
      { icon: 'watch', label: GUIDE.page.open, sub: GUIDE.page.sub, fg: '#fff', onTap: () => { setSheet(null); go('band-guide'); } },
      ...(bandShown?.offline ? [{ icon: 'link', label: 'PAIR AGAIN', sub: 'it has been away a while. show its letters and pair it again.', fg: '#fff',
        onTap: () => { unpair(); go('pair'); } }] : []),
      ...(bandShown?.off ? [] : [{ icon: 'flashlight_on', label: 'TEST THE LIGHT', sub: 'it flashes white for two seconds, and chirps unless its sound is off or it is in NOT NOW.', fg: '#fff',
        onTap: () => { net.current?.send({ t: 'testLight' }); setSheet(null); say('watch your wrist.'); } }]),
      { ...soundRow(s.bandSound), fg: '#fff', onTap: flipSound },
      { ...beatRow(s.bandBeat), fg: '#fff', onTap: flipBeat },
      { icon: 'link_off', label: 'UNPAIR', sub: 'it forgets you, and shows new letters.', fg: 'var(--stop)', onTap: unpair },
    ],
  });

  // A kept person as a card for the phone's own contacts, made here and sent nowhere.
  const saveContact = (k) => saveCard(k).then((how) => {
    if (how === 'saved') say('saved as a contact card. open it to add them.');
  }).catch(() => say("couldn't make the card. their contact is still here."));
  const tonightCard = (m) => ({ name: m.name, contact: m.contact, venue: show?.venue || '', night: store.tonightKey() });

  const keep = (m, on) => {
    if (on && !s.contact) {
      setSheet({
        title: 'How should they reach you?', sub: 'only shared if you both keep. nothing is sent otherwise.', close: 'Not now',
        body: <ContactForm onSave={(contact) => {
          update((prev) => ({ ...prev, contact }));
          net.current?.say('profile', { t: 'profile', name: s.name, contact });
          net.current?.send({ t: 'keep', match: m.id, on: true });
          setSheet(null);
          // Not "if they keep it too": they may have kept it first, and then both already see it.
          say('kept on your side.');
        }} />,
      });
      return;
    }
    net.current?.send({ t: 'keep', match: m.id, on });
  };

  // WE FOUND EACH OTHER: the same as the side hold on the wrist, counted once both say it. Queued offline.
  const sayFound = (m) => {
    net.current?.send({ t: 'found', match: m.id });
    if (status !== 'live') say("Saved. It'll sync when you're out.");
  };

  const sendClip = async (blob, type) => {
    const photo = type === 'image/jpeg';
    if (blob.size > (photo ? PHOTO_MAX : 1_150_000)) { say(photo ? 'that photo is too big to send. try another.' : 'that one is too big to send. try again, a little stiller.'); return; }
    const data = await toBase64(blob);
    net.current?.send({ t: 'clip', mime: type, data, to: backTo || undefined });
    if (backTo) {
      say('sent. only they see it — no names either way.');
      setBackTo(null);
    } else {
      if (!store.hasEvent(s, 'clip')) update((prev) => store.addEvent(prev, 'clip', photo ? 'sent a pose to the floor' : 'sent five seconds to the floor'));
      say('sent. it stays on the floor for an hour.');
    }
    go('floor', { replace: true });
  };

  const keepClip = (blob, type) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'on-the-beat-' + Date.now() + (type === 'image/jpeg' ? '.jpg' : type.includes('mp4') ? '.mp4' : '.webm');
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    say('kept on this phone. nobody else sees it.');
    go('home', { replace: true });
  };

  const tileSheet = (c) => setSheet({
    title: c.toYou ? someone(c.band) + ' danced back to you' : someone(c.band),
    sub: 'dance back and they see yours. no names either way.', close: 'Cancel',
    rows: [
      { icon: 'sensors', label: 'DANCE BACK', sub: 'five seconds or a pose, straight back to them.', fg: 'var(--dance)',
        onTap: () => { setBackTo(c.handle); setSheet(null); go('camera'); } },
      { icon: 'block', label: 'Block', sub: 'instant, silent, permanent for tonight.', fg: 'var(--stop)', onTap: () => block(c.handle, 'blocked.') },
    ],
  });

  // "I've left" is carried until the relay answers (§2): the room line stays open, and the leave is re-said.
  const leftVenue = () => {
    const key = store.tonightKey();
    update((prev) => (prev.nights[key] ? { ...prev, nights: { ...prev.nights, [key]: { ...prev.nights[key], leaving: true } } } : prev));
    net.current?.say('leave', { t: 'leave' });
    setStack([]);
    setSheet(null);
    setScreen('leaving');
  };

  const leaveSheet = () => setSheet({
    title: LEAVE.title, sub: LEAVE.sub, close: 'Cancel',
    rows: [{ icon: 'logout', label: LEAVE.row, fg: 'var(--stop)', onTap: leftVenue }],
  });

  const quietBlock = () => setSheet({
    title: 'Block someone', close: 'Cancel',
    sub: view.matches.length ? 'instant, silent, and permanent for tonight.' : 'nobody you’ve met tonight. you can block anyone from their card, any time.',
    rows: view.matches.map((m) => ({ icon: 'block', label: matchName(m), fg: 'var(--stop)', onTap: () => block(m.id) })),
  });

  const quietReport = () => (!team ? report(null) : setSheet({
    title: 'Report something', sub: REPORT.goes, close: 'Cancel',
    rows: [
      ...reportable(view, night?.matches).map((m) => ({ icon: 'flag', label: matchName(m), fg: 'var(--stop)', onTap: () => report(m.id) })),
      { icon: 'report', label: 'Something else', sub: 'not about anyone here — something the team should know.', fg: 'var(--stop)', onTap: () => report(null) },
    ],
  }));

  // Ask once a night, when the battery that matters is low: once paired, the wristband's, wherever the phone is (a card can be armed from the wrist); otherwise the phone's, on the beacon.
  useEffect(() => {
    if (night?.state?.batteryAsked) return;
    if (paired) {
      // Paired, the battery that matters is the one on the wrist.
      const level = view.me?.wristband?.battery;
      if (level === null || level === undefined || level > 15) return;
      setNightState({ batteryAsked: true });
      setSheet({
        title: 'Your wristband is at ' + level + '%.', sub: 'It will dim itself to make the rest last.', close: 'Keep going',
        rows: [
          { icon: 'brightness_low', label: 'DIM IT', sub: 'half brightness — still readable across a dark room.', fg: '#fff',
            onTap: () => { setSheet(null); say('dimmed. still bright enough to read across the room.'); } },
          { icon: 'smartphone', label: 'USE MY PHONE INSTEAD', sub: 'the phone is the light for the rest of the night.', fg: '#fff', onTap: unpair },
        ],
      });
      return;
    }
    if (screen !== 'beacon') return;
    battery().then((b) => {
      if (!b || b.charging || b.level > 0.15) return;
      setNightState({ batteryAsked: true });
      setSheet({
        title: 'The beacon uses the screen. ' + Math.round(b.level * 100) + '% left.',
        sub: 'you can keep it bright — it just costs you.', close: 'Keep it bright',
        rows: [{ icon: 'brightness_low', label: 'DIM IT', sub: 'still readable across a dark room, about half the drain.', fg: '#fff',
          onTap: () => { setDim(true); setSheet(null); say('dimmed. still bright enough to read across the room.'); } }],
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, night?.state?.batteryAsked, paired, view.me?.wristband?.battery]);

  // ---------- onboarding ----------

  const afterSplash = useCallback(() => {
    if (!s.promisesSeen) setScreen('promises');
    else if (!night?.show || night.left) setScreen('venue');
    else if (night.leaving) setScreen('leaving');
    else if (!s.name) setScreen('name');
    else setScreen(night.state?.invisible ? 'quiet' : 'home');
  }, [s.promisesSeen, s.name, night]);

  const chooseShow = (chosen) => {
    update((prev) => store.startNight(prev, chosenRow(chosen)));
    setStack([]);
    setScreen(s.name ? 'home' : 'name');
  };
  // NOT HERE? ADD IT: the room is joined at once, as a typed one, and its card goes as the first fill once the room
  // has answered (below). The phone's place goes with it only rounded, only if it was found lately, and the card waits
  // in memory, never in the night's record (spec §2.5).
  const making = useRef(null);
  const makeVenue = (name, act) => {
    const venue = name.trim();
    const who = act.trim();
    const key = roomOf(venue);
    chooseShow({ id: null, room: key, venue, act: who, setlist: [], typed: true });
    making.current = { room: key, fields: { venue, ...(who ? { act: who } : {}), ...(placeNow ? roundPlace(placeNow) : {}) } };
  };
  // The first view from that room (not one still on the screen from the room before): the card goes unless someone
  // there made one first, and is never sent twice.
  useEffect(() => {
    const m = making.current;
    if (!view.me || !m || viewRoom.current !== m.room) return;
    if (!view.card) net.current?.send({ t: 'fill', ...m.fields });
    making.current = null;
  }, [view.me, view.card]);

  // ---------- drawing ----------

  const match = useMemo(() => shownMatch(view, night?.matches, matchId), [view, matchId, night]);
  // A PICK ONE is for its match only while the pick screen is up.
  useEffect(() => { if (screen !== 'pick' && pickFor) setPickFor(null); }, [screen, pickFor]);
  // A meeting answered elsewhere moves its screen on: found from the wrist to S11, ended (a block) home, quietly.
  useEffect(() => {
    const next = matchScreen(screen, match);
    if (next !== screen) setScreen(next);
  }, [screen, match]);

  const barHue = invisible ? null : armed;
  const barFor = {
    home: { label: armed ? 'OPEN ' + HUE[armed].label : 'TAP A CARD TO ARM', off: !armed, tap: () => armed && go(cardOf(armed).open), dot: waveDot && armed === 'hi' },
    beacon: { label: "WHO'S NEAR", tap: () => go('near'), dot: waveDot },
    near: { label: 'POCKET IT', tap: () => go('home') },
    pick: { label: "THAT'S MY PICK", off: !pickText.trim(), tap: savePick },
    wall: { label: 'POCKET IT', tap: () => go('home') },
    camera: { label: 'THE FLOOR', tap: () => go('floor') },
    floor: { label: 'POCKET IT', tap: () => go('home') },
    quiz: view.quiz?.done ? { label: 'FIND A TEAMMATE', tap: () => go('teams') } : undefined,
    teams: { label: 'POCKET IT', tap: () => go('home') },
  }[screen];

  // The check, while there is one, over any screen: it asks about the number on the wrist.
  const checkSheet = check ? {
    title: PAIR_SAY.check(check), sub: PAIR_SAY.checkSub, close: 'NO',
    rows: [
      { icon: 'check_circle', label: 'YES', sub: 'my wristband shows ' + check + '.', fg: 'var(--ok)', onTap: () => answerCheck(true) },
      { icon: 'cancel', label: 'NO', sub: 'it shows something else, or nothing.', fg: 'var(--stop)', onTap: () => answerCheck(false) },
    ],
  } : null;

  // A meeting just finished: its own screens (the number, the person) give way to home.
  useEffect(() => {
    const id = finishedNow.current;
    if (!id || !match || match.id !== id || (screen !== 'match' && screen !== 'mate')) return;
    finishedNow.current = null;
    setStack([]);
    setScreen('home');
  }, [view.matches, match, screen]);   // eslint-disable-line react-hooks/exhaustive-deps

  // LET'S FINISH: an ask from the other side takes the screen until it is answered.
  const finishAsk = (view.matches || []).find((m) => m.finishAsked === 'them' && !m.finishedAt);
  const sayFinish = (m, word) => net.current?.send({ t: 'finish', match: m.id, say: word });

  let body = null;
  switch (screen) {
    case 'splash': body = <Splash onNext={afterSplash} />; break;
    case 'promises': body = <Promises onIn={() => { update((p) => ({ ...p, promisesSeen: true })); setScreen('venue'); }} onHow={howSheet} />; break;
    case 'venue':
      body = <Venue shows={shows || []} loading={shows === null} chosen={night && !night.left && !nearbyAsked ? show : null} onChoose={chooseShow}
        onBack={night?.show && !night.left && s.name ? () => setScreen('home') : null}
        onNotAtShow={() => say('no problem. the app sits quiet until you are at one.')}
        here={placeNow} finding={finding} onFind={find} onMake={makeVenue} />;
      break;
    case 'name':
      body = <Name name={s.name} onBack={s.name ? back : () => setScreen('venue')}
        onDone={(name) => { update((p) => ({ ...p, name })); setStack([]); setScreen(!s.name && !paired ? 'pair' : 'home'); }} />;
      break;
    case 'pair': {
      const dropLink = () => { try { sessionStorage.removeItem('otb:pair-link'); } catch { /* private window */ } };
      body = <Pair error={pairError} initial={pairCode} pending={pairPending}
        onCode={(code) => { dropLink(); pairWith(code); }} onScan={() => go('scan')}
        onSkip={() => { dropLink(); setStack([]); setScreen('home'); }} onBack={stack.length ? back : null} onGuide={() => go('band-guide')} />;
      break;
    }
    case 'scan':
      body = <Scan onCode={(code) => { back(); pairWith(code); }} onType={back} onBack={back} />;
      break;
    case 'home':
      body = <Home show={show} phase={phase} line={line} armed={invisible ? null : armed} open={view.cards} ci={ci} setCi={setCi}
        notice={notice} onHideNotice={() => setNightState({ noticeHidden: notice.at })}
        band={bandShown} onBand={() => (paired ? bandSheet() : go('pair'))}
        onArm={(id) => (id === 'finish' ? go('finish') : arm(armed === id ? null : id))} onOpen={(id) => go(cardOf(id).open)} onHow={howSheet} dot={waveDot ? 'hi' : null}
        focus={focusCard} onFocused={() => setFocusCard(null)}
        away={away} onNearby={() => { setNearbyAsked(true); go('venue'); }} onHere={() => { setNightState({ hereOk: show.room }); setAway(null); }} onCard={cardSheet} />;
      break;
    case 'beacon':
      body = paired
        ? <WristBeacon count={view.near.length} onStop={() => { arm(null); setStack([]); setScreen('home'); }} />
        : <Beacon count={view.near.length} dim={dim} onStop={() => { arm(null); setStack([]); setScreen('home'); }} />;
      break;
    case 'near':
      body = <Near near={steady(nearOrder.current, view.near)} offline={status === 'offline'} onBack={back}
        onWave={(handle) => net.current?.send({ t: 'wave', handle })} onMore={personSheet} />;
      break;
    case 'pick': body = <Pick show={show} text={pickText} setText={setPickText} onBack={back} />; break;
    case 'wall':
      body = <Wall wall={view.wall} pick={pick} opener={opener} onBack={back} onChange={() => { setPickText(pick); go('pick'); }}
        onLike={(handle, on) => net.current?.send({ t: on ? 'like' : 'unlike', handle })} onMore={personSheet} />;
      break;
    case 'match':
      body = match ? (
        <Match match={match} number={match.number} held={!paired} onPick={() => { setPickFor(match.id); go('pick', { keepCard: true }); }}
          onMyWay={() => { say('on your way. ' + matchName(match) + ' has the same hint.'); go('mate', { replace: true }); }}
          onNotThis={() => notThis(match)} />
      ) : null;
      break;
    case 'camera':
      body = <Camera act={show?.act ? show.act.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : 'Tonight'} onAir={phase === 'SUPPORT' || phase === 'HEADLINE'}
        backTo={backTo} onBack={back} onSend={sendClip} onKeep={keepClip}
        onNotThis={() => { setBackTo(null); go('floor', { replace: true }); }} />;
      break;
    case 'floor': body = <Floor floor={view.floor} mine={view.me?.clip} mineKind={view.me?.clipKind} room={room} onBack={back} onTile={tileSheet} />; break;
    case 'quiz':
      body = <Quiz quiz={view.quiz} offline={status === 'offline'} onBack={back}
        onAnswer={(q, choice) => net.current?.send({ t: 'answer', q, choice })} onTeams={() => go('teams')} />;
      break;
    case 'teams':
      body = <Teams teams={view.teams || []} score={view.quiz?.score} onBack={back}
        onTeam={(handle) => net.current?.send({ t: 'team', handle })} onMore={personSheet} />;
      break;
    case 'mate':
      body = match ? (
        <Mate match={match} number={meetingOn(match, now.getTime()) ? match.number : null} held={!paired}
          onBack={back} onFound={() => sayFound(match)} onKeep={(on) => keep(match, on)} onTonight={() => go('tonight')}
          onSave={() => saveContact(tonightCard(match))}
          onMore={() => personSheet(match.id, matchName(match))} />
      ) : null;
      break;
    case 'tonight':
      body = <Tonight show={show} phase={phase} night={night} live={view.matches} kept={s.kept} name={s.name}
        onBack={back} onKeep={keep} onOpen={(m) => { setMatchId(m.id); go('mate'); }} onName={() => go('name')}
        onSave={(m) => saveContact(m.night ? m : tonightCard(m))} />;
      break;
    case 'guide': body = <Practice view={view} onEnd={endPractice} onTest={() => net.current?.send({ t: 'testLight' })} />; break;
    case 'band-guide': body = <BandGuide onBack={back} onPractise={bandId ? startPractice : null} />; break;
    case 'quiet':
      body = <Quiet paired={paired} onBackOn={backOn} onBlock={quietBlock} onReport={quietReport} onLeft={leaveSheet} />;
      break;
    case 'leaving': body = <Leaving offline={status !== 'live'} />; break;
    case 'finish': body = <Finish matches={view.matches} onBack={back} onAsk={(m) => sayFinish(m, 'ask')} />; break;
    default: body = null;
  }
  if (!body) body = <div className="scr"><Cta plain onClick={() => setScreen('home')}>BACK TO TONIGHT</Cta></div>;
  if (finishAsk && !['splash', 'promises', 'venue', 'name', 'pair', 'scan', 'leaving', 'guide'].includes(screen)) {
    body = <Thanks match={finishAsk} onYes={() => { sayFinish(finishAsk, 'yes'); say(FINISH.done); }} onNo={() => sayFinish(finishAsk, 'no')} />;
  }

  return (
    <div className={'app' + (invisible ? ' quiet' : '')}>
      <div ref={stageRef} className="stage">
        {body}
        {barFor && !invisible ? (
          <Bar label={barFor.label} hue={barFor.off ? null : barHue} off={barFor.off} dot={!!barFor.dot} onTap={barFor.tap}
            onTonight={() => go('tonight')} onNotNow={notNow} />
        ) : <div className="tail" />}
      </div>
      {checkSheet || sheet ? <Sheet sheet={checkSheet || sheet} onClose={checkSheet ? () => answerCheck(false) : closeSheet} screenRef={stageRef} /> : null}
      {toast ? (
        <div className="toast" role="status" aria-live="polite">
          {toast.text}
          {toast.action ? <button type="button" className="act" style={toast.action.fg ? { color: toast.action.fg } : undefined} onClick={() => { setToast(null); toast.action.onTap(); }}>{toast.action.label}</button> : null}
        </div>
      ) : null}
    </div>
  );
}
