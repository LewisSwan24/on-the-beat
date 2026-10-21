import { useEffect, useMemo, useState } from 'react';
import { PROMISES, WHERE } from '../copy.js';
import { timesLine } from '../lib/phase.js';
import { byPlace, distanceLabel } from '../lib/where.js';
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
export function Promises({ name, onIn, onHow }) {
  // The first name rides on the same page, so the way in is one page, not two.
  const [v, setV] = useState(name || '');
  const ok = v.trim().length > 0;
  return (
    <form className="scr tall" onSubmit={(e) => { e.preventDefault(); if (ok) onIn(v.trim()); }}>
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
      <div className="field" style={{ '--c': 'var(--hi)', marginTop: 22, borderColor: ok ? 'var(--hi)' : undefined }}>
        <Icon name="badge" size={20} color={ok ? 'var(--hi)' : 'var(--text-3)'} />
        <input value={v} onChange={(e) => setV(e.target.value.slice(0, 24))} placeholder="your first name" aria-label="Your first name"
          autoComplete="given-name" autoCapitalize="words" enterKeyHint="go" />
      </div>
      <span className="small" style={{ marginTop: 8 }}>what a match calls you. nobody sees it until you both say yes.</span>
      <div className="foot" style={{ paddingTop: 0 }}>
        <button type="submit" className="cta" style={{ '--c': 'var(--hi)', '--g': 'var(--hi-g)' }} disabled={!ok}>I'M IN</button>
        <Ghost onClick={onHow}>How this works</Ghost>
      </div>
    </form>
  );
}

