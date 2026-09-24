import { useEffect, useRef, useState } from 'react';
import { someone } from '../copy.js';
import { clipType } from '../lib/device.js';
import { Back, Cta, Ghost, Pill } from '../ui.jsx';

const CLIP_MS = 5000;

/**
 * S9 — five seconds of you dancing, no sound. For the floor, or straight back
 * to one person who danced where you could see.
 */
export function Camera({ act, onAir, backTo, onBack, onSend, onKeep, onNotThis }) {
  const live = useRef(null);
  const stream = useRef(null);
  const rec = useRef(null);
  const tick = useRef(null);
  const [cam, setCam] = useState('starting');   // starting | ready | none
  const [ms, setMs] = useState(0);
  const [recording, setRecording] = useState(false);
  const [clip, setClip] = useState(null);       // { blob, url, type }
  const [sending, setSending] = useState(false);

  const start = async () => {
    setCam('starting');
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 480 }, height: { ideal: 640 } }, audio: false });
      stream.current = s;
      if (live.current) { live.current.srcObject = s; live.current.play().catch(() => {}); }
      setCam(clipType() ? 'ready' : 'none');
    } catch {
      setCam('none');
    }
  };

  useEffect(() => {
    start();
    return () => {
      clearInterval(tick.current);
      if (rec.current?.state === 'recording') { rec.current.onstop = null; rec.current.stop(); }
      stream.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  useEffect(() => () => clip && URL.revokeObjectURL(clip.url), [clip]);

  const record = () => {
    if (recording || !stream.current || cam !== 'ready') return;
    const type = clipType();
    const chunks = [];
    const r = new MediaRecorder(stream.current, { mimeType: type, videoBitsPerSecond: 600_000 });
    rec.current = r;
    r.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    r.onstop = () => {
      const blob = new Blob(chunks, { type: type.split(';')[0] });
      setRecording(false);
      setMs(CLIP_MS);
      setClip({ blob, url: URL.createObjectURL(blob), type });
    };
    const t0 = performance.now();
    clearInterval(tick.current);
    tick.current = setInterval(() => {
      const t = performance.now() - t0;
      setMs(Math.min(CLIP_MS, t));
      if (t >= CLIP_MS) { clearInterval(tick.current); if (r.state === 'recording') r.stop(); }
    }, 50);
    setRecording(true);
    setMs(0);
    r.start(250);
  };

  const again = () => { setClip(null); setMs(0); };
  const send = async () => {
    if (!clip || sending) return;
    setSending(true);
    try { await onSend(clip.blob, clip.type); } finally { setSending(false); }
  };

  const deg = Math.round((ms / CLIP_MS) * 360);
  const core = recording ? 30 : 62;

  return (
    <div className="cam">
      <div className="dark" />
      <video ref={live} className="mirror" muted playsInline autoPlay aria-hidden="true"
        style={{ visibility: cam === 'ready' && !clip ? 'visible' : 'hidden' }} />
      {clip ? <video key={clip.url} src={clip.url} muted playsInline autoPlay loop aria-label="Your five seconds, looping" /> : null}
      {clip ? <div className="sheen" aria-hidden="true"><i /></div> : null}
      <div className="shade" />

      <div className="top">
        <Back onClick={onBack} />
        <span className="now">
          <Pill track={act} artist={onAir ? 'on now' : 'tonight'} hue="dance" />
        </span>
      </div>

      <div className="bottom">
        {!clip ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
            {cam === 'none' ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, textAlign: 'center' }}>
                <span className="h2">The camera's off.</span>
                <span className="small">allow the camera for this page to dance. nothing is sent until you send it.</span>
                <button type="button" className="btn-s" style={{ '--c': 'var(--dance)', '--f': 'var(--dance)' }} onClick={start}>TRY AGAIN</button>
              </div>
            ) : (
              <span className="small">{recording ? 'hold the phone still' : backTo ? 'five seconds, straight back to them.' : 'five seconds. no sound needed.'}</span>
            )}
            <button type="button" className="rec" onClick={record} disabled={cam !== 'ready' || recording} aria-label="Record five seconds">
              <span className="ring" style={{ background: `conic-gradient(var(--dance) ${deg}deg, rgba(255,255,255,.22) 0deg)` }} />
              <span className="hole" />
              <span className="core" style={{ width: core, height: core, borderRadius: recording ? 8 : 31 }} />
            </button>
            <span className="tnum" aria-live="polite" style={{ font: 'var(--num)', color: 'var(--text-2)', minHeight: 18 }}>
              {recording ? Math.ceil((CLIP_MS - ms) / 1000) + 's' : ''}
            </span>
          </div>
        ) : (
          <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 12, animation: 'ob-fadeup var(--base) var(--ease)' }}>
            <div className="label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, color: 'var(--dance)' }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--dance)', animation: 'ob-blink 1.6s var(--ease-io) infinite' }} />
              5 seconds · looping
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <Cta hue="dance" onClick={send} disabled={sending}>{backTo ? 'SEND IT BACK' : 'SEND TO THE FLOOR'}</Cta>
              {backTo
                ? <Ghost onClick={onNotThis}>Not this one</Ghost>
                : <Ghost onClick={() => onKeep(clip.blob, clip.type)}>Just for me</Ghost>}
              <button type="button" className="ghost" style={{ height: 40, font: 'var(--body-s)' }} onClick={again}>Record again</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** S10 — the floor: five seconds each, and one sent to you comes first. */
export function Floor({ floor, mine, room, onBack, onTile }) {
  const [gone, setGone] = useState({});
  const tiles = floor.filter((c) => !gone[c.ref]);
  const src = (ref) => '/clip/' + encodeURIComponent(room) + '/' + ref;
  return (
    <div className="scr">
      <Back onClick={onBack} />
      <h1 className="h1" style={{ margin: '6px 0 4px' }}>The floor</h1>
      <span className="small" style={{ marginBottom: 14 }}>five seconds each, no sound needed.</span>
      {tiles.length === 0 && !mine ? (
        <div className="empty">
          <span className="h2">The floor's empty.</span>
          <span className="body muted">Five seconds of you gets it going.</span>
        </div>
      ) : null}
      <div className="floor">
        {mine && !gone[mine] ? (
          <div className="tile" style={{ borderColor: 'var(--dance)' }}>
            <video src={src(mine)} muted loop autoPlay playsInline aria-label="Your five seconds, on the floor"
              onError={() => setGone((g) => ({ ...g, [mine]: true }))} />
            <span className="cap">
              <span className="small" style={{ color: 'var(--dance)', textAlign: 'left' }}>you · on the floor for an hour</span>
            </span>
          </div>
        ) : null}
        {tiles.map((c) => (
          <button key={c.ref} type="button" className={'tile' + (c.toYou ? ' to-you' : '')} onClick={() => onTile(c)}
            aria-label={c.toYou ? someone(c.band) + ' danced back to you' : someone(c.band)}>
            <video src={src(c.ref)} muted loop autoPlay playsInline aria-hidden="true"
              onError={() => setGone((g) => ({ ...g, [c.ref]: true }))} />
            <span className="cap">
              <span className="dot" aria-hidden="true" style={{ '--c': 'var(--dance)', '--g': 'var(--dance-g)', width: 8, height: 8 }} />
              <span className="small" style={{ color: c.toYou ? 'var(--dance)' : '#fff', textAlign: 'left' }}>
                {c.toYou ? 'danced back to you' : c.dancedBack ? 'you danced back' : someone(c.band)}
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

