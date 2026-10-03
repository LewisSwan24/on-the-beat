// ON THE BEAT — the staff page (docs/superpowers/specs/2026-09-28-staff-reports-design.md §4): a venue's team
// signs in with its passcode, sees reports as they come, marks them handled, and hears a new one after a tap.
// A device can be told of one with the page closed or asleep too: a notification, by Web Push
// (docs/superpowers/specs/2026-09-29-staff-push-design.md §1). It shares nothing with the app: all it keeps is
// tonight's sign-in, in this tab, or on this device once its notifications are on.

import { useCallback, useEffect, useRef, useState } from 'react';
import { connectStaff } from './line.js';
import { REFUSED, freshIds, openCount, ordered, timeOf, titleFor, whereLine, whoLine } from './list.js';
import { NOTICE_TAG, NOTIFY_WORDS, fromB64u, sameKey, startState } from './notify.js';
import { fiveOf, inOrder, shiftFrom } from '../lib/venue.js';

const SESSION = 'otb:staff';   // { venue, token }: in sessionStorage, or in localStorage once notifications are on
const storage = (name) => { try { return window[name] ?? null; } catch { return null; } };
/** Tonight's sign-in: the one kept on this device first, then this tab's. */
const readSession = () => {
  for (const name of ['localStorage', 'sessionStorage']) {
    try {
      const s = JSON.parse(storage(name)?.getItem(SESSION) ?? 'null');
      if (s) return s;
    } catch { /* nothing readable here */ }
  }
  return null;
};
/** Is the sign-in kept on this device, not only in this tab? */
const isKept = () => { try { return !!storage('localStorage')?.getItem(SESSION); } catch { return false; } };
/** Keeps `s` on the device when `kept`, else in this tab, and nowhere else. Null forgets it in both. */
const writeSession = (s, kept = false) => {
  for (const name of ['localStorage', 'sessionStorage']) {
    try {
      if (s && (name === 'localStorage') === kept) storage(name)?.setItem(SESSION, JSON.stringify(s));
      else storage(name)?.removeItem(SESSION);
    } catch { /* no storage: signed in until this page closes */ }
  }
};

/** Two short notes, to be heard across a bar. */
function chime(ctx) {
  const t = ctx.currentTime;
  [880, 1320].forEach((f, i) => {
    const at = t + i * 0.18;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.4, at + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.16);
    o.connect(g).connect(ctx.destination);
    o.start(at);
    o.stop(at + 0.18);
  });
}

/** The staff worker's registration once it is active. It only shows notifications (public/staff-sw.js). */
function registerWorker() {
  return navigator.serviceWorker.register('/staff-sw.js', { scope: '/staff' }).then((reg) => (reg.active ? reg : new Promise((resolve) => {
    const w = reg.installing || reg.waiting;
    w?.addEventListener('statechange', () => { if (reg.active) resolve(reg); });
  })));
}

/**
 * FIRST SONG?'s answer: when the headline's first song starts, staff name it and every phone at the venue sees it,
 * with whether its person called it. A set-list track or typed words fill the field; nothing goes until NAME IT.
 */
function OpenerPanel({ opener, setlist, onName }) {
  const [text, setText] = useState('');
  const tracks = Array.isArray(setlist) ? setlist : [];
  const name = (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    onName(text.trim());
    setText('');
  };
  return (
    <section className="staff-opener" aria-label="First song">
      <div className="label">First song</div>
      <Said>{opener ? 'Named: ' + opener.track + '. Every phone sees it.' : ''}</Said>
      {opener ? (
        <div className="staff-line" style={{ justifyContent: 'space-between' }}>
          <span className="body">Named: <strong>{opener.track}</strong> <span className="small">at {timeOf(opener.at)}</span></span>
          <button type="button" className="btn-s" onClick={() => onName('')}>TAKE BACK</button>
        </div>
      ) : (
        <p className="small">When the headline's first song starts, name it here. Every phone at the venue sees the answer.</p>
      )}
      <form className="staff-form" onSubmit={name}>
        {tracks.length ? (
          <div className="staff-tracks">
            {tracks.map((t) => (
              <button key={t} type="button" className="btn-s" aria-pressed={text === t} onClick={() => setText(t)}>{t}</button>
            ))}
          </div>
        ) : null}
        <input className="staff-input" value={text} onChange={(e) => setText(e.target.value.slice(0, 60))}
          placeholder="or type the track" aria-label="The first song" autoComplete="off" />
        <button type="submit" className="btn-s" disabled={!text.trim()}>{opener ? 'NAME IT INSTEAD' : 'NAME IT'}</button>
      </form>
    </section>
  );
}

