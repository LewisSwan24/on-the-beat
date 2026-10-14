import { useEffect, useRef, useState } from 'react';
import { someone } from '../copy.js';
import { clipType } from '../lib/device.js';
import { PHOTO_QUALITY, PHOTO_SIDE, POSES, isJpeg, nextPose } from '../lib/pose.js';
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
  const [mode, setMode] = useState('video');           // video | photo
  const [pose, setPose] = useState(() => nextPose(-1));
  const [count, setCount] = useState(0);                // 3, 2, 1 before a photo; 0 when not counting
  const [failed, setFailed] = useState(false);          // this browser could not make a JPEG
  const [taking, setTaking] = useState(false);          // from the shutter until the photo is in hand, or is not
  const [canRecord, setCanRecord] = useState(true);     // a phone with a camera but no recorder can still pose
  const counter = useRef(null);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; clearInterval(counter.current); }, []);

  // One frame of the live stream, not mirrored, long side at most PHOTO_SIDE, as a JPEG.
  const snap = () => {
    const v = live.current;
    const fail = () => { setTaking(false); setFailed(true); };
    if (!v || !v.videoWidth) { fail(); return; }   // no frame yet: say so, never nothing
    const k = Math.min(1, PHOTO_SIDE / Math.max(v.videoWidth, v.videoHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(v.videoWidth * k);
    c.height = Math.round(v.videoHeight * k);
    c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
    c.toBlob((blob) => {
      if (!alive.current) return;   // left while it was being made: nothing to show, nothing to free
      if (!isJpeg(blob)) { fail(); return; }
      setTaking(false);
      setClip({ blob, url: URL.createObjectURL(blob), type: 'image/jpeg', photo: true });
    }, 'image/jpeg', PHOTO_QUALITY);
  };
  // The shutter stays held from the first tap until the photo is in hand: toBlob can take a while after the count.
  const shoot = () => {
    if (taking || cam !== 'ready') return;
    setFailed(false);
    setTaking(true);
    setCount(3);
    let n = 3;
    clearInterval(counter.current);
    counter.current = setInterval(() => {
      n -= 1;
      setCount(n);
      if (n === 0) { clearInterval(counter.current); snap(); }
    }, 1000);
  };

  const start = async () => {
    setCam('starting');
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 480 }, height: { ideal: 640 } }, audio: false });
      stream.current = s;
      if (live.current) { live.current.srcObject = s; live.current.play().catch(() => {}); }
      // A camera is enough for a pose; only the five seconds need a recorder.
      const records = !!clipType();
      setCanRecord(records);
      if (!records) setMode('photo');
      setCam('ready');
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
    if (recording || !stream.current || cam !== 'ready' || !canRecord) return;
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

  const again = () => { clearInterval(counter.current); setTaking(false); setClip(null); setMs(0); setCount(0); };
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
      {clip?.photo ? <img key={clip.url} src={clip.url} alt="Your pose" /> : null}
      {clip && !clip.photo ? <video key={clip.url} src={clip.url} muted playsInline autoPlay loop aria-label="Your five seconds, looping" /> : null}
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
            <div className="seg" role="group" aria-label="Video or photo">
              <button type="button" aria-pressed={mode === 'video'} disabled={recording || taking || !canRecord} onClick={() => setMode('video')}>VIDEO</button>
              <button type="button" aria-pressed={mode === 'photo'} disabled={recording || taking} onClick={() => setMode('photo')}>PHOTO</button>
            </div>
            {cam === 'none' ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, textAlign: 'center' }}>
                <span className="h2">The camera's off.</span>
                <span className="small">allow the camera for this page to dance or pose. nothing is sent until you send it.</span>
                <button type="button" className="btn-s" style={{ '--c': 'var(--dance)', '--f': 'var(--dance)' }} onClick={start}>TRY AGAIN</button>
              </div>
            ) : mode === 'photo' ? (
              <>
                <button type="button" className="pose" onClick={() => setPose((p) => nextPose(p))} disabled={taking}
                  aria-label={'Pose: ' + POSES[pose] + ' Tap for another.'}>
                  <span className="h2">{POSES[pose]}</span>
                  <span className="small">tap for another</span>
                </button>
                {/* One line that is always there, so a screen reader hears it change: the failure takes its place. */}
                <span className="small" role="status">
                  {failed ? 'this phone could not take the photo.' + (canRecord ? ' try the video.' : '')
                    : taking ? 'hold it…' : backTo ? 'one pose, straight back to them.' : 'one pose. three seconds to get ready.'}
                </span>
              </>
            ) : (
              <span className="small">{!canRecord ? "this phone can't record video. take a photo instead." : recording ? 'hold the phone still' : backTo ? 'five seconds, straight back to them.' : 'five seconds. no sound needed.'}</span>
            )}
            {mode === 'photo' ? (
              <button type="button" className="rec" onClick={shoot} disabled={cam !== 'ready' || taking} aria-label="Take a photo in three seconds">
                <span className="ring" style={{ background: 'rgba(255,255,255,.22)' }} />
                <span className="hole" />
                <span className="core" style={{ width: 62, height: 62, borderRadius: 31 }} />
              </button>
            ) : (
              <button type="button" className="rec" onClick={record} disabled={cam !== 'ready' || recording || !canRecord} aria-label="Record five seconds">
                <span className="ring" style={{ background: `conic-gradient(var(--dance) ${deg}deg, rgba(255,255,255,.22) 0deg)` }} />
                <span className="hole" />
                <span className="core" style={{ width: core, height: core, borderRadius: recording ? 8 : 31 }} />
              </button>
            )}
            <span className="tnum" aria-live="polite" style={{ font: 'var(--num)', color: 'var(--text-2)', minHeight: 18 }}>
              {mode === 'photo' ? (count ? count + '' : '') : recording ? Math.ceil((CLIP_MS - ms) / 1000) + 's' : ''}
            </span>
          </div>
        ) : (
          <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 12, animation: 'ob-fadeup var(--base) var(--ease)' }}>
            <div className="label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, color: 'var(--dance)' }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--dance)', animation: 'ob-blink 1.6s var(--ease-io) infinite' }} />
              {clip.photo ? 'your pose' : '5 seconds · looping'}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <Cta hue="dance" onClick={send} disabled={sending}>{backTo ? 'SEND IT BACK' : 'SEND TO THE FLOOR'}</Cta>
              {backTo
                ? <Ghost onClick={onNotThis}>Not this one</Ghost>
                : <Ghost onClick={() => onKeep(clip.blob, clip.type)}>Just for me</Ghost>}
              <button type="button" className="ghost" style={{ height: 40, font: 'var(--body-s)' }} onClick={again}>{clip.photo ? 'Take another' : 'Record again'}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** A floor item: a photo is drawn as one; anything else is the looping five seconds. */
