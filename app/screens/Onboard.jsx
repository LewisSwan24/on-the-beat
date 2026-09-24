import { useEffect, useMemo, useState } from 'react';
import { PROMISES } from '../copy.js';
import { timesLine } from '../lib/phase.js';
import { Back, Cta, Ghost, Icon } from '../ui.jsx';

/** S0 — three lights and the name. Tap, or wait. */
export function Splash({ onNext }) {
  useEffect(() => {
    const t = setTimeout(onNext, 1600);
    return () => clearTimeout(t);
  }, [onNext]);
  return (
    <button type="button" className="splash" onClick={onNext}>
      <span className="glow" style={{ background: 'radial-gradient(circle,#0C9DE2 0%,rgba(12,157,226,0) 68%)', left: '10%', top: '29%' }} />
      <span className="glow" style={{ background: 'radial-gradient(circle,#C79A1E 0%,rgba(199,154,30,0) 68%)', right: '5%', top: '23%', animationDelay: '120ms' }} />
      <span className="glow" style={{ background: 'radial-gradient(circle,#A93FD9 0%,rgba(169,63,217,0) 68%)', left: '23%', top: '47%', animationDelay: '240ms' }} />
      <span className="title">ON THE BEAT!</span>
      <span className="tag">Your companion to discover music friends</span>
      <span className="label tap">tap to start</span>
    </button>
  );
}

/** S1 — the four promises, before anything else. */
export function Promises({ onIn, onHow }) {
  return (
    <div className="scr tall">
      <div className="label" style={{ marginBottom: 12 }}>before we start</div>
      <h1 className="h1" style={{ marginBottom: 26 }}>Four promises, then we're in.</h1>
      <div className="promises">
        {PROMISES.map((p) => (
          <div key={p.main} className="promise">
            <span className="pdot" style={{ background: p.dot, boxShadow: `0 0 14px -1px ${p.dot}` }} />
            <span style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span className="lede">{p.main}</span>
              <span className="small">{p.sub}</span>
            </span>
          </div>
        ))}
      </div>
      <div className="foot" style={{ paddingTop: 0 }}>
        <Cta hue="hi" onClick={onIn}>I'M IN</Cta>
        <Ghost onClick={onHow}>How this works</Ghost>
      </div>
    </div>
  );
}

/** A venue nobody listed: a room named by what was typed. */
const roomOf = (text) => String(text).trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 80);

/** S2 — where are you tonight? Tonight's shows, or your word for it. */
export function Venue({ shows, loading, chosen, onChoose, onNotAtShow, onBack }) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(chosen || null);
  const [typed, setTyped] = useState(null);

  const all = useMemo(() => (typed ? [...shows, typed] : shows), [shows, typed]);
  const qq = q.trim().toLowerCase();
  const found = all.filter((s) => !qq || (s.act + ' ' + s.venue).toLowerCase().includes(qq));
  const picked = sel ? all.find((s) => s.room === sel.room) || sel : null;
  const missing = !picked && qq.length > 0 && found.length === 0 && !loading;

  const useTyped = () => {
    const name = q.trim();
    const s = { id: null, room: roomOf(name), act: name.toUpperCase(), venue: 'your word for it', setlist: [], typed: true };
    setTyped(s);
    setSel(s);
    setQ('');
  };

  return (
    <div className="scr tall">
      {onBack ? <Back onClick={onBack} /> : null}
      <h1 className="h1" style={{ marginBottom: 18 }}>Where are you tonight?</h1>
      <div className="field" style={{ '--c': 'var(--hi)' }}>
        <Icon name="search" size={20} color="var(--text-3)" />
        <input value={q} onChange={(e) => { setQ(e.target.value); setSel(null); }} placeholder="venue or act" aria-label="Search venues and acts" enterKeyHint="search" />
      </div>

      {missing ? (
        <div className="card" style={{ marginTop: 22, display: 'flex', flexDirection: 'column', gap: 6, animation: 'ob-pop var(--base) var(--ease)' }}>
          <span className="h2">Can't find that one.</span>
          <span className="body muted">Type it in and we'll go with your word for it.</span>
          <Cta plain style={{ marginTop: 14, height: 52 }} onClick={useTyped}>USE WHAT I TYPED</Cta>
        </div>
      ) : null}

      {!missing && !picked ? (
        <div className="scroll" style={{ marginTop: 20 }}>
          {loading ? <span className="small">finding tonight's shows…</span> : null}
          {found.map((s) => (
            <button key={s.room} type="button" className="show" aria-pressed={sel?.room === s.room} onClick={() => setSel(s)}>
              <span className="sdot" />
              <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                <span className="body" style={{ fontWeight: 600, letterSpacing: '.01em' }}>{s.act}</span>
                <span className="small">{s.venue}</span>
              </span>
              <span className="label tnum" style={{ flex: 'none' }}>{s.typed ? 'here' : 'doors ' + s.doors}</span>
            </button>
          ))}
        </div>
      ) : null}

      {picked ? (
        <div className="picked">
          <div className="label" style={{ color: 'var(--hi)', marginBottom: 10 }}>tonight</div>
          <div className="h1">{picked.act}</div>
          <div className="body muted" style={{ marginTop: 4 }}>{picked.venue}</div>
          <div className="small tnum" style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--line-2)' }}>{timesLine(picked)}</div>
        </div>
      ) : null}

      <div className="foot">
        <Cta hue="hi" disabled={!picked} onClick={() => picked && onChoose(picked)}>THAT'S THE ONE</Cta>
        <Ghost onClick={onNotAtShow}>I'm not at a show</Ghost>
      </div>
    </div>
  );
}

/**
 * What a match will call you. Not in the canvas, which never asks: someone has
 * to be named when two people both say yes. Nobody sees it before that.
 */
export function Name({ name, onDone, onBack }) {
  const [v, setV] = useState(name || '');
  const ok = v.trim().length > 0;
  return (
    <form className="scr tall" onSubmit={(e) => { e.preventDefault(); if (ok) onDone(v.trim()); }}>
      {onBack ? <Back onClick={onBack} /> : null}
      <h1 className="h1" style={{ marginBottom: 6 }}>What should a match call you?</h1>
      <span className="small" style={{ marginBottom: 18 }}>nobody sees it until you both say yes.</span>
      <div className="field" style={{ '--c': 'var(--hi)', borderColor: ok ? 'var(--hi)' : undefined }}>
        <Icon name="badge" size={20} color={ok ? 'var(--hi)' : 'var(--text-3)'} />
        <input value={v} onChange={(e) => setV(e.target.value.slice(0, 24))} placeholder="your first name" aria-label="Your first name"
          autoComplete="given-name" autoCapitalize="words" enterKeyHint="done" />
      </div>
      <span className="small" style={{ marginTop: 12 }}>a first name is plenty. you can change it on Tonight.</span>
      <div className="foot">
        <button type="submit" className="cta" style={{ '--c': 'var(--hi)', '--g': 'var(--hi-g)' }} disabled={!ok}>THAT'S ME</button>
      </div>
    </form>
  );
}
