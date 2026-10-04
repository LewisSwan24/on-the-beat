import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { HUE, cards, hueVars } from '../copy.js';
import { PHASES, hhmm } from '../lib/phase.js';
import { Icon } from '../ui.jsx';
import { bandLine } from './Band.jsx';

const CARD_W = 244;
const STEP = 260;

const DanceGlyph = () => (
  <svg viewBox="0 0 48 48" width="36" height="36" aria-hidden="true">
    <g fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
      <path d="M28 15a11.5 11.5 0 0 1 0 18" />
      <path d="M33.5 10.5a18.5 18.5 0 0 1 0 27" />
      <path d="M39 6a25.5 25.5 0 0 1 0 36" />
    </g>
    <g fill="currentColor">
      <circle cx="12" cy="33" r="6.2" />
      <rect x="15.9" y="9" width="2.6" height="24" rx="1.3" />
      <path d="M18.5 9 L27 12.2 L27 17.6 L18.5 14.4 Z" />
    </g>
  </svg>
);

/** What the venue's staff told everyone here, until this person puts it away. */
function Notice({ notice, onHide }) {
  return (
    <div className="notice" role="status">
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="micro" style={{ color: 'var(--warn)' }}>FROM THE VENUE · {hhmm(notice.at)}</div>
        <div className="body notice-text">{notice.text}</div>
      </div>
      <button type="button" className="icon-btn" onClick={onHide} aria-label="Put the notice away">
        <Icon name="cancel" size={20} />
      </button>
    </div>
  );
}

/** S3 — where the night is, and the cards open tonight, each arming one thing. `open`: their ids, or all of them. */
export function Home({ show, phase, line, armed, open, ci: chosen, setCi, onArm, onOpen, onHow, band, onBand, notice, onHideNotice }) {
  const deck = useRef(null);
  const [w, setW] = useState(393);
  const [drag, setDrag] = useState({ on: false, dx: 0 });
  const down = useRef(null);
  const pi = Math.max(0, PHASES.indexOf(phase));
  const list = cards(show?.act).filter((c) => !open || open.includes(c.id));
  const ci = Math.min(chosen, list.length - 1);   // a card closed while it was the one in front

  useLayoutEffect(() => {
    const el = deck.current;
    if (!el) return undefined;
    const fit = () => setW(el.clientWidth || 393);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); setCi(Math.min(list.length - 1, ci + 1)); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); setCi(Math.max(0, ci - 1)); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ci, setCi, list.length]);

  // A tap must cause no re-render between pointerdown and pointerup: a
  // re-render swaps the node and the browser then fires no click at all.
  const onDown = (e) => { down.current = e.clientX; };
  const onMove = (e) => {
    if (down.current === null) return;
    const dx = (e.clientX - down.current) * 0.6;
    if (!drag.on && Math.abs(dx) < 6) return;
    setDrag({ on: true, dx });
  };
  const onUp = () => {
    if (down.current === null) return;
    down.current = null;
    if (!drag.on) return;
    let next = ci;
    if (drag.dx < -34) next = Math.min(list.length - 1, ci + 1);
    if (drag.dx > 34) next = Math.max(0, ci - 1);
    setDrag({ on: false, dx: 0 });
    setCi(next);
  };

  const x = (w - CARD_W) / 2 - ci * STEP + drag.dx;

  return (
    <div className="scr" style={{ padding: 0 }}>
      <div style={{ padding: '10px 0 0' }}>
        <div className="phasebar"><i style={{ width: ((pi + 1) / 5) * 100 + '%' }} /></div>
        <div className="phases">
          {PHASES.map((p, i) => <span key={p} className="label" style={{ color: i <= pi ? '#fff' : 'var(--text-2)' }}>{p}</span>)}
        </div>
        <div className="label tnum" aria-live="polite" style={{ padding: '9px 24px 0' }}>{line}</div>
        {notice ? <Notice notice={notice} onHide={onHideNotice} /> : null}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 24px 0' }}>
        <span className="h1">ON THE BEAT!</span>
        <span style={{ display: 'flex', alignItems: 'center', marginRight: -10 }}>
          <button type="button" className="bandchip" onClick={onBand}
            aria-label={band ? ['Your wristband', bandLine(band)].filter(Boolean).join(', ') : 'Pair a wristband'}>
            {band ? <><Icon name="watch" size={18} color={band.live ? '#fff' : 'var(--text-3)'} />
              {band.offline ? <span className="tnum" style={{ color: 'var(--warn)' }}>OFFLINE</span>
                : band.battery != null ? <span className="tnum">{band.battery}%</span> : null}</>
              : <span style={{ color: 'var(--text-3)' }}>pair</span>}
          </button>
          <button type="button" className="icon-btn" style={{ borderRadius: 14 }} onClick={onHow} aria-label="How this works">
            <Icon name="shield" size={22} />
          </button>
        </span>
      </div>

      <div ref={deck} className="deck" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
        <div className="track" style={{ transform: `translateX(${x}px)`, transition: drag.on ? 'none' : 'transform 260ms 60ms cubic-bezier(.2,.8,.2,1)' }}>
          {list.map((c, i) => {
            const on = armed === c.id;
            const active = i === ci;
            return (
              <div key={c.id} className="slot" aria-hidden={!active} style={{ transform: `scale(${active ? 1 : 0.92})`, opacity: active ? 1 : 0.42 }}>
                <button type="button" className={'intent' + (on ? ' armed' : '')} style={hueVars(c.id)}
                  aria-pressed={on} tabIndex={active ? 0 : -1}
                  onClick={() => (active ? onArm(c.id) : setCi(i))}>
                  <span className="glyph">{c.icon ? <Icon name={c.icon} size={36} /> : <DanceGlyph />}</span>
                  <span className="name">{on ? c.atitle : c.title}</span>
                  <span className="lines">
                    <span className="idle" aria-hidden={on}>{c.idle.map((l) => <span key={l}>{l}</span>)}</span>
                    <span className="arm" aria-hidden={!on}>{c.armed.map((l) => <span key={l}>{l}</span>)}</span>
                  </span>
                  <span className="label hint">{on ? 'tap again to cancel' : 'tap to arm'}</span>
                </button>
                {on ? (
                  <button type="button" className="chev" style={{ color: HUE[c.id].c }} tabIndex={active ? 0 : -1}
                    aria-label={'Open ' + HUE[c.id].label} onClick={() => onOpen(c.id)}>
                    <span aria-hidden="true">›</span>
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      <div className="dots">
        {list.map((c, i) => (
          <button key={c.id} type="button" aria-current={i === ci ? 'true' : undefined} aria-label={c.title} onClick={() => setCi(i)}>
            <i style={{ width: i === ci ? 20 : 6, background: i === ci ? (armed === c.id ? HUE[c.id].c : '#fff') : 'rgba(255,255,255,.22)' }} />
          </button>
        ))}
      </div>
    </div>
  );
}

/** The bar under a broadcasting screen: the record, the next step, and NOT NOW — always. */
export function Bar({ label, hue, off, onTap, onTonight, onNotNow }) {
  return (
    <div className="bar">
      <button type="button" className="side" onClick={onTonight}>
        <Icon name="history" size={20} />
        <span>TONIGHT</span>
      </button>
      <button type="button" className={'cta' + (hue ? '' : ' idle')} style={hueVars(hue)} disabled={off} onClick={onTap}>{label}</button>
      <button type="button" className="side" onClick={onNotNow}>
        <Icon name="visibility_off" size={20} />
        <span>NOT NOW</span>
      </button>
    </div>
  );
}