function Media({ kind, ...rest }) {
  return kind === 'photo'
    ? <img {...rest} alt={rest['aria-label'] ?? ''} />
    : <video {...rest} muted loop autoPlay playsInline />;
}

/** S10 — the floor: five seconds or a pose each, and one sent to you comes first. */
export function Floor({ floor, mine, mineKind, room, onBack, onTile }) {
  const [gone, setGone] = useState({});
  const tiles = floor.filter((c) => !gone[c.ref]);
  const src = (ref) => '/clip/' + encodeURIComponent(room) + '/' + ref;
  return (
    <div className="scr">
      <Back onClick={onBack} />
      <h1 className="h1" style={{ margin: '6px 0 4px' }}>The floor</h1>
      <span className="small" style={{ marginBottom: 14 }}>five seconds each, or a pose. no sound needed.</span>
      {tiles.length === 0 && !mine ? (
        <div className="empty">
          <span className="h2">The floor's empty.</span>
          <span className="body muted">Five seconds of you, or one pose, gets it going.</span>
        </div>
      ) : null}
      <div className="floor">
        {mine && !gone[mine] ? (
          <div className="tile" style={{ borderColor: 'var(--dance)' }}>
            <Media kind={mineKind} src={src(mine)} aria-label={mineKind === 'photo' ? 'Your pose, on the floor' : 'Your five seconds, on the floor'}
              onError={() => setGone((g) => ({ ...g, [mine]: true }))} />
            <span className="cap">
              <span className="small" style={{ color: 'var(--dance)', textAlign: 'left' }}>you · on the floor for an hour</span>
            </span>
          </div>
        ) : null}
        {tiles.map((c) => (
          <button key={c.ref} type="button" className={'tile' + (c.toYou ? ' to-you' : '')} onClick={() => onTile(c)}
            aria-label={c.toYou ? someone(c.band) + ' danced back to you' : someone(c.band)}>
            <Media kind={c.kind} src={src(c.ref)} aria-hidden="true"
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

