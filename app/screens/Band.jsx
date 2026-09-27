import { useEffect, useMemo, useRef, useState } from 'react';
import { BAND_OFF, HUE } from '../copy.js';
import { CODE_LETTERS, cleanCode } from '../../relay/band.js';
import { pairUrl } from '../lib/pairing.js';
import { qrMatrix, qrPath } from '../lib/qr.js';
import { toHex } from '../lib/sha256.js';
import { createSpeaker } from '../lib/speaker.js';
import { FLASH_COLOURS, HOLD_MS, WAKE_MS, createWrist, lit as litFace } from '../lib/wrist.js';
import { createEars, openMicrophone } from '../lib/listen.js';
import { Back, Ghost, Icon } from '../ui.jsx';

/**
 * The wristband's screen: 135 x 240, drawn at any scale. A light first and
 * words second — one colour field and at most two short lines.
 */
export function BandFace({ show, awake, battery, scale = 2, pairAt = null }) {
  const s = show || { kind: 'off' };
  const hue = HUE[s.intent];
  const lit = litFace(s);
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
      {s.kind === 'check' ? (
        <span className="words meet"><span className="small-w">ON YOUR PHONE?</span><span className="num">{s.big}</span></span>
      ) : null}
      {s.kind === 'waiting' ? (
        <span className="words ready"><span className="big">OPEN YOUR PHONE</span><span className="small-w">OR SWITCH ME OFF</span></span>
      ) : null}
      {s.kind === 'off' && awake ? (
        <span className="words ready">
          <span className="big">{s.quiet ? 'NOT NOW' : s.away ? 'OPEN YOUR PHONE' : 'READY'}</span>
          {s.away ? <span className="small-w">TO COME BACK</span>
            : battery !== null && battery !== undefined ? <span className="small-w">{battery}%</span> : null}
        </span>
      ) : null}
    </div>
  );
}

const INK = { ink: '#041418', white: '#FFFFFF', text2: 'var(--text-2)' };

/**
 * What the Wrist says to draw (app/lib/wrist.js face()): one field, two lines,
 * the bar, and letters with their code and the hint under them. A flash's red
 * and orange are flat, as on the band.
 */
export function WristFace({ screen: s, scale = 2, pairAt = null }) {
  const hue = HUE[s.field];
  const bg = s.field === 'white' ? '#FFFFFF'
    : FLASH_COLOURS[s.field] ?? (hue ? `radial-gradient(120% 90% at 50% 38%, ${hue.c} 0%, ${hue.g} 100%)` : '#000000');
  const ink = INK[s.ink] ?? HUE[s.ink]?.c ?? INK.text2;
  // The backlight: dark is off, not a black picture lit from behind.
  const glow = s.light ? Math.max(0.35, s.light / 255) : 0;
  const number = /^\d+$/.test(s.big);
  return (
    // The band changes at once: a fade would blur a 150 ms flash and the meeting's blink.
    <div className="bandface" style={{ width: 135 * scale, height: 240 * scale, '--u': scale + 'px', background: bg, filter: `brightness(${glow})`, transition: 'none' }}
      role="img" aria-label={s.code ? 'Wristband showing its pairing letters ' + s.code.split('').join(' ') + (s.small ? ', ' + s.small : '') : s.light ? 'Wristband: ' + [s.big, s.small].filter(Boolean).join(', ') : 'Wristband dark'}>
      {s.code ? <Pairing code={s.code} at={pairAt} hint={s.small} />
        : number ? <span className="words meet" style={{ color: ink }}><span className="small-w">{s.small}</span><span className="num">{s.big}</span></span>
        : s.big || s.small ? (
          <span className="words" style={{ color: ink }}>
            {s.big ? <span className="big">{s.big}</span> : null}
            {s.small ? <span className="small-w">{s.small}</span> : null}
          </span>
        ) : null}
      {s.corner ? <span className="corner" aria-hidden="true">{s.corner}</span> : null}
      {s.bar >= 0 ? <span className="bandbar" style={{ '--p': s.bar / 99, color: ink }} aria-hidden="true" /> : null}
    </div>
  );
}

/** Pairing: a code to scan over the four letters to type. Either one pairs. A press puts the hint under them. */
function Pairing({ code, at, hint = '' }) {
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
      {hint ? <span className="small-w hint">{hint}</span> : null}
    </span>
  );
}