const NOTICE_MAX = 140;

/**
 * A notice to every phone at the venue: a toast on each, a line on its Home screen until put away, and a line on its
 * Tonight. Only the latest stands; a new one goes at most every 20 seconds, and taking one down never waits.
 */
/**
 * What the relay took, said aloud: a screen reader hears that a notice went up, a time moved or the opener was named,
 * which the line beside the button only shows. Always rendered, so a change is announced; empty says nothing.
 */
const Said = ({ children }) => <span className="sr-only" role="status">{children}</span>;

function NoticePanel({ notice, wait, onSend }) {
  const [text, setText] = useState('');
  const sent = useRef(null);
  // The field empties once the relay has the words: a notice sent too soon keeps them for another try.
  useEffect(() => {
    if (notice && notice.text === sent.current) { setText(''); sent.current = null; }
  }, [notice]);
  const send = (e) => {
    e.preventDefault();
    const t = text.replace(/\s+/g, ' ').trim();
    if (!t) return;
    sent.current = t;
    onSend(t);
  };
  return (
    <section className="staff-opener staff-notice" aria-label="Notice">
      <div className="label">Tell everyone here</div>
      <Said>{notice ? 'On every phone: ' + notice.text : ''}</Said>
      {notice ? (
        <div className="staff-line" style={{ justifyContent: 'space-between' }}>
          <span className="body">On every phone: <strong>{notice.text}</strong> <span className="small">since {timeOf(notice.at)}</span></span>
          <button type="button" className="btn-s" onClick={() => onSend('')}>TAKE DOWN</button>
        </div>
      ) : (
        <p className="small">A short line every phone at the venue sees: a delay, a closed exit, the last train.</p>
      )}
      <form className="staff-form" onSubmit={send}>
        <input className="staff-input" value={text} onChange={(e) => setText(e.target.value.slice(0, NOTICE_MAX))}
          placeholder="Headline is 20 minutes late" aria-label="The notice" autoComplete="off" />
        <div className="staff-line" style={{ justifyContent: 'space-between' }}>
          <button type="submit" className="btn-s" disabled={!text.trim()}>{notice ? 'SEND INSTEAD' : 'SEND TO EVERY PHONE'}</button>
          <span className="small tnum" aria-hidden="true">{text.length}/{NOTICE_MAX}</span>
        </div>
        {wait ? <p className="small staff-error" role="alert">One went out just now. Try again in {wait} s.</p> : null}
      </form>
    </section>
  );
}

const TIME_NAMES = { doors: 'Doors', support: 'Support', break: 'Break', headline: 'Headline', end: 'End' };

/**
 * Tonight's times, moved: every phone's phase bar and countdowns follow. A row's −5 and +5 move it and everything after
 * it, as a late start does; nothing goes until SAVE TIMES, and BACK AS LISTED undoes all of it.
 */
