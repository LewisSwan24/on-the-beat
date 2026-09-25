// ON THE BEAT — the wristband's own logic, for the stand-in at /band.
//
// The same machine as the `Wrist` class in firmware/src/band_logic.h, line
// for line: it takes key downs and ups, the link coming and going, the
// relay's frames and the time, and gives back the frames to send and the
// face to draw. tests/fixtures/wrist-cases.json is run against both, so the
// stand-in and the real wristband cannot drift apart.
//
// KEY1 is the face button: a press wakes the face for WAKE_MS, a hold of
// HOLD_MS is NOT NOW. KEY2 is the side button: the first press shows what is
// armed, each press after moves a preview, and the choice is sent COMMIT_MS
// after the last press, or at once on a KEY2 hold. Leaving NOT NOW takes a
// KEY2 hold. The relay decides; the wrist only says what was chosen, and from
// which state (`basis`), and shows SET, CHANGED or NOT SENT by what comes back.
//
// It also reacts, in sound and light (docs/superpowers/specs/
// 2026-09-25-wrist-reactions-design.md). Each input is one moment, and its
// reaction replaces the one playing. sounds() gives the names of the sounds
// due to start since it was last asked.

import { bandIdOf } from './sha256.js';

export const WAKE_MS = 6000;           // a KEY1 press shows the face this long
export const HOLD_MS = 1500;           // held this long: NOT NOW on KEY1, "send now" on KEY2
export const BAR_MS = 300;             // a KEY1 hold shows KEEP HOLDING from here
export const CHOOSE_MS = 6000;         // longest wait for the next KEY2 press before a choice is dropped
export const COMMIT_MS = 3000;         // after the last KEY2 step, the choice is sent (not from NOT NOW)
export const CONFIRM_MS = 10000;       // longest wait for the relay to show a sent choice
export const RESULT_MS = 3000;         // SET / NOT SENT / CHANGED stays on the face this long
export const PING_EVERY_MS = 2000;     // ask the relay this often...
export const DEAF_MS = 6000;           // ...and take this much silence as a dead socket
export const STALE_MS = 10000;         // out of reach this long, what the relay last said is not shown
export const QUIET_CONFIRM_MS = 3000;  // NOT NOW stays dark at least until the relay answers, or this long

export const LIGHT_FULL = 255;
export const LIGHT_DIM = 128;
export const LIGHT_PAIR = 160;
export const LIGHT_AWAKE = 110;
export const LIGHT_OFF = 0;

/** The words each card shows, as relay/band.js bandShow() sends them. */
export const CARD_WORDS = { hi: 'HI :)', song: 'FIRST SONG?', dance: "LET'S DANCE!" };
const ORDER = ['hi', 'song', 'dance', 'off'];
const LIT = ['hi', 'song', 'dance', 'meet'];

/** Every constant above, by name: the fixtures' times are written in these. */
export const CONSTS = {
  WAKE_MS, HOLD_MS, BAR_MS, CHOOSE_MS, COMMIT_MS, CONFIRM_MS, RESULT_MS, PING_EVERY_MS, DEAF_MS,
  STALE_MS, QUIET_CONFIRM_MS, LIGHT_FULL, LIGHT_DIM, LIGHT_PAIR, LIGHT_AWAKE, LIGHT_OFF, CARD_WORDS,
};

/** Every sound the wrist makes, as notes: [Hz, ms], 0 Hz a rest. band_logic.h SOUNDS is the same table. */
export const SOUNDS = {
  tick: [[1800, 25]],
  double: [[1800, 25], [0, 60], [1800, 25]],
  down: [[1047, 90], [784, 180]],
  up: [[1047, 70], [1319, 70], [1568, 70], [2093, 140]],
  fall: [[1568, 100], [1047, 200]],
  low: [[784, 120], [523, 220]],
  ask: [[1319, 80], [0, 50], [1760, 160]],
  jingle: [[1319, 80], [1568, 80], [2637, 80], [2093, 80], [2349, 80], [3136, 200]],
  warn: [[880, 150], [698, 150], [880, 150], [698, 150]],
};

/** Every flash: its colour, then count × on / off ms. `card` is the card chosen, white for OFF. band_logic.h FLASHES. */
export const FLASHES = {
  set: { colour: 'card', count: 2, on: 150, off: 100 },
  changed: { colour: 'red', count: 3, on: 120, off: 90 },
  notsent: { colour: 'orange', count: 2, on: 350, off: 250 },
  warn: { colour: 'orange', count: 2, on: 350, off: 250 },
  check: { colour: 'white', count: 2, on: 150, off: 100 },
};

