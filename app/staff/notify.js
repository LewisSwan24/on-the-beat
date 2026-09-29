// ON THE BEAT — a staff device's notifications, in words (docs/superpowers/specs/2026-09-29-staff-push-design.md
// §1): where this browser starts, what the line under the header says, and the relay's key as bytes. Pure, so
// they are tested without a browser.

/** The tag every report notification carries (public/staff-sw.js): a newer one replaces the older. */
export const NOTICE_TAG = 'otb-reports';

/** The line under the header, for each state; 'off' is the button's. */
export const NOTIFY_WORDS = {
  off: 'NOTIFY THIS DEVICE',
  asking: 'Turning on…',
  on: 'Notifications on for this device.',
  install: 'To get notifications on iPhone: Share, then Add to Home Screen, and open Staff from there.',
  blocked: 'Notifications are blocked for this page. Allow them in the browser\'s settings to get them here.',
  none: 'This browser can\'t show notifications. Keep this page open to hear new reports.',
  refused: 'This browser\'s notifications can\'t be used here.',
};

/**
 * Where a signed-in device starts. 'install' is an iPhone in Safari, which has Web Push only from the Home Screen;
 * 'none' is a browser with no Web Push; 'blocked' is a device whose permission was refused. Anything else is 'off',
 * the button, and a device that turned them on before goes on by itself once signed in.
 */
export function startState({ secure, sw, push, standalone, permission }) {
  if (standalone === false && !push) return 'install';
  if (!secure || !sw || !push) return 'none';
  if (permission === 'denied') return 'blocked';
  return 'off';
}

/** base64url to bytes, as pushManager.subscribe() takes the relay's key. */
export function fromB64u(s) {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** Was this subscription made with the relay's key? One made under another key is made again. */
export function sameKey(sub, key) {
  const k = sub?.options?.applicationServerKey;
  if (!k || !key) return false;
  const a = new Uint8Array(k);
  const b = fromB64u(key);
  return a.length === b.length && a.every((x, i) => x === b[i]);
}