function TimesPanel({ times, listed, onSet }) {
  const now = times ? fiveOf(times) : fiveOf(listed);
  const [draft, setDraft] = useState(null);
  const shown = draft || now;
  const changed = Object.keys(TIME_NAMES).some((k) => shown[k] !== now[k]);
  const ok = inOrder(shown);
  const save = (e) => {
    e.preventDefault();
    if (!changed || !ok) return;
    onSet(shown);
    setDraft(null);
  };
  return (
    <section className="staff-opener staff-times" aria-label="Show times">
      <div className="label">Show times</div>
      <p className="small">{times ? 'Moved at ' + timeOf(times.at) + '. Every phone shows these.' : 'As listed. Move them if the night runs late.'}</p>
      <Said>{times ? 'Times moved. Every phone shows them.' : ''}</Said>
      <form className="staff-form" onSubmit={save}>
        {Object.entries(TIME_NAMES).map(([k, name]) => (
          <div key={k} className="staff-time-row">
            <label className="body" htmlFor={'time-' + k}>{name}</label>
            <input id={'time-' + k} className="staff-input tnum" type="time" value={shown[k]} required
              onChange={(e) => setDraft({ ...shown, [k]: e.target.value })} />
            <button type="button" className="btn-s" aria-label={name + ' and after, 5 minutes earlier'}
              onClick={() => setDraft(shiftFrom(shown, k, -5))}>−5</button>
            <button type="button" className="btn-s" aria-label={name + ' and after, 5 minutes later'}
              onClick={() => setDraft(shiftFrom(shown, k, 5))}>+5</button>
          </div>
        ))}
        {!ok ? <p className="small staff-error" role="alert">Each time has to come after the one above it.</p> : null}
        <div className="staff-line">
          <button type="submit" className="btn-s" disabled={!changed || !ok}>SAVE TIMES</button>
          {draft ? <button type="button" className="btn-s" onClick={() => setDraft(null)}>UNDO</button> : null}
          {times && !draft ? <button type="button" className="btn-s" onClick={() => onSet(null)}>BACK AS LISTED</button> : null}
        </div>
      </form>
    </section>
  );
}

