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
// 2026-09-25-wrist-reactions-design.md). Each input is one moment; a moment's
// reactions play in order (a key or a result, then a call, then a warning),
// one after another, and a later moment's replace the one playing. sounds()
// gives the names of the sounds due to start since it was last asked.
//
// A wave at its person calls (docs/superpowers/specs/2026-09-25-wrist-waves-
// design.md): hello, and the HI blue three times, whatever the keys do.

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
export const BLINK_MS = 500;           // a meeting that calls blinks: its face this long, then off this long
export const HINT_MS = 3000;           // a press on the letters or the check says PAIR ON YOUR PHONE this long
export const PAIR_AWAKE_MS = 120000;   // new letters, or the waiting face, stay lit this long; so does a press on them

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
  STALE_MS, QUIET_CONFIRM_MS, BLINK_MS, HINT_MS, PAIR_AWAKE_MS, LIGHT_FULL, LIGHT_DIM, LIGHT_PAIR, LIGHT_AWAKE, LIGHT_OFF, CARD_WORDS,
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
  hello: [[1568, 60], [2093, 120]],
};

/** Every flash: its colour, then count × on / off ms. `card` is the card chosen, white for OFF. band_logic.h FLASHES. */
export const FLASHES = {
  set: { colour: 'card', count: 2, on: 150, off: 100 },
  changed: { colour: 'red', count: 3, on: 120, off: 90 },
  notsent: { colour: 'orange', count: 2, on: 350, off: 250 },
  warn: { colour: 'orange', count: 2, on: 350, off: 250 },
  check: { colour: 'white', count: 2, on: 150, off: 100 },
  wave: { colour: 'hi', count: 3, on: 500, off: 500 },
};

/**
 * The flash fields' colours. Red is the phone's own --stop. Orange is not its --warn, which on the band reads
 * as FIRST SONG's yellow. band_logic.h plainField().
 */
export const FLASH_COLOURS = { red: '#FF6B6B', orange: '#FF8A00' };

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