function faceLabel(s, awake, battery, pairAt) {
  if (s.kind === 'pairing') return 'Wristband showing its pairing letters ' + s.code.split('').join(' ') + (pairAt ? ', and a code to scan' : '');
  if (s.kind === 'test') return 'Wristband flashing white';
  if (s.kind === 'meet') return 'Wristband showing meeting number ' + s.big;
  if (s.kind === 'check') return 'Wristband showing check number ' + s.big;
  if (s.kind === 'waiting') return 'Wristband waiting: open your phone, or switch it off';
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
  ? band.off ? BAND_OFF.line : (band.offline ? 'OFFLINE — away for a while' : [band.battery != null ? band.battery + '% battery' : null, band.live ? null : 'not connected right now'].filter(Boolean).join(' · '))
  : '');

/** What the stand-in says beside LISTEN, by where it stands. */
export const LISTEN_SAY = {
  off: "For a demo: this computer's microphone as the band's, so a lit card pulses on the beat. Off, it pulses nothing.",
  asking: 'Asking this browser for the microphone…',
  on: 'Listening: a lit card pulses on the beat. It hears loudness only, and keeps and sends nothing.',
  failed: "The microphone did not open: this browser refused it, or cannot listen at the band's 16 kHz.",
};

/**
 * /band — a stand-in for the wristband, until one is in hand. The machine is
 * app/lib/wrist.js, the same one band_logic.h runs on the real band and held
 * to the same table; this page only feeds it the socket, the two buttons and
 * the time, draws its face at 2x, and plays its sounds (app/lib/speaker.js).
 * LISTEN, off until turned on, feeds it this computer's microphone as the
 * band's own (app/lib/listen.js), so a lit card pulses on the beat.
 */