/** S2 — where are you tonight? Tonight's rooms, nearest first when the phone knows, or one made here. */
export function Venue({ shows, loading, chosen, onChoose, onNotAtShow, onBack, here, finding, onFind, onMake }) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(chosen || null);
  // NOT HERE? ADD IT: the form for a venue nobody listed, or null while the list is up.
  const [making, setMaking] = useState(null);

  // Tonight's rooms within 2 km first, nearest first, when the phone knows where it is; the rest after, as listed.
  const { near, rest } = useMemo(() => byPlace(shows, here), [shows, here]);
  const all = useMemo(() => [...near, ...rest], [near, rest]);
  const qq = q.trim().toLowerCase();
  const found = all.filter((s) => !qq || ((s.act || '') + ' ' + s.venue).toLowerCase().includes(qq));
  const picked = sel ? all.find((s) => s.room === sel.room) || sel : null;
  const missing = !picked && qq.length > 0 && found.length === 0 && !loading;

  // The nearest is chosen already, so one tap on THAT'S THE ONE joins it (spec §2).
  const nearest = near[0]?.room;
  useEffect(() => { if (nearest && !q) setSel((was) => was || near[0]); }, [nearest]);   // eslint-disable-line react-hooks/exhaustive-deps

  const title = (s) => s.act || s.venue;
  const sub = (s) => (s.act ? s.venue : s.made ? WHERE.made : '');
  const side = (s) => (s.away != null ? distanceLabel(s.away) : s.typed ? 'here' : s.made ? WHERE.made : s.doors ? 'doors ' + s.doors : '');

  if (making) {
    const ok = making.name.trim().length > 0;
    return (
      <form className="scr tall" onSubmit={(e) => { e.preventDefault(); if (ok) onMake(making.name, making.act); }}>
        <Back onClick={() => setMaking(null)} />
        <h1 className="h1" style={{ marginBottom: 18 }}>Which venue is it?</h1>
        <div className="field" style={{ '--c': 'var(--hi)' }}>
          <input value={making.name} onChange={(e) => setMaking({ ...making, name: e.target.value.slice(0, 80) })}
            placeholder="the venue's name" aria-label="The venue's name" autoFocus />
        </div>
        <div className="field" style={{ '--c': 'var(--hi)', marginTop: 12 }}>
          <input value={making.act} onChange={(e) => setMaking({ ...making, act: e.target.value.slice(0, 60) })}
            placeholder="who's playing (optional)" aria-label="Who is playing, optional" />
        </div>
        {near.length ? (
          <div className="scroll" style={{ marginTop: 20 }}>
            <span className="label" style={{ marginBottom: 8 }}>{WHERE.oneOfThese}</span>
            {near.map((s) => (
              <button key={s.room} type="button" className="show" onClick={() => { setSel(s); setQ(''); setMaking(null); }}>
                <span className="sdot" />
                <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                  <span className="body" style={{ fontWeight: 600, letterSpacing: '.01em' }}>{title(s)}</span>
                  <span className="small">{sub(s)}</span>
                </span>
                <span className="label tnum" style={{ flex: 'none' }}>{side(s)}</span>
              </button>
            ))}
          </div>
        ) : null}
        <div className="foot">
          <button type="submit" className="cta" style={{ '--c': 'var(--hi)', '--g': 'var(--hi-g)' }} disabled={!ok}>{WHERE.make}</button>
        </div>
      </form>
    );
  }

  const addIt = () => setMaking({ name: q.trim(), act: '' });

  return (
    <div className="scr tall">
      {onBack ? <Back onClick={onBack} /> : null}
      <h1 className="h1" style={{ marginBottom: 18 }}>Where are you tonight?</h1>
      {!here && onFind ? (
        <Cta plain style={{ height: 48, marginBottom: 12 }} disabled={finding} onClick={onFind}>{finding ? WHERE.finding : WHERE.find}</Cta>
      ) : null}
      <div className="field" style={{ '--c': 'var(--hi)' }}>
        <Icon name="search" size={20} color="var(--text-3)" />
        <input value={q} onChange={(e) => { setQ(e.target.value); setSel(null); }} placeholder="venue or act" aria-label="Search venues and acts" enterKeyHint="search" />
      </div>

      {missing ? (
        <div className="card" style={{ marginTop: 22, display: 'flex', flexDirection: 'column', gap: 6, animation: 'ob-pop var(--base) var(--ease)' }}>
          <span className="h2">Can't find that one.</span>
          <span className="body muted">Add it, and the next person here finds it.</span>
          <Cta plain style={{ marginTop: 14, height: 52 }} onClick={addIt}>{WHERE.notHere}</Cta>
        </div>
      ) : null}

      {!missing && !picked ? (
        <div className="scroll" style={{ marginTop: 20 }}>
          {loading ? <span className="small">finding tonight's shows…</span> : null}
          {found.map((s) => (
            <button key={s.room} type="button" className="show" aria-pressed={sel?.room === s.room} onClick={() => setSel(s)}>
              <span className="sdot" />
              <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                <span className="body" style={{ fontWeight: 600, letterSpacing: '.01em' }}>{title(s)}</span>
                <span className="small">{sub(s)}</span>
              </span>
              <span className="label tnum" style={{ flex: 'none' }}>{side(s)}</span>
            </button>
          ))}
          {!loading ? <Ghost onClick={addIt}>{WHERE.notHere}</Ghost> : null}
        </div>
      ) : null}

      {picked ? (
        <div className="picked">
          <div className="label" style={{ color: 'var(--hi)', marginBottom: 10 }}>tonight{picked.away != null ? ' · ' + distanceLabel(picked.away) : ''}</div>
          <div className="h1">{title(picked)}</div>
          <div className="body muted" style={{ marginTop: 4 }}>{sub(picked)}</div>
          <div className="small tnum" style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--line-2)' }}>{timesLine(picked)}</div>
        </div>
      ) : null}

      <div className="foot">
        <Cta hue="hi" disabled={!picked} onClick={() => picked && onChoose(picked)}>THAT'S THE ONE</Cta>
        {picked ? <Ghost onClick={() => setSel(null)}>not this one</Ghost> : <Ghost onClick={onNotAtShow}>I'm not at a show</Ghost>}
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
