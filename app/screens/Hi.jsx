import { useEffect } from 'react';
import { someone } from '../copy.js';
import { holdScreen } from '../lib/device.js';
import { WAVED_LINE } from '../lib/waved.js';
import { Back, Icon, More, Pill } from '../ui.jsx';
import { BandFace } from './Band.jsx';

/** S4 — the phone is the light. Blue means hello. */
export function Beacon({ count, dim, onStop }) {
  useEffect(() => holdScreen(), []);
  return (
    <div className="beacon">
      <div className="blue" style={{ opacity: dim ? 0.55 : 1 }} />
      <div className="halo" />
      <div className="head">
        <span className="label" style={{ color: 'rgba(4,20,24,.78)' }}>show this</span>
        <span className="h1" style={{ color: '#041418' }}>Blue means hello</span>
      </div>
      <div className="hand" aria-hidden="true"><span className="ms">waving_hand</span></div>
      <div className="panel">
        {count === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span className="h2">Nobody's saying hi yet.</span>
            <span className="body muted">You're the first. That's usually how it starts.</span>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <span className="counter">
              <span className="sweep" aria-hidden="true" />
              <span className="ring" key={'r' + count} style={{ animation: 'ob-tick 380ms var(--ease)' }} />
              <span className="n"><span key={'n' + count}>{count}</span></span>
            </span>
            <span className="lede" aria-live="polite">{count} {count === 1 ? 'other' : 'others'} saying hi near you</span>
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <span className="small">This keeps the screen bright.</span>
          <button type="button" className="ghost" style={{ width: 'auto', height: 44, padding: '0 4px' }} onClick={onStop}>Stop saying hi</button>
        </div>
      </div>
    </div>
  );
}

/** S4, paired — the wristband is the light, and the phone goes back in the pocket. */
export function WristBeacon({ count, onStop }) {
  return (
    <div className="scr tall" style={{ alignItems: 'center', textAlign: 'center' }}>
      <span className="h1">Your wristband is your light.</span>
      <span className="body muted" style={{ marginTop: 6 }}>Phone away. Blue means hello.</span>
      <div style={{ flex: 1, minHeight: 250, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px 0' }}>
        <div className="bandbody" style={{ padding: 8, borderRadius: 16 }}>
          <BandFace show={{ kind: 'hi', intent: 'hi', big: 'HI :)', small: 'blue means hello' }} scale={1} />
        </div>
      </div>
      <div style={{ alignSelf: 'stretch', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 14, paddingBottom: 18 }}>
        {count === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span className="h2">Nobody's saying hi yet.</span>
            <span className="body muted">You're the first. That's usually how it starts.</span>
          </div>
        ) : (
          <span className="lede" aria-live="polite">{count} {count === 1 ? 'other' : 'others'} saying hi near you</span>
        )}
        <button type="button" className="ghost" style={{ width: 'auto', height: 44, alignSelf: 'flex-end' }} onClick={onStop}>Stop saying hi</button>
      </div>
    </div>
  );
}

/** S5 — who is showing blue, as a band. Nobody is named until you both say yes. */
export function Near({ near, offline, onBack, onWave, onMore }) {
  return (
    <div className="scr">
      <Back onClick={onBack} />
      <h1 className="h1" style={{ margin: '6px 0 4px' }}>Saying hi near you</h1>
      {offline ? (
        <div className="notice">
          <Icon name="wifi_off" size={20} color="var(--warn)" style={{ marginTop: 1 }} />
          <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span className="body" style={{ fontWeight: 600 }}>No signal in here.</span>
            <span className="small">Saved. It'll sync when you're out.</span>
          </span>
        </div>
      ) : null}
      <span className="small" style={{ marginBottom: 14 }}>nobody is named until you both say yes.</span>
      <div className="scroll">
        {near.length === 0 ? (
          <div className="empty">
            <span className="h2">Nobody's saying hi yet.</span>
            <span className="body muted">When someone near you shows blue, they'll be here.</span>
          </div>
        ) : null}
        {near.map((p) => {
          const label = p.waved ? WAVED_LINE : p.wavedAtYou ? someone(p.band) + ' waved at you' : someone(p.band);
          return (
            <div key={p.handle} className="row" style={p.wavedAtYou && !p.waved ? { borderColor: 'var(--hi)' } : undefined}>
              <div className="person">
                <span className="dot" aria-hidden="true" style={{ opacity: p.waved ? 0.4 : 1 }} />
                <span className="who" style={{ color: p.waved ? 'var(--text-2)' : '#fff' }}>{label}</span>
                <More className="more" onClick={() => onMore(p.handle, someone(p.band))} />
              </div>
              <div className="acts">
                {p.pick ? <Pill track={p.pick} /> : null}
                <button type="button" className="btn-s" disabled={p.waved} onClick={() => onWave(p.handle)}
                  style={p.waved ? { '--c': 'var(--line-2)', '--f': 'var(--text-3)' } : { '--c': 'var(--hi)', '--f': 'var(--hi)' }}>
                  {p.waved ? 'WAVED' : p.wavedAtYou ? 'WAVE BACK' : 'WAVE'}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
