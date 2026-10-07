// The phone's own hardware, each piece optional. Every one of these is missing
// on some phone, and the app works without all of them.

/** Keeps the screen on while the phone is the light. Returns a release. */
export function holdScreen() {
  let lock = null;
  let on = true;
  const take = async () => {
    if (!on || document.visibilityState !== 'visible' || !navigator.wakeLock) return;
    try { lock = await navigator.wakeLock.request('screen'); } catch { lock = null; }
  };
  const again = () => { if (document.visibilityState === 'visible') take(); };
  take();
  document.addEventListener('visibilitychange', again);
  return () => {
    on = false;
    document.removeEventListener('visibilitychange', again);
    lock?.release().catch(() => {});
  };
}

/** Battery level 0..1 and whether it is charging, or null where the phone will not say. */
export async function battery() {
  try {
    const b = await navigator.getBattery?.();
    return b ? { level: b.level, charging: b.charging } : null;
  } catch {
    return null;
  }
}

export const buzz = (pattern) => { try { navigator.vibrate?.(pattern); } catch { /* no motor */ } };

export const reducedMotion = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * The first recording format this browser can make, H.264 in MP4 first: every phone plays it, where an iPhone may not
 * play a WebM an Android phone made. Chrome on Android records MP4 now; an older one still makes WebM.
 */
export const CLIP_TYPES = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp8', 'video/webm'];
export function clipType() {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const t of CLIP_TYPES) {
    try { if (MediaRecorder.isTypeSupported(t)) return t; } catch { /* keep looking */ }
  }
  return null;
}

export const toBase64 = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',')[1] || '');
  r.onerror = () => reject(r.error);
  r.readAsDataURL(blob);
});
