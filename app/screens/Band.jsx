import { useEffect, useMemo, useRef, useState } from 'react';
import { HUE } from '../copy.js';
import { CODE_LETTERS, cleanCode } from '../../relay/band.js';
import { pairUrl } from '../lib/pairing.js';
import { qrMatrix, qrPath } from '../lib/qr.js';
import { bandIdOf, toHex } from '../lib/sha256.js';
import { Back, Ghost, Icon } from '../ui.jsx';

/**
 * The wristband's screen: 135 x 240, drawn at any scale. A light first and
 * words second — one colour field and at most two short lines.
 */
export function BandFace({ show, awake, battery, scale = 2, pairAt = null }) {
  const s = show || { kind: 'off' };
  const hue = HUE[s.intent];
  const lit = hue && (s.kind === 'hi' || s.kind === 'song' || s.kind === 'dance' || s.kind === 'meet');
  const bg = s.kind === 'test' ? '#FFFFFF'
    : lit ? `radial-gradient(120% 90% at 50% 38%, ${hue.c} 0%, ${hue.g} 100%)` : '#000000';
  return (
    <div className="bandface" style={{ width: 135 * scale, height: 240 * scale, '--u': scale + 'px', background: bg, filter: s.dim ? 'brightness(.5)' : 'none' }}
      role="img" aria-label={faceLabel(s, awake, battery, pairAt)}>
      {s.kind === 'pairing' ? <Pairing code={s.code} at={pairAt} /> : null}
      {lit && s.kind !== 'meet' ? (
        <span className="words">
          <span className="big">{s.big}</span>
          {s.small ? <span className="small-w">{s.small}</span> : null}
        </span>
      ) : null}
      {s.kind === 'meet' ? (
        <span className="words meet">
          <span className="small-w">{s.small}</span>
          <span className="num">{s.big}</span>
        </span>
      ) : null}
      {s.kind === 'off' && awake ? (
        <span className="words ready">
          <span className="big">READY</span>
          {battery !== null && battery !== undefined ? <span className="small-w">{battery}%</span> : null}
        </span>
      ) : null}
    </div>
  );
}

/** Pairing: a code to scan over the four letters to type. Either one pairs. */
function Pairing({ code, at }) {
  const qr = useMemo(() => (at ? qrMatrix(at) : null), [at]);
  const box = qr ? qr.size + 8 : 0;
  return (
    <span className="pairing">
      {qr ? (
        <svg className="qr" viewBox={`0 0 ${box} ${box}`} shapeRendering="crispEdges" aria-hidden="true">
          <rect width={box} height={box} fill="#fff" />
          <path d={qrPath(qr)} fill="#000" />
        </svg>
      ) : null}
      <span className="code">{code}</span>
    </span>
  );
}

function faceLabel(s, awake, battery, pairAt) {
  if (s.kind === 'pairing') return 'Wristband showing its pairing letters ' + s.code.split('').join(' ') + (pairAt ? ', and a code to scan' : '');
  if (s.kind === 'test') return 'Wristband flashing white';
  if (s.kind === 'meet') return 'Wristband showing meeting number ' + s.big;
  if (s.big) return 'Wristband lit: ' + s.big + (s.small ? ', ' + s.small : '');
  if (awake) return 'Wristband ready, ' + (battery ?? '?') + '% battery';
  return 'Wristband dark';
}

/** S2b — pair a wristband: scan what its screen shows, or type its four letters. */
export function Pair({ error, initial, pending, onCode, onScan, onSkip, onBack }) {
  const [v, setV] = useState(initial || '');
  const input = useRef(null);
  useEffect(() => { if (error) setV(''); }, [error]);
  // Letters that came from a scan or a link are shown while they pair.
  useEffect(() => { if (initial) setV(initial); }, [initial]);
  return (
    <div className="scr tall">
      {onBack ? <Back onClick={onBack} /> : null}
      <h1 className="h1" style={{ marginBottom: 6 }}>Got a wristband?</h1>
      <span className="body muted" style={{ marginBottom: 22 }}>
        Press its face button. Scan what it shows, or type the four letters. It will show a number to check.
      </span>
      <label className="codebox" onClick={() => input.current?.focus()}>
        <input ref={input} value={v} autoFocus={!initial} autoCapitalize="characters" autoComplete="one-time-code" spellCheck={false}
          aria-label="The four letters on your wristband" aria-describedby="pair-note"
          onChange={(e) => {
            const c = cleanCode(e.target.value);
            setV(c);
            if (c.length === 4) onCode(c);
          }} />
        {[0, 1, 2, 3].map((i) => <span key={i} className={'box' + (i === v.length ? ' at' : '')} aria-hidden="true">{v[i] || ''}</span>)}
      </label>
      <span id="pair-note" className="small" role="status" style={{ marginTop: 14, minHeight: 20, color: error ? 'var(--warn)' : undefined }}>
        {error || (pending ? 'check your wrist…'
          : 'letters only — no I, L or O, so nothing looks like something else.')}
      </span>
      <button type="button" className="btn-s pairscan" onClick={onScan}>
        <Icon name="qr_code_scanner" size={20} />SCAN IT INSTEAD
      </button>
      <div className="foot">
        <Ghost onClick={onSkip}>no wristband — use my phone</Ghost>
      </div>
    </div>
  );
}