const soundMs = (name) => (name ? SOUNDS[name].reduce((ms, [, len]) => ms + len, 0) : 0);
const flashMs = (f) => (f ? f.count * (f.on + f.off) : 0);

/** A relay show, read the way band_logic.h readFrame() reads it: wrong types fall back to defaults. */
function readShow(s) {
  const str = (v) => (typeof v === 'string' ? v : '');
  return {
    kind: str(s.kind) || 'off', intent: str(s.intent), big: str(s.big), small: str(s.small), code: str(s.code),
    dim: s.dim === true, quiet: s.quiet === true, away: s.away === true,
    hasArmed: 'armed' in s && (s.armed === null || typeof s.armed === 'string'),
    armed: typeof s.armed === 'string' ? s.armed : '',
    rev: Number.isInteger(s.rev) ? s.rev : 0,
  };
}

const lit = (s) => LIT.includes(s.kind) && !!CARD_WORDS[s.intent];
const words = (big, small, field, ink, light) => ({ big, small, field, ink, light, bar: -1, code: '' });

export function createWrist({ key }) {
  const id = bandIdOf(key);
  let secret = '';
  let battery = -1;
  let wifi = true;
  const link = { up: false, ever: false, heard: 0, asked: 0, lost: 0 };
  let show = null;
  const quiet = { pending: false, sent: false, at: 0 };
  let wakeUntil = 0;
  const k1 = { down: false, since: 0, fired: false };
  const k2 = { down: false, since: 0, fired: false };
  let mode = 'rest';          // rest | look | choosing | sending | result
  let preview = '';           // hi | song | dance | off
  let fromQuiet = false;
  let frozen = false;
  let stepAt = 0, basis = 0, sentAt = 0, resultUntil = 0;
  let choice = '';            // what was sent: a card, or '' for off
  let word = '';
  let out = [];
  // Reactions (rule 6): this input's, and the one playing.
  let moment = [];
  let playing = null;         // { sound, flash, cls, audible, at, until }
  let due = [];               // sounds started since sounds() was last asked

  const send = (m) => out.push(JSON.stringify(m));
  const stale = (now) => !link.up && (!link.ever || now - link.lost >= STALE_MS);
  const personal = () => !!show && show.hasArmed;
  const current = () => (quiet.pending || show?.quiet ? 'notnow' : show?.armed || 'off');
  const pct = () => (battery >= 0 ? battery + '%' : '');

  /** A reaction of this moment. cls: 0 a key or a result, 1 a call, 2 a warning. */
  function react(sound, flash = null, cls = 0) {
    moment.push({ sound, flash, cls, audible: true });
  }

  function start(r, at) {
    playing = { ...r, at, until: at + Math.max(soundMs(r.sound), flashMs(r.flash)) };
    if (r.sound && r.audible) due.push(r.sound);
  }

  /** The end of a moment: its reaction replaces the one playing. */
  function settle(now) {
    if (!moment.length) return;
    const first = moment[0];
    moment = [];
    start(first, now);
  }

  /** A reaction is over once its sound and its flash are. */
  function advance(now) {
    if (playing && now >= playing.until) playing = null;
  }

  function noSignal() {
    const why = wifi ? 'NO RELAY' : 'NO WI-FI';
    return words('NO SIGNAL', pct() ? why + ' - ' + pct() : why, 'black', 'text2', LIGHT_AWAKE);
  }

  function rest() {
    mode = 'rest';
    frozen = false;
    preview = '';
    word = '';
  }

  function closed(now) {
    if (link.up) link.lost = now;
    link.up = false;
    quiet.sent = false;
  }

  function hold(now) {
    quiet.pending = true;
    quiet.sent = false;
    rest();
    wakeUntil = now;
    react('down');
  }

  function result(now, w) {
    mode = 'result';
    word = w;
    resultUntil = now + RESULT_MS;
    preview = '';
    frozen = false;
  }

  /** `held`: a KEY2 hold sends it at once, and says so with a double tick, except from NOT NOW, which is silent. */
  function commit(now, held = false) {
    if (frozen) return;
    if (preview === current() || !link.up) { rest(); return; }
    const silent = current() === 'notnow';
    choice = preview === 'off' ? '' : preview;
    send({ t: 'set', intent: choice || null, basis });
    mode = 'sending';
    sentAt = now;
    if (held && !silent) react('double');
  }

  function step(now) {
    if (k1.down || frozen || mode === 'sending') return;
    if (mode === 'result') rest();
    if (mode === 'rest') {
      wakeUntil = now + WAKE_MS;
      if (!personal()) return;
      mode = 'look';
      stepAt = now;
      basis = show.rev;
      return;
    }
    if (!link.up) return;
    if (mode === 'look') {
      const cur = current();
      fromQuiet = cur === 'notnow';
      preview = fromQuiet ? 'hi' : ORDER[(ORDER.indexOf(cur) + 1) % ORDER.length];
      mode = 'choosing';
      stepAt = now;
      return;
    }
    preview = ORDER[(ORDER.indexOf(preview) + 1) % ORDER.length];
    stepAt = now;
  }

  function sideHeld(now) {
    if (k1.down || frozen) return;
    if (mode === 'choosing') commit(now, true);
    else if (mode === 'look') stepAt = now;
    else if (mode === 'rest' || mode === 'result') step(now);
  }

  function tick(now) {
    advance(now);
    if (link.up) {
      if (now - link.heard > DEAF_MS) { out.push('DROP'); closed(now); }
      else if (now - link.asked >= PING_EVERY_MS) { link.asked = now; send({ t: 'ping' }); }
    }
    if (k1.down && !k1.fired && now - k1.since >= HOLD_MS) { k1.fired = true; hold(now); }
    if (k2.down && !k2.fired && now - k2.since >= HOLD_MS) { k2.fired = true; sideHeld(now); }
    if (quiet.pending && !quiet.sent && link.up) { send({ t: 'hold' }); quiet.sent = true; quiet.at = now; }
    if (quiet.pending && quiet.sent && now - quiet.at >= QUIET_CONFIRM_MS) quiet.pending = false;
    if (mode === 'look' && now - stepAt >= CHOOSE_MS) rest();
    else if (mode === 'choosing' && !frozen) {
      if (!fromQuiet && now - stepAt >= COMMIT_MS) commit(now);
      else if (fromQuiet && now - stepAt >= CHOOSE_MS) rest();
    } else if (mode === 'sending' && now - sentAt >= CONFIRM_MS) {
      result(now, 'NOT SENT');
      if (link.up) { out.push('DROP'); closed(now); }
      if (fromQuiet) { quiet.pending = true; quiet.sent = false; }
    } else if (mode === 'result' && now >= resultUntil) rest();
    settle(now);
  }

  function keyDown(k, now) {
    advance(now);
    const s = k === 1 ? k1 : k2;
    if (s.down) return;
    s.down = true;
    s.since = now;
    s.fired = false;
    if (k === 1 && (mode === 'look' || mode === 'choosing')) frozen = true;
    // Every press is heard as it goes down; NOT NOW is silent.
    if (current() !== 'notnow') react('tick');
    settle(now);
  }

  function keyUp(k, now) {
    advance(now);
    const s = k === 1 ? k1 : k2;
    if (!s.down) return;
    s.down = false;
    if (!s.fired) {
      if (k === 2) step(now);
      else {
        if (frozen) rest();
        wakeUntil = now + WAKE_MS;
      }
    }
    settle(now);
  }

  function linkUp(now) {
    advance(now);
    if (stale(now)) show = null;
    link.up = true;
    link.ever = true;
    link.heard = now;
    link.asked = now;
    const hello = { t: 'wristband', id, key, v: 2 };
    if (secret) hello.secret = secret;
    if (quiet.pending) { hello.quiet = true; quiet.sent = true; quiet.at = now; }
    if (battery >= 0) hello.battery = battery;
    send(hello);
    settle(now);
  }

  function linkDown(now) {
    advance(now);
    closed(now);
    settle(now);
  }

  function frame(text, now) {
    advance(now);
    heardFrame(text, now);
    settle(now);
  }

  function heardFrame(text, now) {
    link.heard = now;
    let m;
    try { m = JSON.parse(text); } catch { return; }
    if (!m || typeof m !== 'object') return;
    if (m.t === 'paired' && typeof m.secret === 'string') { secret = m.secret; return; }
    if (m.t === 'set' && m.ok === false) {
      if (mode === 'sending') result(now, m.why === 'changed' ? 'CHANGED' : 'NOT SENT');
      return;
    }
    if (m.t !== 'show' || !m.show || typeof m.show !== 'object') return;
    show = readShow(m.show);
    if (show.kind === 'pairing') secret = '';
    if (quiet.pending && quiet.sent && !lit(show)) quiet.pending = false;
    if (mode === 'look' || mode === 'choosing') {
      if (!personal() || show.rev !== basis) rest();
    } else if (mode === 'sending' && personal() && show.rev > basis && show.armed === choice && !show.quiet) {
      result(now, 'SET');
    }
  }

  /** The face at rest: band_logic.h faceFor(), wordsFor() and lightFor(), in that order. */
  function restFace(now, awake) {
    const offline = stale(now);
    // NOT NOW from the wrist is dark before the relay has heard it; a relay out of reach is not believed.
    const s = quiet.pending ? { ...readShow({}), quiet: true } : offline || !show ? readShow({}) : show;
    let big = '';
    let small = '';
    if (s.kind === 'pairing') big = s.code;
    else if (s.kind === 'check') { big = s.big; small = 'ON YOUR PHONE?'; }
    else if (s.kind === 'waiting') { big = 'OPEN YOUR PHONE'; small = 'OR SWITCH ME OFF'; }
    else if (lit(s)) { big = s.big; small = s.small.toUpperCase(); }
    else if (s.kind === 'off' && awake) {
      if (offline) ({ big, small } = noSignal());
      else if (s.quiet) { big = 'NOT NOW'; small = pct(); }
      else if (s.away) { big = 'OPEN YOUR PHONE'; small = 'TO COME BACK'; }
      else { big = 'READY'; small = pct(); }
    }
    const light = s.kind === 'test' ? LIGHT_FULL
      : lit(s) ? (s.dim ? LIGHT_DIM : LIGHT_FULL)
      : s.kind === 'pairing' || s.kind === 'check' ? LIGHT_PAIR
      : s.kind === 'waiting' || awake ? LIGHT_AWAKE : LIGHT_OFF;
    return {
      big, small, light, bar: -1,
      field: s.kind === 'test' ? 'white' : lit(s) ? s.intent : 'black',
      ink: s.kind === 'test' || lit(s) ? 'ink' : s.kind === 'pairing' || s.kind === 'check' ? 'white' : 'text2',
      code: s.kind === 'pairing' ? s.code : '',
    };
  }

  function face(now) {
    let f;
    if (mode === 'look') {
      const cur = current();
      if (!link.up) f = noSignal();
      else if (cur === 'notnow') f = words('NOT NOW', 'SIDE TO CHANGE', 'black', 'text2', LIGHT_AWAKE);
      else if (cur === 'off') f = words('READY', 'SIDE TO CHANGE', 'black', 'text2', LIGHT_AWAKE);
      else f = words(CARD_WORDS[cur], 'SIDE TO CHANGE', cur, 'ink', LIGHT_FULL);
    } else if (mode === 'choosing' || mode === 'sending') {
      const small = mode === 'sending' ? 'SENDING' : fromQuiet ? 'HOLD SIDE TO SHOW' : 'SIDE: NEXT';
      f = preview === 'off'
        ? words('OFF', small, 'black', 'text2', LIGHT_AWAKE)
        : words(CARD_WORDS[preview], small, 'black', preview, LIGHT_AWAKE);
    } else {
      f = restFace(now, wakeUntil > now || mode === 'result');
      if (mode === 'result') f = { ...f, small: word };
    }
    if (k1.down && !k1.fired && now - k1.since >= BAR_MS) {
      f = { ...f, small: 'KEEP HOLDING', bar: Math.min(99, Math.floor(((now - k1.since) * 100) / HOLD_MS)), light: Math.max(f.light, LIGHT_AWAKE) };
    }
    return f;
  }

  return {
    id,
    key,
    secret: () => secret,
    keyDown,
    keyUp,
    linkUp,
    linkDown,
    heard: (now) => { link.heard = now; },
    frame,
    tick,
    setBattery: (level) => { battery = Number.isInteger(level) && level >= 0 && level <= 100 ? level : -1; },
    setWifi: (on) => { wifi = !!on; },
    /** Everything to send since the last take: frame text, or 'DROP' to drop the socket. */
    take: () => { const o = out; out = []; return o; },
    /** The names of the sounds due to start since the last ask: the player plays the newest. */
    sounds: () => { const d = due; due = []; return d; },
    face,
  };
}
