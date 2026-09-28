import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HUE, PROMISES, matchName, someone } from './copy.js';
import { SOUND_SAY, soundRow } from './lib/bandsound.js';
import { battery, buzz, toBase64 } from './lib/device.js';
import { INTENT_OF, follow, nextSeq, tapMessage } from './lib/follow.js';
import { meetingOn, newlyFound } from './lib/found.js';
import { connect } from './lib/net.js';
import { phaseLine, phaseOf } from './lib/phase.js';
import * as store from './lib/store.js';
import { WAVES_HOW, buzzes, newWaves } from './lib/waved.js';
import { Bar, Home } from './screens/Home.jsx';
import { Beacon, Near, WristBeacon } from './screens/Hi.jsx';
import { Pair, bandLine } from './screens/Band.jsx';
import { Scan } from './screens/Scan.jsx';
import { PAIR_SAY, codeFrom } from './lib/pairing.js';
import { Name, Promises, Splash, Venue } from './screens/Onboard.jsx';
import { Pick, Wall } from './screens/Song.jsx';
import { Camera, Floor } from './screens/Dance.jsx';
import { Leaving, Match, Mate, Quiet, Tonight } from './screens/Met.jsx';
import { Cta, Sheet } from './ui.jsx';

const ONBOARDING = new Set(['splash', 'promises', 'venue', 'name']);
const EMPTY = { me: null, near: [], wall: [], floor: [], matches: [] };

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
  const show = night?.show || null;

  const [screen, setScreen] = useState('splash');
  const [stack, setStack] = useState([]);
  const [shows, setShows] = useState(null);
  const [view, setView] = useState(EMPTY);
  const [status, setStatus] = useState('connecting');
  const [sheet, setSheet] = useState(null);
  const [toast, setToast] = useState(null);
  const [now, setNow] = useState(() => new Date());
  const [ci, setCi] = useState(0);
  const [pickText, setPickText] = useState(night?.state?.pick || '');
  const [matchId, setMatchId] = useState(null);
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
  const bandShown = band ? { ...band, offline: !band.live && bandAwaySince !== null && now - bandAwaySince >= 120_000 } : null;

  const say = useCallback((text, action = null) => {
    clearTimeout(toastTimer.current);
    setToast({ text, action });
    toastTimer.current = setTimeout(() => setToast(null), action ? 5000 : 2600);
  }, []);
  const closeSheet = useCallback(() => setSheet(null), []);

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

  useEffect(() => {
    let off = false;
    fetch('/api/shows').then((r) => r.json()).then((list) => {
      if (!off) setShows(list.map((x) => ({ ...x, room: x.id })));
    }).catch(() => { if (!off) setShows([]); });
    return () => { off = true; };
  }, []);

  // ---------- the room ----------

  const room = show?.room;
  const inRoom = !!(room && night?.me && s.name && s.promisesSeen && !night.left);

  useEffect(() => {
    if (!inRoom) return undefined;
    const n = connect({
      venue: room, me: night.me,
      onView: (v) => setView(v),
      onStatus: setStatus,
      onMessage: (m) => onRelay.current?.(m),
    });
    net.current = n;
    // A page load says nothing new (§3): what this phone holds is kept, and re-said only as again copies.
    const st = night.state || {};
    const seq = st.seq ?? 0;
    n.keep('sound', { t: 'sound', on: s.bandSound });
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
    if (m.t === 'error' && m.why === 'clip refused') say("that didn't go. they may have left, or gone quiet.");
    if (m.t === 'refused' && m.why === 'changed') refused.current = m.seq;
    if (m.t === 'left') {
      net.current?.forget('leave');
      const key = store.tonightKey();
      update((prev) => (prev.nights[key] ? { ...prev, nights: { ...prev.nights, [key]: { ...prev.nights[key], left: true, leaving: false, state: {} } } } : prev));
      setStack([]);
      setScreen('venue');
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
      if (screen === 'pair') { setStack([]); setScreen('home'); }
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
  useEffect(() => { seen.current = null; }, [night?.me]);

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
    if (buzzes(fresh, view)) buzz([90]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);
  useEffect(() => { wavesSeen.current = null; }, [night?.me]);

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
    if (f.clearStack) { setStack([]); setSheet(null); }
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

  const go = useCallback((to, { replace = false } = {}) => {
    const intent = INTENT_OF[to];
    // Nothing moves when the card could not be armed.
    if (intent && armed !== intent && !arm(intent)) return;
    setSheet(null);
    if (!replace) setStack((st) => (to === screen ? st : [...st, screen].slice(-12)));
    if (to !== 'camera') setBackTo(null);
    setScreen(to);
  }, [screen, armed, arm]);

  // Back walks the stack, never into onboarding or a match already answered —
  // and while invisible, nowhere at all.
  const now_ = useRef({ stack, invisible: false });
  now_.current = { stack, invisible };
  const back = useCallback(() => {
    setSheet(null);
    setBackTo(null);
    const { stack: st, invisible: quiet } = now_.current;
    if (quiet) { setStack([]); setScreen('quiet'); return; }
    const prev = st[st.length - 1];
    setStack(st.slice(0, -1));
    setScreen(prev && !ONBOARDING.has(prev) && prev !== 'match' ? prev : 'home');
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
    setNightState({ invisible: false, seq });
    setStack([]);
    setScreen('home');
  };

  const savePick = () => {
    const t = pickText.trim();
    if (!t) return;
    if (t !== pick) {
      net.current?.say('pick', { t: 'pick', track: t });
      setNightState({ pick: t });
      update((prev) => store.addEvent(prev, 'pick', 'picked ' + t));
    }
    go('wall');
  };

  const block = (handle, done = 'blocked. they can’t see you for the rest of tonight.') => {
    net.current?.send({ t: 'block', handle });
    setSheet(null);
    say(done);
  };
  // A few words first, which the venue team sees with the report; none is fine.
  const report = (handle) => setSheet({
    title: handle ? 'Report' : 'Report something else', sub: 'goes to the venue team, with the time and the room.', close: 'Cancel',
    body: <ReportForm onSend={(why) => {
      net.current?.send({ t: 'report', handle: handle || null, why });
      setSheet(null);
      say('reported. the venue team has it.');
    }} />,
  });

  const personSheet = (handle, title) => setSheet({
    title, sub: 'they are never told either way.', close: 'Cancel',
    rows: [
      { icon: 'block', label: 'Block', sub: 'instant, silent, and permanent for tonight.', fg: 'var(--stop)', onTap: () => block(handle) },
      { icon: 'flag', label: 'Report', sub: 'goes to the venue team, with the time and the room.', fg: 'var(--stop)', onTap: () => report(handle) },
    ],
  });

  const howSheet = () => setSheet({
    title: 'How this works', sub: 'four promises. they hold all night.', close: 'Got it',
    rows: [
      ...PROMISES.map((p) => ({ icon: p.icon, label: p.main, sub: p.sub, fg: '#fff', onTap: () => {} })),
      { icon: 'watch', label: 'Hold the face button on your wristband to go invisible. Hold its side button to come back.', fg: '#fff', onTap: () => {} },
      { icon: 'touch_app', label: 'Press the side button to see your card, and again to change it. Your phone follows.', fg: '#fff', onTap: () => {} },
      { icon: 'waving_hand', label: WAVES_HOW, fg: '#fff', onTap: () => {} },
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

  const bandSheet = () => setSheet({
    title: 'Your wristband', sub: bandLine(bandShown), close: 'Done',
    rows: [
      ...(bandShown?.offline ? [{ icon: 'link', label: 'PAIR AGAIN', sub: 'it has been away a while. show its letters and pair it again.', fg: '#fff',
        onTap: () => { unpair(); go('pair'); } }] : []),
      { icon: 'flashlight_on', label: 'TEST THE LIGHT', sub: 'it flashes white for two seconds, and chirps unless its sound is off or it is in NOT NOW.', fg: '#fff',
        onTap: () => { net.current?.send({ t: 'testLight' }); setSheet(null); say('watch your wrist.'); } },
      { ...soundRow(s.bandSound), fg: '#fff', onTap: flipSound },
      { icon: 'link_off', label: 'UNPAIR', sub: 'it forgets you, and shows new letters.', fg: 'var(--stop)', onTap: unpair },
    ],
  });

  const keep = (m, on) => {
    if (on && !s.contact) {
      setSheet({
        title: 'How should they reach you?', sub: 'only shared if you both keep. nothing is sent otherwise.', close: 'Not now',
        body: <ContactForm onSave={(contact) => {
          update((prev) => ({ ...prev, contact }));
          net.current?.say('profile', { t: 'profile', name: s.name, contact });
          net.current?.send({ t: 'keep', match: m.id, on: true });
          setSheet(null);
          say('kept on your side. if they keep it too, you’ll both see.');
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
    if (blob.size > 1_150_000) { say('that one is too big to send. try again, a little stiller.'); return; }
    const data = await toBase64(blob);
    net.current?.send({ t: 'clip', mime: type, data, to: backTo || undefined });
    if (backTo) {
      say('sent. only they see it — no names either way.');
      setBackTo(null);
    } else {
      if (!store.hasEvent(s, 'clip')) update((prev) => store.addEvent(prev, 'clip', 'sent five seconds to the floor'));
      say('sent. it loops on the floor for an hour.');
    }
    go('floor', { replace: true });
  };

  const keepClip = (blob, type) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'on-the-beat-' + Date.now() + (type.includes('mp4') ? '.mp4' : '.webm');
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
      { icon: 'sensors', label: 'DANCE BACK', sub: 'five seconds, straight back to them.', fg: 'var(--dance)',
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

  const quietBlock = () => setSheet({
    title: 'Block someone', close: 'Cancel',
    sub: view.matches.length ? 'instant, silent, and permanent for tonight.' : 'nobody you’ve met tonight. you can block anyone from their card, any time.',
    rows: view.matches.map((m) => ({ icon: 'block', label: matchName(m), fg: 'var(--stop)', onTap: () => block(m.id) })),
  });

  const quietReport = () => setSheet({
    title: 'Report something', sub: 'goes to the venue team, with the time and the room.', close: 'Cancel',
    rows: [
      ...view.matches.map((m) => ({ icon: 'flag', label: matchName(m), fg: 'var(--stop)', onTap: () => report(m.id) })),
      { icon: 'report', label: 'Something else', sub: 'not about anyone here — something the team should know.', fg: 'var(--stop)', onTap: () => report(null) },
    ],
  });

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
    update((prev) => store.startNight(prev, chosen));
    setStack([]);
    setScreen(s.name ? 'home' : 'name');
  };

  // ---------- drawing ----------

  const match = useMemo(() => {
    const live = view.matches.find((m) => m.id === matchId);
    return live || night?.matches?.[matchId] || null;
  }, [view.matches, matchId, night]);

  const barHue = invisible ? null : armed;
  const barFor = {
    home: { label: armed ? 'OPEN ' + HUE[armed].label : 'TAP A CARD TO ARM', off: !armed, tap: () => armed && go(({ hi: 'beacon', song: 'pick', dance: 'camera' })[armed]) },
    beacon: { label: "WHO'S NEAR", tap: () => go('near') },
    near: { label: 'POCKET IT', tap: () => go('home') },
    pick: { label: "THAT'S MY PICK", off: !pickText.trim(), tap: savePick },
    wall: { label: 'POCKET IT', tap: () => go('home') },
    camera: { label: 'THE FLOOR', tap: () => go('floor') },
    floor: { label: 'POCKET IT', tap: () => go('home') },
  }[screen];

  // The check, while there is one, over any screen: it asks about the number on the wrist.
  const checkSheet = check ? {
    title: PAIR_SAY.check(check), sub: PAIR_SAY.checkSub, close: 'NO',
    rows: [
      { icon: 'check_circle', label: 'YES', sub: 'my wristband shows ' + check + '.', fg: 'var(--ok)', onTap: () => answerCheck(true) },
      { icon: 'cancel', label: 'NO', sub: 'it shows something else, or nothing.', fg: 'var(--stop)', onTap: () => answerCheck(false) },
    ],
  } : null;

  let body = null;
  switch (screen) {
    case 'splash': body = <Splash onNext={afterSplash} />; break;
    case 'promises': body = <Promises onIn={() => { update((p) => ({ ...p, promisesSeen: true })); setScreen('venue'); }} onHow={howSheet} />; break;
    case 'venue':
      body = <Venue shows={shows || []} loading={shows === null} chosen={night && !night.left ? show : null} onChoose={chooseShow}
        onBack={night?.show && !night.left && s.name ? () => setScreen('home') : null}
        onNotAtShow={() => say('no problem. the app sits quiet until you are at one.')} />;
      break;
    case 'name':
      body = <Name name={s.name} onBack={s.name ? back : () => setScreen('venue')}
        onDone={(name) => { update((p) => ({ ...p, name })); setStack([]); setScreen(!s.name && !paired ? 'pair' : 'home'); }} />;
      break;
    case 'pair': {
      const dropLink = () => { try { sessionStorage.removeItem('otb:pair-link'); } catch { /* private window */ } };
      body = <Pair error={pairError} initial={pairCode} pending={pairPending}
        onCode={(code) => { dropLink(); pairWith(code); }} onScan={() => go('scan')}
        onSkip={() => { dropLink(); setStack([]); setScreen('home'); }} onBack={stack.length ? back : null} />;
      break;
    }
    case 'scan':
      body = <Scan onCode={(code) => { back(); pairWith(code); }} onType={back} onBack={back} />;
      break;
    case 'home':
      body = <Home show={show} phase={phase} line={line} armed={invisible ? null : armed} ci={ci} setCi={setCi}
        band={bandShown} onBand={() => (paired ? bandSheet() : go('pair'))}
        onArm={(id) => arm(armed === id ? null : id)} onOpen={(id) => go(({ hi: 'beacon', song: 'pick', dance: 'camera' })[id])} onHow={howSheet} />;
      break;
    case 'beacon':
      body = paired
        ? <WristBeacon count={view.near.length} onStop={() => { arm(null); setStack([]); setScreen('home'); }} />
        : <Beacon count={view.near.length} dim={dim} onStop={() => { arm(null); setStack([]); setScreen('home'); }} />;
      break;
    case 'near':
      body = <Near near={view.near} offline={status === 'offline'} onBack={back}
        onWave={(handle) => net.current?.send({ t: 'wave', handle })} onMore={personSheet} />;
      break;
    case 'pick': body = <Pick show={show} text={pickText} setText={setPickText} onBack={back} />; break;
    case 'wall':
      body = <Wall wall={view.wall} pick={pick} onBack={back} onChange={() => { setPickText(pick); go('pick'); }}
        onLike={(handle, on) => net.current?.send({ t: on ? 'like' : 'unlike', handle })} onMore={personSheet} />;
      break;
    case 'match':
      body = match ? (
        <Match match={match} number={paired ? match.number : null} onPick={() => go('pick')}
          onMyWay={() => { say('on your way. ' + matchName(match) + ' has the same hint.'); go('mate', { replace: true }); }}
          onNotThis={() => { block(match.id, 'okay. you won’t see each other again tonight.'); setStack([]); setScreen('home'); }} />
      ) : null;
      break;
    case 'camera':
      body = <Camera act={show?.act ? show.act.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : 'Tonight'} onAir={phase === 'SUPPORT' || phase === 'HEADLINE'}
        backTo={backTo} onBack={back} onSend={sendClip} onKeep={keepClip}
        onNotThis={() => { setBackTo(null); go('floor', { replace: true }); }} />;
      break;
    case 'floor': body = <Floor floor={view.floor} mine={view.me?.clip} room={room} onBack={back} onTile={tileSheet} />; break;
    case 'mate':
      body = match ? (
        <Mate match={match} number={paired && meetingOn(match, now.getTime()) ? match.number : null}
          onBack={back} onFound={() => sayFound(match)} onKeep={(on) => keep(match, on)} onTonight={() => go('tonight')}
          onMore={() => personSheet(match.id, matchName(match))} />
      ) : null;
      break;
    case 'tonight':
      body = <Tonight show={show} phase={phase} night={night} live={view.matches} kept={s.kept} name={s.name}
        onBack={back} onKeep={keep} onOpen={(m) => { setMatchId(m.id); go('mate'); }} onName={() => go('name')} />;
      break;
    case 'quiet':
      body = <Quiet paired={paired} onBackOn={backOn} onBlock={quietBlock} onReport={quietReport} onLeft={leftVenue} />;
      break;
    case 'leaving': body = <Leaving offline={status !== 'live'} />; break;
    default: body = null;
  }
  if (!body) body = <div className="scr"><Cta plain onClick={() => setScreen('home')}>BACK TO TONIGHT</Cta></div>;

  return (
    <div className={'app' + (invisible ? ' quiet' : '')}>
      <div ref={stageRef} className="stage">
        {body}
        {barFor && !invisible ? (
          <Bar label={barFor.label} hue={barFor.off ? null : barHue} off={barFor.off} onTap={barFor.tap}
            onTonight={() => go('tonight')} onNotNow={notNow} />
        ) : <div className="tail" />}
      </div>
      {checkSheet || sheet ? <Sheet sheet={checkSheet || sheet} onClose={checkSheet ? () => answerCheck(false) : closeSheet} screenRef={stageRef} /> : null}
      {toast ? (
        <div className="toast" role="status" aria-live="polite">
          {toast.text}
          {toast.action ? <button type="button" className="act" onClick={() => { setToast(null); toast.action.onTap(); }}>{toast.action.label}</button> : null}
        </div>
      ) : null}
    </div>
  );
}