/** The wristband sheet's body: how full it is, and whether it can hear the relay. */
export const bandLine = (band) => (band
  ? (band.offline ? 'OFFLINE — away for a while' : [band.battery != null ? band.battery + '% battery' : null, band.live ? null : 'not connected right now'].filter(Boolean).join(' · '))
  : '');

/**
 * /band — a stand-in for the M5StickC on the strap, until one is in hand. It
 * joins the relay exactly as the firmware will, draws the same 135 x 240
 * screen at 2x, and has the same one button: a press wakes it for three
 * seconds, a one-second hold is NOT NOW.
 */
export function BandStandIn() {
  // A new wristband every load, as the firmware is every boot: the key stays in this page, and the id is its hash.
  const [band] = useState(() => {
    try { localStorage.removeItem('otb:band-id'); } catch { /* a private window */ }
    const key = toHex(crypto.getRandomValues(new Uint8Array(16)));
    return { key, id: bandIdOf(key) };
  });
  const [battery, setBattery] = useState(62);
  const [show, setShow] = useState(null);
  const [live, setLive] = useState(false);
  const [awake, setAwake] = useState(false);
  const [holding, setHolding] = useState(false);
  const ws = useRef(null);
  const batteryNow = useRef(battery);
  batteryNow.current = battery;

  useEffect(() => {
    let closed = false, retry = null, heard = 0;
    const open = () => {
      const sock = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/api/ws');
      ws.current = sock;
      sock.onopen = () => { heard = Date.now(); setLive(true); sock.send(JSON.stringify({ t: 'wristband', id: band.id, key: band.key, v: 2, battery: batteryNow.current })); };
      sock.onmessage = (e) => { heard = Date.now(); const m = JSON.parse(e.data); if (m.t === 'show') setShow(m.show); };
      sock.onclose = () => { setLive(false); if (!closed) retry = setTimeout(open, 1500); };
    };
    open();
    const beat = setInterval(() => {
      const s = ws.current;
      if (s?.readyState !== 1) return;
      if (Date.now() - heard > 6000) { s.close(); return; }
      s.send('{"t":"ping"}');
    }, 2000);
    return () => { closed = true; clearTimeout(retry); clearInterval(beat); ws.current?.close(); };
  }, [band]);

  useEffect(() => {
    if (ws.current?.readyState === 1) ws.current.send(JSON.stringify({ t: 'battery', level: battery }));
  }, [battery]);

  // One button. A press shows what it is doing for three seconds; held for a second, NOT NOW.
  const timer = useRef(null);
  const held = useRef(false);
  const down = () => {
    held.current = false;
    setHolding(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      held.current = true;
      setHolding(false);
      if (ws.current?.readyState === 1) ws.current.send('{"t":"hold"}');
    }, 1000);
  };
  const up = () => {
    clearTimeout(timer.current);
    setHolding(false);
    if (held.current) return;
    setAwake(true);
    setTimeout(() => setAwake(false), 3000);
  };

  return (
    <div className="standin">
      <div className="strap" aria-hidden="true" />
      <div className="bandbody">
        <BandFace show={show} awake={awake} battery={battery}
          pairAt={show?.kind === 'pairing' ? pairUrl(location.origin, show.code) : null} />
        <button type="button" className={'bandbtn' + (holding ? ' down' : '')} aria-label="Wristband button. Press to wake it, hold for a second for NOT NOW."
          onPointerDown={down} onPointerUp={up} onPointerLeave={() => { if (holding) { clearTimeout(timer.current); setHolding(false); } }}
          onKeyDown={(e) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); down(); } }}
          onKeyUp={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); up(); } }} />
      </div>
      <div className="strap" aria-hidden="true" />
      <div className="operator">
        <span className="label" style={{ color: live ? 'var(--ok)' : 'var(--warn)' }}>{live ? 'on the relay' : 'looking for the relay…'}</span>
        <span className="small">A stand-in for the wristband — the real one is an M5StickC on a strap. Letters: {CODE_LETTERS.length} of them, none that look alike.</span>
        <label className="small" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          battery <input type="range" min="1" max="100" value={battery} onChange={(e) => setBattery(Number(e.target.value))} aria-label="Stand-in battery" />
          <span className="tnum" style={{ color: '#fff', minWidth: 36 }}>{battery}%</span>
        </label>
      </div>
    </div>
  );
}