export function BandStandIn() {
  // A new wristband every load, as the firmware is every boot: the key stays in this page, and the id is its hash.
  const wrist = useMemo(() => {
    try { localStorage.removeItem('otb:band-id'); } catch { /* a private window */ }
    return createWrist({ key: toHex(crypto.getRandomValues(new Uint8Array(16))) });
  }, []);
  const speaker = useMemo(() => createSpeaker(), []);
  const [battery, setBattery] = useState(62);
  const [screen, setScreen] = useState(() => wrist.face(Date.now()));
  const [live, setLive] = useState(false);
  const [heard, setHeard] = useState(false);
  const [down, setDown] = useState({ 1: false, 2: false });
  const [listen, setListen] = useState('off'); // off, asking, on, or failed
  const ws = useRef(null);
  const flushRef = useRef(() => {});
  const mic = useRef(null); // shuts the microphone
  const asking = useRef(null); // the ask in flight: a newer tap makes it stale

  // A browser lets a page sound only after a tap: the first one anywhere on it lets the band chirp.
  useEffect(() => {
    const unlock = () => { speaker.unlock(); setHeard(speaker.ready()); };
    window.addEventListener('pointerdown', unlock, true);
    window.addEventListener('keydown', unlock, true);
    return () => {
      window.removeEventListener('pointerdown', unlock, true);
      window.removeEventListener('keydown', unlock, true);
    };
  }, [speaker]);

  useEffect(() => {
    let closed = false, retry = null;
    // What the Wrist says to send goes out, a drop drops the socket, the newest sound due plays, as on the band,
    // and the face is drawn again.
    const flush = () => {
      for (const f of wrist.take()) {
        if (f === 'SETUP') continue;  // the band's Wi-Fi setup: the stand-in has none
        if (f === 'DROP') ws.current?.close();
        else if (ws.current?.readyState === 1) ws.current.send(f);
      }
      const due = wrist.sounds();
      if (due.length) speaker.play(due[due.length - 1]);
      setHeard(speaker.ready());
      setScreen(wrist.face(Date.now()));
    };
    flushRef.current = flush;
    const open = () => {
      const sock = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/api/ws');
      ws.current = sock;
      sock.onopen = () => { if (ws.current === sock) { setLive(true); wrist.linkUp(Date.now()); flush(); } };
      sock.onmessage = (e) => { if (ws.current === sock) { wrist.frame(String(e.data), Date.now()); flush(); } };
      sock.onclose = () => {
        if (ws.current !== sock) return;
        ws.current = null;
        setLive(false);
        wrist.linkDown(Date.now());
        flush();
        if (!closed) retry = setTimeout(open, 1500);
      };
    };
    open();
    const beat = setInterval(() => { wrist.tick(Date.now()); flush(); }, 50);
    return () => { closed = true; clearTimeout(retry); clearInterval(beat); const s = ws.current; ws.current = null; s?.close(); };
  }, [wrist, speaker]);

  useEffect(() => {
    wrist.setBattery(battery, Date.now());
    if (ws.current?.readyState === 1) ws.current.send(JSON.stringify({ t: 'battery', level: battery }));
  }, [wrist, battery]);

  // LISTEN: the browser is asked for the microphone only on the tap that turns it on, and a second tap shuts it,
  // or forgets an ask still in flight.
  const flipListen = async () => {
    if (mic.current || asking.current) {
      mic.current?.();
      mic.current = null;
      asking.current = null;
      setListen('off');
      return;
    }
    const ask = {};
    asking.current = ask;
    setListen('asking');
    const ears = createEars((levels, t) => wrist.hear(levels, t));
    try {
      const shut = await openMicrophone((floats, at) => ears.take(floats, at));
      if (asking.current !== ask) { shut(); return; }
      mic.current = shut;
      setListen('on');
    } catch {
      if (asking.current === ask) setListen('failed');
    } finally {
      if (asking.current === ask) asking.current = null;
    }
  };
  useEffect(() => () => { mic.current?.(); mic.current = null; asking.current = null; }, []);
  // Listening, the face is drawn every frame, so a pulse falls smoothly rather than in the beat's 50 ms steps.
  useEffect(() => {
    if (listen !== 'on') return undefined;
    let frame = requestAnimationFrame(function draw() {
      setScreen(wrist.face(Date.now()));
      frame = requestAnimationFrame(draw);
    });
    return () => cancelAnimationFrame(frame);
  }, [listen, wrist]);

  const key = (k, isDown) => {
    (isDown ? wrist.keyDown : wrist.keyUp)(k, Date.now());
    setDown((d) => ({ ...d, [k]: isDown }));
    flushRef.current();  // a press's tick now, not at the next beat
  };
  const handlers = (k) => ({
    // The press counts first; capture only keeps the let-go on this button, and throws for a pointer that is not active.
    onPointerDown: (e) => {
      key(k, true);
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* not an active pointer */ }
    },
    onPointerUp: () => key(k, false),
    onPointerCancel: () => key(k, false),
    onKeyDown: (e) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); key(k, true); } },
    onKeyUp: (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); key(k, false); } },
  });
  const hold = HOLD_MS / 1000 + ' s';
  const wake = WAKE_MS / 1000 + ' s';

  return (
    <div className="standin">
      <div className="strap" aria-hidden="true" />
      <div className="bandbody">
        <div className="bandrow">
          <WristFace screen={screen} pairAt={screen.code ? pairUrl(location.origin, screen.code) : null} />
          <button type="button" className={'bandside' + (down[2] ? ' down' : '')} {...handlers(2)}
            aria-label={'Side button. Press to see your card, press again to change it; hold ' + hold + ' to send it now, or to come back from NOT NOW.'}>SIDE</button>
        </div>
        <button type="button" className={'bandbtn' + (down[1] ? ' down' : '')} {...handlers(1)}
          aria-label={'Face button. Press to wake it for ' + wake + '; hold ' + hold + ' for NOT NOW.'} />
      </div>
      <div className="strap" aria-hidden="true" />
      <div className="operator">
        <span className="label" style={{ color: live ? 'var(--ok)' : 'var(--warn)' }}>{live ? 'on the relay' : 'looking for the relay…'}</span>
        <span className="small">
          A stand-in for the wristband — the real one is an M5StickC Plus or a StickS3 on a strap. The face button wakes
          it for {wake}; hold it {hold} for NOT NOW, or, on a check number you did not ask for, to turn that
          check away. SIDE shows your card, and more presses change it.
          Letters: {CODE_LETTERS.length} of them, none that look alike.
        </span>
        <span className="small" role="status">
          {heard ? 'It chirps as the band does, unless its sound is off or it is in NOT NOW.'
            : 'Silent until this page is tapped: a browser lets a page make sound only after a tap.'}
        </span>
        <span className="small" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button type="button" className="btn-s" onClick={flipListen} aria-pressed={listen === 'on'}>
            {listen === 'on' ? 'LISTEN: ON' : listen === 'asking' ? 'LISTEN: ASKING…' : 'LISTEN: OFF'}
          </button>
          <span role="status">{LISTEN_SAY[listen]}</span>
        </span>
        <label className="small" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          battery <input type="range" min="1" max="100" value={battery} onChange={(e) => setBattery(Number(e.target.value))} aria-label="Stand-in battery" />
          <span className="tnum" style={{ color: '#fff', minWidth: 36 }}>{battery}%</span>
        </label>
      </div>
    </div>
  );
}
