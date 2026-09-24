import { useEffect, useRef, useState } from 'react';
import { buzz } from '../lib/device.js';
import { codeFrom } from '../lib/pairing.js';
import { Back, Ghost } from '../ui.jsx';

/**
 * What reads a QR code here: the browser's own detector where it has one
 * (Chrome on Android), and jsQR everywhere else — loaded only then, so a phone
 * that never scans never downloads it.
 */
async function reader() {
  if (typeof BarcodeDetector !== 'undefined') {
    try {
      if ((await BarcodeDetector.getSupportedFormats()).includes('qr_code')) {
        const detector = new BarcodeDetector({ formats: ['qr_code'] });
        return async (video) => (await detector.detect(video))[0]?.rawValue ?? null;
      }
    } catch { /* no detector after all */ }
  }
  const mod = await import('jsqr');
  const jsQR = typeof mod.default === 'function' ? mod.default : mod.default.default;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  return async (video) => {
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) return null;
    // At most 640 across: plenty for a code held a hand's width away, and quick to read.
    const k = Math.min(1, 640 / Math.max(w, h));
    canvas.width = Math.round(w * k);
    canvas.height = Math.round(h * k);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' })?.data ?? null;
  };
}

const SAY = {
  starting: 'opening the camera…',
  looking: 'looking for the code on its screen.',
  wrong: 'that’s a code, but not a wristband’s.',
};

/** S2c — pair by pointing the phone at the wristband's screen. */
export function Scan({ onCode, onType, onBack }) {
  const video = useRef(null);
  const [state, setState] = useState('starting');

  useEffect(() => {
    let stream = null;
    let done = false;
    let timer = null;
    let calm = null;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false,
        });
      } catch {
        if (!done) setState('off');
        return;
      }
      if (done) { stream.getTracks().forEach((t) => t.stop()); return; }
      const v = video.current;
      v.srcObject = stream;
      await v.play().catch(() => {});
      const read = await reader().catch(() => null);
      if (done) return;
      if (!read) { setState('off'); return; }
      setState('looking');
      const look = async () => {
        if (done) return;
        const text = await read(v).catch(() => null);
        if (done) return;
        if (text) {
          const code = codeFrom(text);
          if (code) { done = true; buzz(40); onCode(code); return; }
          setState('wrong');
          clearTimeout(calm);
          calm = setTimeout(() => setState((s) => (s === 'wrong' ? 'looking' : s)), 1600);
        }
        timer = setTimeout(look, 150);
      };
      look();
    })();
    return () => {
      done = true;
      clearTimeout(timer);
      clearTimeout(calm);
      stream?.getTracks().forEach((t) => t.stop());
    };
    // The camera opens once per visit; onCode is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="scr tall">
      <Back onClick={onBack} />
      <h1 className="h1" style={{ marginBottom: 6 }}>Scan your wristband</h1>
      <span className="body muted">Hold it a hand’s width from the camera.</span>
      <div className="viewfinder">
        <video ref={video} playsInline muted aria-hidden="true" />
        {state === 'off' ? (
          <div className="off">
            <span className="h2">The camera’s off.</span>
            <span className="small">
              {window.isSecureContext
                ? 'allow the camera for this page, or type the letters instead.'
                : 'a page on plain http can’t use it. type the letters instead.'}
            </span>
          </div>
        ) : <span className="aim" aria-hidden="true" />}
      </div>
      <span className="small" role="status" style={{ marginTop: 14, minHeight: 20, color: state === 'wrong' ? 'var(--warn)' : undefined }}>
        {SAY[state] || ''}
      </span>
      <div className="foot">
        <Ghost onClick={onType}>type the letters instead</Ghost>
      </div>
    </div>
  );
}