export default function Staff() {
  const [shows, setShows] = useState([]);
  const [session, setSession] = useState(readSession);
  const [venue, setVenue] = useState(() => readSession()?.venue || '');
  const [code, setCode] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('connecting');
  const [reports, setReports] = useState(null);
  const [opener, setOpener] = useState(undefined);   // FIRST SONG?'s answer as the relay holds it: undefined until told
  const [notice, setNotice] = useState(undefined);   // the notice standing, as the relay holds it: undefined until told
  const [noticeWait, setNoticeWait] = useState(0);   // seconds before a new one may go, once one was sent too soon
  const [times, setTimes] = useState(undefined);     // tonight's times as moved, null as listed: undefined until told
  const [flash, setFlash] = useState(0);
  const [hearing, setHearing] = useState(false);
  const [notify, setNotify] = useState(() => startState({
    secure: window.isSecureContext, sw: 'serviceWorker' in navigator, push: 'PushManager' in window,
    standalone: navigator.standalone, permission: window.Notification?.permission,
  }));
  const [reg, setReg] = useState(null);        // the staff worker's registration, once active
  const [pushKey, setPushKey] = useState('');   // the relay's public key, from its sign-in answer
  const line = useRef(null);
  const sessionRef = useRef(session);
  const regRef = useRef(null);
  const seen = useRef(null);    // the ids of the last list, or null before the first
  const audio = useRef(null);

  const loadShows = useCallback(() => {
    fetch('/api/shows').then((r) => r.json()).then((list) => {
      const all = Array.isArray(list) ? list : [];
      setShows(all);
      setVenue((v) => v || all[0]?.id || '');
    }).catch(() => {});
  }, []);
  useEffect(loadShows, [loadShows]);

  // On screen, the list is in front of them: this device's report notifications go.
  const clearNotices = useCallback(() => {
    if (document.visibilityState !== 'visible') return;
    regRef.current?.getNotifications({ tag: NOTICE_TAG }).then((all) => all.forEach((n) => n.close())).catch(() => {});
  }, []);

  const onMessage = useCallback((m) => {
    if (m.t === 'staff') {
      setPending(false);
      if (m.ok) {
        const s = { venue: m.venue, token: m.token };
        writeSession(s, isKept());
        sessionRef.current = s;
        setSession(s);
        setPushKey(typeof m.push === 'string' ? m.push : '');
        setError('');
        setCode('');
        return;
      }
      writeSession(null);
      sessionRef.current = null;
      seen.current = null;
      setSession(null);
      setReports(null);
      setCode('');
      setError(REFUSED[m.why] || REFUSED['bad staff']);
      return;
    }
    if (m.t === 'push') {
      // Taken: the sign-in is kept on the device until 06:00, so a tap on a notification finds it signed in.
      if (m.ok && sessionRef.current) writeSession(sessionRef.current, true);
      setNotify(m.ok ? 'on' : 'refused');
      return;
    }
    if (m.t === 'opener') {
      setOpener(m.opener && typeof m.opener.track === 'string' ? m.opener : null);
      return;
    }
    if (m.t === 'notice') {
      setNotice(m.notice && typeof m.notice.text === 'string' ? m.notice : null);
      setNoticeWait(Number.isInteger(m.wait) && m.wait > 0 ? m.wait : 0);
      return;
    }
    if (m.t === 'times') {
      setTimes(m.times && typeof m.times === 'object' ? m.times : null);
      // The venue list names moved times, so once they are back as listed it is asked again for the listed ones.
      if (!m.times) loadShows();
      return;
    }
    if (m.t === 'reports' && Array.isArray(m.reports)) {
      const fresh = freshIds(seen.current, m.reports);
      seen.current = new Set(m.reports.map((r) => r.id));
      setReports(m.reports);
      clearNotices();
      if (fresh.length) {
        setFlash((n) => n + 1);
        if (audio.current?.state === 'running') chime(audio.current);
      }
    }
  }, [clearNotices]);

  useEffect(() => {
    const l = connectStaff({
      onOpen: () => {
        const s = sessionRef.current;
        if (s) l.send({ t: 'staff', venue: s.venue, token: s.token });
      },
      onMessage,
      onStatus: (s) => {
        setStatus(s);
        if (s !== 'live') setPending(false);
      },
    });
    line.current = l;
    return () => l.close();
  }, [onMessage]);

  // A browser plays sound only after a tap on the page: the first one opens it.
  useEffect(() => {
    const unlock = () => {
      try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        audio.current ??= new Ctx();
        audio.current.resume().then(() => setHearing(audio.current.state === 'running')).catch(() => {});
      } catch { /* no sound here */ }
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  // The staff worker, on every load where the browser has one.
  useEffect(() => {
    if (!('serviceWorker' in navigator) || !window.isSecureContext) return undefined;
    let gone = false;
    registerWorker().then((r) => { if (!gone) { regRef.current = r; setReg(r); } }).catch(() => {});
    return () => { gone = true; };
  }, []);

  useEffect(() => {
    document.addEventListener('visibilitychange', clearNotices);
    return () => document.removeEventListener('visibilitychange', clearNotices);
  }, [clearNotices]);

  /** Hands this device's subscription to the relay; its answer says whether they are on. */
  const offer = useCallback((sub) => {
    if (line.current?.send({ t: 'push', sub: sub.toJSON() })) setNotify((n) => (n === 'on' ? n : 'asking'));
  }, []);

  // Every sign-in turns notifications on by itself where they were on before: the browser's subscription, made
  // again if it was made under another key, goes to the relay with no tap.
  useEffect(() => {
    if (!session || !pushKey || !reg || window.Notification?.permission !== 'granted') return undefined;
    let gone = false;
    (async () => {
      let sub = await reg.pushManager.getSubscription();
      if (sub && !sameKey(sub, pushKey)) {
        await sub.unsubscribe().catch(() => {});
        sub = null;
      }
      sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromB64u(pushKey) });
      if (!gone) offer(sub);
    })().catch(() => { if (!gone) setNotify('off'); });
    return () => { gone = true; };
  }, [session, pushKey, reg, offer]);

  const label = (id) => {
    const s = shows.find((x) => x.id === id);
    return s ? s.venue + ' · ' + s.act : id;
  };
  const open = reports ? openCount(reports) : 0;
  useEffect(() => {
    document.title = session ? titleFor(label(session.venue), open) : 'Staff · On The Beat';
  });

  const signIn = (e) => {
    e.preventDefault();
    if (!venue || !code || pending) return;
    setError('');
    if (!line.current?.send({ t: 'staff', venue, code })) { setError('Not connected yet. Try again in a moment.'); return; }
    setPending(true);
  };
  const notifyThis = () => {
    if (!reg || !pushKey) return;
    setNotify('asking');
    // iOS takes a permission request only from a tap: subscribe() comes before anything is awaited.
    reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromB64u(pushKey) }).then(offer).catch(() => {
      const p = window.Notification?.permission;
      setNotify(p === 'denied' ? 'blocked' : p === 'granted' ? 'refused' : 'off');
    });
  };
  const signOut = async () => {
    line.current?.send({ t: 'signout' });
    // The browser's subscription goes too, so a sign-out the relay never hears still stops the pushes.
    const sub = await reg?.pushManager.getSubscription().catch(() => null);
    await Promise.race([sub?.unsubscribe().catch(() => {}), new Promise((r) => setTimeout(r, 1500))]);
    writeSession(null);
    location.reload();
  };
  const mark = (r) => line.current?.send({ t: 'handled', id: r.id, on: !r.handledAt });

  if (session) {
    return (
      <main className="staff">
        <header key={flash} className={'staff-top' + (flash ? ' flash' : '')}>
          <div style={{ minWidth: 0 }}>
            <div className="h2">{label(session.venue)}</div>
            <div className="small">
              {reports ? open + ' open' : 'signing in…'} · {status === 'live' ? 'live' : 'reconnecting…'}
            </div>
          </div>
          <button type="button" className="btn-s" onClick={signOut}>SIGN OUT</button>
        </header>
        {notify === 'off' ? (
          <button type="button" className="btn-s staff-notify" onClick={notifyThis} disabled={!reg || !pushKey}>{NOTIFY_WORDS.off}</button>
        ) : <p className="staff-note small">{NOTIFY_WORDS[notify]}</p>}
        {!hearing ? <p className="staff-note small">Tap anywhere to hear new reports.</p> : null}
        {notice !== undefined ? (
          <NoticePanel notice={notice} wait={noticeWait}
            onSend={(text) => { setNoticeWait(0); line.current?.send({ t: 'notice', text }); }} />
        ) : null}
        {times !== undefined ? (
          <TimesPanel key={times?.at ?? 'listed'} times={times} listed={shows.find((x) => x.id === session.venue)}
            onSet={(next) => line.current?.send({ t: 'times', times: next })} />
        ) : null}
        {opener !== undefined ? (
          <OpenerPanel opener={opener} setlist={shows.find((x) => x.id === session.venue)?.setlist}
            onName={(track) => line.current?.send({ t: 'opener', track })} />
        ) : null}
        {reports && !reports.length ? <p className="staff-note small">No reports tonight.</p> : null}
        {reports ? ordered(reports).map((r) => (
          <article key={r.id} className={'staff-report' + (r.handledAt ? ' done' : '')}>
            <div className="staff-line">
              <span className="staff-time">{timeOf(r.at)}</span>
              <span className="body">{whoLine(r)}</span>
            </div>
            <div className="small">{whereLine(r)}</div>
            {r.why ? <p className="staff-why body">{r.why}</p> : null}
            <button type="button" className="btn-s" onClick={() => mark(r)}>{r.handledAt ? 'REOPEN' : 'HANDLED'}</button>
          </article>
        )) : null}
      </main>
    );
  }

  return (
    <main className="staff staff-in">
      <h1 className="h1">Staff</h1>
      <p className="small">Reports from people at your venue, as they come in. Names, contacts and who reported are never shown.</p>
      <form className="staff-form" onSubmit={signIn}>
        <label className="label" htmlFor="venue">Venue</label>
        {shows.length ? (
          <select id="venue" className="staff-input" value={venue} onChange={(e) => setVenue(e.target.value)}>
            {shows.map((s) => <option key={s.id} value={s.id}>{s.venue + ' · ' + s.act}</option>)}
          </select>
        ) : (
          <input id="venue" className="staff-input" value={venue} onChange={(e) => setVenue(e.target.value)}
            placeholder="the venue's show id" autoComplete="off" />
        )}
        <label className="label" htmlFor="code">Passcode</label>
        <input id="code" className="staff-input" type="password" value={code} autoComplete="current-password"
          onChange={(e) => setCode(e.target.value.slice(0, 200))} />
        {error ? <p className="staff-error small" role="alert">{error}</p> : null}
        <button type="submit" className="cta" style={{ '--c': 'var(--hi)', '--g': 'transparent' }}
          disabled={!venue || !code || pending || status !== 'live'}>
          {pending ? 'SIGNING IN…' : 'SIGN IN'}
        </button>
      </form>
    </main>
  );
}
