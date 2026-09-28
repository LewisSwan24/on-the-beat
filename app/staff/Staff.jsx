// ON THE BEAT — the staff page (docs/superpowers/specs/2026-09-28-staff-reports-design.md §4): a venue's team
// signs in with its passcode, sees reports as they come, marks them handled, and hears a new one after a tap.
// It shares nothing with the app: all it keeps is tonight's token, in this tab.

import { useCallback, useEffect, useRef, useState } from 'react';
import { connectStaff } from './line.js';
import { REFUSED, freshIds, openCount, ordered, timeOf, titleFor, whereLine, whoLine } from './list.js';

const SESSION = 'otb:staff';   // { venue, token } in sessionStorage
const readSession = () => { try { return JSON.parse(sessionStorage.getItem(SESSION)) || null; } catch { return null; } };
const writeSession = (s) => {
  try {
    if (s) sessionStorage.setItem(SESSION, JSON.stringify(s));
    else sessionStorage.removeItem(SESSION);
  } catch { /* no storage: signed in until this page closes */ }
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

export default function Staff() {
  const [shows, setShows] = useState([]);
  const [session, setSession] = useState(readSession);
  const [venue, setVenue] = useState(() => readSession()?.venue || '');
  const [code, setCode] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('connecting');
  const [reports, setReports] = useState(null);
  const [flash, setFlash] = useState(0);
  const [hearing, setHearing] = useState(false);
  const line = useRef(null);
  const sessionRef = useRef(session);
  const seen = useRef(null);    // the ids of the last list, or null before the first
  const audio = useRef(null);

  useEffect(() => {
    fetch('/api/shows').then((r) => r.json()).then((list) => {
      const all = Array.isArray(list) ? list : [];
      setShows(all);
      setVenue((v) => v || all[0]?.id || '');
    }).catch(() => {});
  }, []);

  const onMessage = useCallback((m) => {
    if (m.t === 'staff') {
      setPending(false);
      if (m.ok) {
        const s = { venue: m.venue, token: m.token };
        writeSession(s);
        sessionRef.current = s;
        setSession(s);
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
    if (m.t === 'reports' && Array.isArray(m.reports)) {
      const fresh = freshIds(seen.current, m.reports);
      seen.current = new Set(m.reports.map((r) => r.id));
      setReports(m.reports);
      if (fresh.length) {
        setFlash((n) => n + 1);
        if (audio.current?.state === 'running') chime(audio.current);
      }
    }
  }, []);

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
  const signOut = () => {
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
        {!hearing ? <p className="staff-note small">Tap anywhere to hear new reports.</p> : null}
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
