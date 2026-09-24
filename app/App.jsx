import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HUE, PROMISES, matchName, someone } from './copy.js';
import { battery, buzz, toBase64 } from './lib/device.js';
import { connect } from './lib/net.js';
import { phaseLine, phaseOf } from './lib/phase.js';
import * as store from './lib/store.js';
import { Bar, Home } from './screens/Home.jsx';
import { Beacon, Near, WristBeacon } from './screens/Hi.jsx';
import { Pair, bandLine } from './screens/Band.jsx';
import { Scan } from './screens/Scan.jsx';
import { codeFrom } from './lib/pairing.js';
import { Name, Promises, Splash, Venue } from './screens/Onboard.jsx';
import { Pick, Wall } from './screens/Song.jsx';
import { Camera, Floor } from './screens/Dance.jsx';
import { Match, Mate, Quiet, Tonight } from './screens/Met.jsx';
import { Cta, Sheet } from './ui.jsx';

/** Arriving on one of these arms its card, as the canvas does. */
const INTENT_OF = { beacon: 'hi', near: 'hi', pick: 'song', wall: 'song', camera: 'dance', floor: 'dance' };
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
  const [armed, setArmed] = useState(null);
  const [pickText, setPickText] = useState(night?.state?.pick || '');
  const [matchId, setMatchId] = useState(null);
  const [backTo, setBackTo] = useState(null);
  const [dim, setDim] = useState(false);
  const [pairError, setPairError] = useState(null);
  const [pairCode, setPairCode] = useState(null);
  const [pairPending, setPairPending] = useState(false);
  // A code that arrived in the address, sitting on the pair screen pre-filled
  // and waiting for a tap. A link is a bearer token: it must not pair on its own.
  const [pairConfirm, setPairConfirm] = useState(null);
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
  const pick = night?.state?.pick || '';
  const phase = show ? phaseOf(show, now) : 'DOORS';
  const line = show ? phaseLine(show, now) : '';
  // The wristband, as the relay last said — or, before it has said, as this phone remembers.
  const bandId = night?.state?.wristband || null;
  const band = view.me?.wristband ?? (bandId ? { battery: null, live: false } : null);
  const paired = !!band;

  const say = useCallback((msg) => {
    clearTimeout(toastTimer.current);
    setToast(msg);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
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
    n.say('profile', { t: 'profile', name: s.name, contact: s.contact });
    n.say('arm', { t: 'arm', intent: null });
    if (night.state?.invisible) n.say('invisible', { t: 'invisible', on: true });
    if (night.state?.pick) n.say('pick', { t: 'pick', track: night.state.pick });
    if (night.state?.wristband) n.say('pair', { t: 'pair', band: night.state.wristband });
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

  // A code from the address does not pair on its own. A /pair/ link is a bearer
  // token — a hostile QR anywhere would otherwise bind an attacker's wristband
  // to whoever opened it, leaking their coarse state. So it lands on the pair
  // screen pre-filled and waits for a tap. The stored copy is kept until the
  // person confirms or skips, so a reload during onboarding resumes the confirm.
  // The in-app scanner, where the camera was deliberately pointed, still pairs
  // on sight.
  useEffect(() => {
    if (!linked || !inRoom || !net.current) return;
    setLinked(null);
    setPairConfirm(linked);
    setSheet(null);
    setStack([]);
    setScreen('pair');
  }, [linked, inRoom]);

  // What the relay answers that is not a view. Read through a ref, so the one
  // long-lived connection always acts on this render's state.
  const onRelay = useRef(null);
  onRelay.current = (m) => {
    if (m.t === 'error' && m.why === 'clip refused') say("that didn't go. they may have left, or gone quiet.");
    if (m.t === 'paired') {
      setPairPending(false);
      setPairCode(null);
      setPairConfirm(null);
      if (bandId !== m.band) setNightState({ wristband: m.band });
      // Kept, not said: saying it again would be answered with paired again, for ever.
      net.current?.keep('pair', { t: 'pair', band: m.band });
      if (screen === 'pair') { setPairError(null); say('Paired. It’s your light tonight.'); setStack([]); setScreen('home'); }
    }
    if (m.t === 'error' && m.why === 'no such wristband') {
      setPairPending(false);
      setPairCode(null);
      if (screen === 'pair') setPairError('That’s not a wristband here. Check the letters.');
      else if (bandId) { net.current?.forget('pair'); setNightState({ wristband: null }); }
    }
    // The relay throttles wrong guesses. A real person only meets this after a
    // run of mistypes, so it says to slow down rather than that the code is bad.
    if (m.t === 'error' && m.why === 'too many tries') {
      setPairPending(false);
      setPairCode(null);
      if (screen === 'pair') setPairError('Too many tries. Wait a moment, then scan it instead.');
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

  // The wristband's button made them invisible. The phone follows, and says so from now on.
  useEffect(() => {
    if (!view.me?.invisible || invisible) return;
    setArmed(null);
    net.current?.say('arm', { t: 'arm', intent: null });
    net.current?.say('invisible', { t: 'invisible', on: true });
    setNightState({ invisible: true });
    setStack([]);
    setSheet(null);
    setScreen('quiet');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.me?.invisible]);

  // ---------- what this phone is doing ----------

  const arm = useCallback((intent) => {
    setArmed(intent);
    net.current?.say('arm', { t: 'arm', intent });
    if (intent) {
      setNightState({ invisible: false });
      net.current?.say('invisible', { t: 'invisible', on: false });
      if (intent === 'hi' && !store.hasEvent(s, 'hi')) update((prev) => store.addEvent(prev, 'hi', 'started saying hi'));
    }
  }, [s, setNightState, update]);

  const go = useCallback((to, { replace = false } = {}) => {
    setSheet(null);
    if (!replace) setStack((st) => (to === screen ? st : [...st, screen].slice(-12)));
    const intent = INTENT_OF[to];
    if (intent && armed !== intent) arm(intent);
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
    setArmed(null);
    net.current?.say('arm', { t: 'arm', intent: null });
    net.current?.say('invisible', { t: 'invisible', on: true });
    setNightState({ invisible: true });
    setStack([]);
    setSheet(null);
    setScreen('quiet');
  };

  const backOn = () => {
    net.current?.say('invisible', { t: 'invisible', on: false });
    setNightState({ invisible: false });
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
  const report = (handle) => {
    net.current?.send({ t: 'report', handle: handle || null, why: '' });
    setSheet(null);
    say('reported. the venue team has it.');
  };

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
      { icon: 'watch', label: 'Hold the button on your wristband for a second to go invisible.', fg: '#fff', onTap: () => {} },
      { icon: 'battery_saver', label: 'Your wristband only lights up while you’re saying something.', fg: '#fff', onTap: () => {} },
    ],
  });

  const unpair = () => {
    net.current?.send({ t: 'unpair' });
    net.current?.forget('pair');
    setNightState({ wristband: null });
    setSheet(null);
    say('unpaired. your phone is your light again.');
  };

  const bandSheet = () => setSheet({
    title: 'Your wristband', sub: bandLine(band), close: 'Done',
    rows: [
      { icon: 'flashlight_on', label: 'TEST THE LIGHT', sub: 'it flashes white for two seconds.', fg: '#fff',
        onTap: () => { net.current?.send({ t: 'testLight' }); setSheet(null); say('watch your wrist.'); } },
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

  const leftVenue = () => {
    if (paired) { net.current?.send({ t: 'unpair' }); net.current?.forget('pair'); }
    net.current?.send({ t: 'leave' });
    const key = store.tonightKey();
    update((prev) => (prev.nights[key] ? { ...prev, nights: { ...prev.nights, [key]: { ...prev.nights[key], left: true, state: {} } } } : prev));
    setArmed(null);
    setStack([]);
    setScreen('venue');
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

  // The beacon costs the screen. Ask once a night, when it is low.
  useEffect(() => {
    if (screen !== 'beacon' || night?.state?.batteryAsked) return;
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
      body = <Pair error={pairError} initial={pairConfirm || pairCode} pending={pairPending} confirm={pairConfirm}
        onCode={(code) => { setPairConfirm(null); dropLink(); pairWith(code); }} onScan={() => go('scan')}
        onSkip={() => { setPairConfirm(null); dropLink(); setStack([]); setScreen('home'); }} onBack={stack.length ? back : null} />;
      break;
    }
    case 'scan':
      body = <Scan onCode={(code) => { back(); pairWith(code); }} onType={back} onBack={back} />;
      break;
    case 'home':
      body = <Home show={show} phase={phase} line={line} armed={invisible ? null : armed} ci={ci} setCi={setCi}
        band={band} onBand={() => (paired ? bandSheet() : go('pair'))}
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
        <Mate match={match} onBack={back} onKeep={(on) => keep(match, on)} onTonight={() => go('tonight')}
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
      {sheet ? <Sheet sheet={sheet} onClose={closeSheet} screenRef={stageRef} /> : null}
      {toast ? <div className="toast" role="status" aria-live="polite">{toast}</div> : null}
    </div>
  );
}