/** A show's waves, read apart from the show, as band_logic.h readFrame() reads them: nobody waiting unless said. */
function readWaves(s) {
  const w = s.waves && typeof s.waves === 'object' ? s.waves : {};
  return { ref: typeof w.ref === 'string' ? w.ref : '', n: Number.isInteger(w.n) ? w.n : 0, seq: Number.isInteger(w.seq) ? w.seq : 0 };
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
  let mode = 'rest';          // rest | look | choosing | sending | result | waves
  let preview = '';           // hi | song | dance | off
  let fromQuiet = false;
  let frozen = false;
  let stepAt = 0, basis = 0, sentAt = 0, resultUntil = 0;
  let choice = '';            // what was sent: a card, or '' for off
  let word = '';
  let out = [];
  // Reactions (rule 6): this input's, not yet in order; the one playing; those waiting their turn.
  let moment = [];
  let playing = null;         // { sound, flash, colour, cls, audible, whole, at, until }
  let queue = [];
  let due = [];               // sounds started since sounds() was last asked
  let soundOn = true;         // the person's switch, as the last show that said it had it (rule 3)
  let silent = false;         // NOT NOW, for the sake of silence (rule 1)
  // The meeting call (rule 4): the number last called for, whether it still calls, and since when.
  let called = '';
  let calling = false;
  let callAt = 0;
  // Waves: who waits, as the last show said; the newest wave number called for; and a call's flashes, owed until
  // the face rests.
  let waves = readWaves({});
  let waveSeq = 0;
  let waveOwed = false;
  // Rule 5: the letters and the waiting face sleep. Until when they are lit, which letters lit them, when
  // waiting began, and until when a press says where to go.
  let litUntil = 0;
  let pairCode = '';
  let waitAt = null;
  let hintUntil = 0;
  // Rule 7: each warning plays once per change. Which have played (true while their condition holds), which
  // battery thresholds are armed, and which came up in NOT NOW or during a choice and are owed.
  const warned = { reach: false, wait: false, away: false };
  const armed = { low: true, empty: true };
  const owed = new Set();

  const send = (m) => out.push(JSON.stringify(m));
  const stale = (now) => !link.up && (!link.ever || now - link.lost >= STALE_MS);
  const personal = () => !!show && show.hasArmed;
  // A call blinks on the resting face only: no look, choice, send or result on it.
  const blinking = (now) => calling && mode === 'rest' && !stale(now) && show?.kind === 'meet';
  // The letters or the check on the face: the band is nobody's yet, and a key only says where to go.
  const pairingFace = (now) => !stale(now) && !quiet.pending && (show?.kind === 'pairing' || show?.kind === 'check');
  const current = () => (quiet.pending || show?.quiet ? 'notnow' : show?.armed || 'off');
  const pct = () => (battery >= 0 ? battery + '%' : '');

  /**
   * A reaction of this moment. cls: 0 a key or a result, 1 a call, 2 a warning. `card`: the colour a `set` flash
   * takes. A wave's flashes play whole: a key does not end them.
   */
  function react(sound, flash = null, cls = 0, card = '') {
    const f = flash ? FLASHES[flash] : null;
    const colour = f ? (f.colour === 'card' ? card || 'white' : f.colour) : '';
    moment.push({ sound, flash: f, colour, cls, audible: soundOn, whole: flash === 'wave' });
  }

  /** A wave's flashes are on the face: a key only ticks (waves decision 6). */
  const waveFlashing = (now) => !!playing && playing.whole && now < playing.at + flashMs(playing.flash);
  /** A wave call playing, waiting its turn, or owed: a new wave joins it. */
  const waveCalling = () => !!playing?.whole || queue.some((r) => r.whole) || moment.some((r) => r.whole) || waveOwed;

  /** A wave newer than any called for: hello, and its flashes now, or once the face rests (waves §1.2). */
  function callWave() {
    if (mode === 'rest') react('hello', 'wave', 1);
    else {
      react('hello', null, 1);
      waveOwed = true;
    }
  }

  function start(r, at) {
    playing = { ...r, at, until: at + Math.max(soundMs(r.sound), flashMs(r.flash)) };
    if (r.sound && r.audible) due.push(r.sound);
  }

  /** A warning: orange twice with warn. One a moment, however many came up in it. */
  function playWarn() {
    if (!moment.some((r) => r.cls === 2)) react('warn', 'warn', 2);
  }

  /** A warning came up. In NOT NOW, or while the face is not resting, it is owed (rules 1 and 6). */
  function warn(name) {
    if (silent || mode !== 'rest') owed.add(name);
    else playWarn();
  }

  /** What is owed plays once, if any of it still holds. */
  function payOwed() {
    const holds = (name) => (name === 'battery' ? battery >= 0 && battery <= 15 : warned[name]);
    if ([...owed].some(holds)) playWarn();
    owed.clear();
  }

  /** The end of a moment: its reactions go first, in order, and what was already waiting plays after them. */
  function settle(now) {
    // A wave's flashes, or a warning, that waited for a choice play once the face rests.
    if (waveOwed && !silent && mode === 'rest') {
      waveOwed = false;
      react(null, 'wave', 1);
    }
    if (owed.size && !silent && mode === 'rest') payOwed();
    if (!moment.length) return;
    const mine = moment.sort((a, b) => a.cls - b.cls);
    moment = [];
    queue = [...mine.slice(1), ...queue];
    start(mine[0], now);
  }

  /** Each reaction starts when the one before it ends. */
  function advance(now) {
    while (playing && now >= playing.until) {
      const next = queue.shift();
      const at = playing.until;
      playing = null;
      if (next) start(next, at);
    }
  }

  function noSignal() {
    const why = wifi ? 'NO RELAY' : 'NO WI-FI';
    return words('NO SIGNAL', pct() ? why + ' - ' + pct() : why, 'black', 'text2', LIGHT_AWAKE);
  }

  /** A press shows the face for WAKE_MS; the waiting face, which sleeps, stays lit PAIR_AWAKE_MS from it. */
  function wake(now) {
    wakeUntil = now + WAKE_MS;
    if (show?.kind === 'waiting') litUntil = now + PAIR_AWAKE_MS;
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
    if (mode === 'waves') rest();  // the wave face follows the link
  }

  /** Someone waits on the person showing SAY HI, as the show says. */
  const waiting = () => personal() && show.armed === 'hi' && !show.quiet && waves.n > 0;

  /** A FACE press on the resting HI or meeting face, with someone waiting and the link up, opens the wave face. */
  function opensWaves() {
    return mode === 'rest' && link.up && !quiet.pending && waiting();
  }

  function hold(now) {
    quiet.pending = true;
    quiet.sent = false;
    rest();
    wakeUntil = now;
    // Going into NOT NOW is the one sound it makes; a hold inside NOT NOW is silent.
    if (!silent) react('down');
    silent = true;
    calling = false;  // NOT NOW ends a call
    waveOwed = false;
  }

  /** SET, CHANGED or NOT SENT on the face, with its sound and flash. In NOT NOW a failed try to come back is silent. */
  function result(now, w) {
    mode = 'result';
    word = w;
    resultUntil = now + RESULT_MS;
    preview = '';
    frozen = false;
    if (silent) return;
    if (w === 'SET') react('up', 'set', 0, choice);
    else if (w === 'CHANGED') react('fall', 'changed');
    else react('low', 'notsent');
  }

  /** `held`: a KEY2 hold sends it at once, and says so with a double tick, except from NOT NOW, which is silent. */
  function commit(now, held = false) {
    if (frozen) return;
    if (preview === current() || !link.up) { rest(); return; }
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
      wake(now);
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
    if (calling && stale(now)) calling = false;  // a show no longer believed calls no more
    // Out of reach: a paired band, STALE_MS without the relay. Waiting: STALE_MS after it began.
    if (secret && stale(now) && !warned.reach) { warned.reach = true; warn('reach'); }
    if (waitAt !== null && now - waitAt >= STALE_MS && !warned.wait) { warned.wait = true; warn('wait'); }
    if (link.up) {
      if (now - link.heard > DEAF_MS) { out.push('DROP'); closed(now); }
      else if (now - link.asked >= PING_EVERY_MS) { link.asked = now; send({ t: 'ping' }); }
    }
    if (k1.down && !k1.fired && now - k1.since >= HOLD_MS) { k1.fired = true; hold(now); }
    // A SIDE hold that comes due during a wave's flashes does nothing else.
    if (k2.down && !k2.fired && now - k2.since >= HOLD_MS) { k2.fired = true; if (!waveFlashing(now)) sideHeld(now); }
    if (quiet.pending && !quiet.sent && link.up) { send({ t: 'hold' }); quiet.sent = true; quiet.at = now; }
    if (quiet.pending && quiet.sent && now - quiet.at >= QUIET_CONFIRM_MS) quiet.pending = false;
    if ((mode === 'look' || mode === 'waves') && now - stepAt >= CHOOSE_MS) rest();
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
    // During a wave's flashes a key only ticks: a meeting calling underneath is answered after them.
    const whole = waveFlashing(now);
    // The key that answers a call only answers: letting it go, or holding it, does nothing more.
    if (blinking(now) && !whole) { calling = false; s.fired = true; }
    // On the letters or the check a key says where to go, and lights the letters again; nothing more.
    else if (pairingFace(now)) {
      s.fired = true;
      hintUntil = now + HINT_MS;
      if (show.kind === 'pairing') litUntil = now + PAIR_AWAKE_MS;
    }
    // Every press is heard as it goes down; NOT NOW is silent. A tick does not end a wave's flashes.
    if (!silent) {
      if (!whole) react('tick');
      else if (soundOn) due.push('tick');
    }
    settle(now);
  }

  function keyUp(k, now) {
    advance(now);
    const s = k === 1 ? k1 : k2;
    if (!s.down) return;
    s.down = false;
    if (!s.fired && !waveFlashing(now)) {
      // In the wave face a press of either key closes it; SIDE never starts the chooser there.
      if (mode === 'waves') rest();
      else if (k === 2) step(now);
      else if (opensWaves()) { mode = 'waves'; stepAt = now; }
      else {
        if (frozen) rest();
        wake(now);
      }
    }
    settle(now);
  }

  function linkUp(now) {
    advance(now);
    if (stale(now)) show = null;
    link.up = true;
    link.ever = true;
    warned.reach = false;  // it has the relay again
    link.heard = now;
    link.asked = now;
    const hello = { t: 'wristband', id, key, v: 2 };
    if (secret) hello.secret = secret;
    if (quiet.pending) { hello.quiet = true; quiet.sent = true; quiet.at = now; }
    if (battery >= 0) hello.battery = battery;
    send(hello);
    settle(now);
  }

  /** A battery reading. Low at 15% or below, again only after 20%; very low at 5% or below, again only after 10%. */
  function setBattery(level, now) {
    advance(now);
    battery = Number.isInteger(level) && level >= 0 && level <= 100 ? level : -1;
    // Past both at once is still one warning: a moment plays one.
    if (battery >= 0) {
      if (battery <= 15 && armed.low) { armed.low = false; warn('battery'); } else if (battery >= 20) armed.low = true;
      if (battery <= 5 && armed.empty) { armed.empty = false; warn('battery'); } else if (battery >= 10) armed.empty = true;
    }
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
    const was = show;
    const wasSilent = silent;
    show = readShow(m.show);
    waves = readWaves(m.show);
    // Reactions come from changes; a show that differs only in `sound` is no change.
    const same = !!was && JSON.stringify(was) === JSON.stringify(show);
    // A show's own switch counts for what it causes. One that is not true or false is not said.
    if (typeof m.show.sound === 'boolean') soundOn = m.show.sound;
    if (show.kind === 'pairing') {
      // The band is nobody's: NOT NOW is over, and no meeting is anyone's.
      const wasPaired = !!secret;
      secret = '';
      silent = false;
      called = '';
      calling = false;
      waveSeq = 0;
      waveOwed = false;
      if (was?.kind === 'check') react('fall', null, 1);  // the check ended without YES
      if (wasPaired) playWarn();                          // unpaired; the letters end any choice, so at once
      soundOn = true;                                     // after the letters' own reactions
      // New letters light for PAIR_AWAKE_MS; the same letters again (a reconnect) do not.
      if (show.code !== pairCode) { pairCode = show.code; litUntil = now + PAIR_AWAKE_MS; }
    } else pairCode = '';
    // The waiting face lights when waiting starts. Losing the relay does not end it; any other show does.
    if (show.kind !== 'waiting') { waitAt = null; warned.wait = false; }
    else if (waitAt === null) { waitAt = now; litUntil = now + PAIR_AWAKE_MS; }
    if (quiet.pending && quiet.sent && !lit(show)) quiet.pending = false;
    // NOT NOW's silence starts and ends only with a show about the person (rule 1).
    if (personal()) {
      if (show.quiet) silent = true;
      else if (!quiet.pending) silent = false;
      // A show about the person that is not a meeting ends a call and forgets its number.
      if (show.kind !== 'meet') { called = ''; calling = false; }
    }
    if (mode === 'look' || mode === 'choosing') {
      if (!personal() || show.rev !== basis) rest();
    } else if (mode === 'sending' && personal() && show.rev > basis && show.armed === choice && !show.quiet) {
      result(now, 'SET');
    } else if (mode === 'waves' && !waiting()) {
      rest();  // the wave face follows the shows: nobody left waiting, off SAY HI, or not about the person
    }
    // Away starts at an away show and ends at one that is not; the same again after a reconnect is no change.
    if (!show.away) warned.away = false;
    else if (!warned.away) { warned.away = true; warn('away'); }
    // NOT NOW is over: what came up in it plays once, after this moment's own reactions (rule 1).
    if (wasSilent && !silent) payOwed();
    // A wave newer than any called for calls; either way the number moves up (waves §3).
    const newer = waves.seq > waveSeq;
    if (newer) waveSeq = waves.seq;
    if (silent) return;
    // A show that differs only in its sound or its waves is no change.
    if (!same) {
      if (show.kind === 'check') react('ask', 'check', 1);
      else if (show.kind === 'test') react('up', null, 1);  // paired, or TEST THE LIGHT: the white face is its flash
      else if (show.kind === 'meet' && show.big !== called) {
        // A number not yet called for calls until it is answered (rule 4).
        react('jingle', null, 1);
        called = show.big;
        calling = true;
        callAt = now;
      }
    }
    // After a meeting's jingle. A wave call already under way takes the new wave in; the open wave face counts it.
    if (newer && !waveCalling() && mode !== 'waves') callWave();
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
    let light = s.kind === 'test' ? LIGHT_FULL
      : lit(s) ? (s.dim ? LIGHT_DIM : LIGHT_FULL)
      : s.kind === 'pairing' || s.kind === 'check' ? LIGHT_PAIR
      : s.kind === 'waiting' || awake ? LIGHT_AWAKE : LIGHT_OFF;
    // Rule 5, over what the relay says: a press on the letters or the check says where to go, and the
    // letters and the waiting face sleep. Asleep, only the light goes: the picture stays for the next press.
    if ((s.kind === 'pairing' || s.kind === 'check') && hintUntil > now) small = 'PAIR ON YOUR PHONE';
    if ((s.kind === 'pairing' || s.kind === 'waiting') && now >= litUntil) light = LIGHT_OFF;
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
    } else if (mode === 'waves') {
      // As the chooser shows HI, in its own words: that someone waved, and how many wait. Never who.
      const count = waves.n > 9 ? '9+' : String(waves.n);
      f = words('SOMEONE WAVED', waves.n > 1 ? count + ' WAITING - HOLD SIDE' : 'HOLD SIDE: WAVE BACK', 'black', 'hi', LIGHT_AWAKE);
    } else {
      f = restFace(now, wakeUntil > now || mode === 'result');
      if (mode === 'result') f = { ...f, small: word };
    }
    if (k1.down && !k1.fired && now - k1.since >= BAR_MS) {
      f = { ...f, small: 'KEEP HOLDING', bar: Math.min(99, Math.floor(((now - k1.since) * 100) / HOLD_MS)), light: Math.max(f.light, LIGHT_AWAKE) };
    }
    // A call blinks: the meeting face as it is, then off. A flash, while it lasts, is drawn over it.
    if (blinking(now) && (now - callAt) % (2 * BLINK_MS) >= BLINK_MS) f = { ...f, light: LIGHT_OFF };
    return flashOver(f, now);
  }

  /** A flash, step by step: on is its colour at full light and nothing else; off is the backlight off. */
  function flashOver(f, now) {
    if (!playing || !playing.flash) return f;
    const { count, on, off } = playing.flash;
    const t = now - playing.at;
    if (t < 0 || t >= count * (on + off)) return f;
    return t % (on + off) < on
      ? { big: '', small: '', field: playing.colour, ink: 'ink', light: LIGHT_FULL, bar: -1, code: '' }
      : { ...f, light: LIGHT_OFF };
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
    setBattery,
    setWifi: (on) => { wifi = !!on; },
    /** Everything to send since the last take: frame text, or 'DROP' to drop the socket. */
    take: () => { const o = out; out = []; return o; },
    /** The names of the sounds due to start since the last ask: the player plays the newest. */
    sounds: () => { const d = due; due = []; return d; },
    face,
  };
}
