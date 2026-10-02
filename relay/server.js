// ON THE BEAT — the relay: the pages, and one room per venue.
//
// One process holds every room, so two phones at one gig are always in the
// same room (a function host that scales out can put them in two). It keeps
// the night in memory and nothing on disk: stop it and the night is gone.
//
// What a phone may know is decided in room.js and nowhere else. This file only
// carries messages in and pushes each person's own view out, whenever anything
// in their room changes.

import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { extname, isAbsolute, join, normalize, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { createRoom, handleLedger, HANDLES_MAX, INTENTS, MARKS, SPOTS } from './room.js';
import { MEET_MS, bandShow, cleanCode, newCode } from './band.js';
import { addressKey } from './address.js';
import { rolling } from './limits.js';
import { createMeter, formatLoad, startLine } from './load.js';
import { nightOf } from './night.js';
import { originAllowed } from './origin.js';
import { checkCode, entryPrint, isEntry } from './staff.js';
import { openNight } from './store.js';
import { createPusher, isPushService, loadKeys, subscriptionOf } from './push.js';

export const WS_PATH = '/api/ws';
export const PAIR_CHECK_MS = 60_000;          // a pending pairing waits this long for YES
export const BAND_ALONE_MS = 60 * 60_000;     // a wristband alone holds its person, or waits for its owner, this long
export const GRACE_MS = 120_000;              // a locked screen is not leaving
export const HEARD_GAP_MS = 5000;             // a wristband may say what it heard at most this often (near spec §2)
export const PUSH_EVERY_MS = 10_000;          // a venue's staff devices hear of new reports at most this often
const MAX_FRAME = 1_600_000;          // a five-second clip, base64, with room to spare
const CLIP_MAX = 1_200_000;           // bytes of video per clip
// Every room's clips together, the oldest going first. Fly's machine gives the process 207 MB, and a store of 96 MB was too much
// of it: in a 207 MB cgroup (scripts/load.mjs --cgroup-mem 207M --clip-kb 375) a hundred phones posting clips reached 178 MB of
// memory with the old cap and 161 MB with this one, a full store included. A hundred floor clips of five seconds at 600 kbit/s
// are 37.5 MB, the plan number for a venue. A machine with more memory can hold more.
const ALL_CLIPS_MAX = 40_000_000;
const CLIP_TTL_MS = 3_600_000;        // "it loops on the floor for an hour"
const PING_MS = 15_000;
const BAND_GRACE_MS = 60_000;         // a wristband that drops keeps its letters this long
const SET_GAP_MS = 1000;              // a wristband may change its person at most once a second
const WAVE_GAP_MS = 1000;             // and wave back at most once a second, on a stamp of its own
const FOUND_GAP_MS = 1000;            // and say found at most once a second, on a stamp of its own
const TRIES_MS = 60_000;              // the window pairing attempts are counted in
const SOCKET_TRIES = 5;               // pairing attempts one socket may make in it
const ADDRESS_TRIES = 20;             // pairing attempts one address may make in it, over every socket
const HEX32 = /^[a-f0-9]{32}$/;
const AIR = /^[a-f0-9]{12}$/;         // a wristband's radio: its Wi-Fi MAC, new every boot
const HEARD_MAX = 16;                 // the most bands one report may name
const NEAR_TICK_MS = 5000;            // how often each room works out who is near whom
const PUSH_GAP_MS = 100;              // a room's views go out at most this often: a burst of changes is one push
const FRAMES_AT_ONCE = 40;            // frames one socket may send at once: far past a reconnect's burst
const FRAMES_A_SECOND = 20;           // and the rate it earns them back; a phone or a band says one every two seconds
// Nothing a phone or a band says comes near this size but a clip, so a frame this big is charged to a budget of its own
// as it arrives, before it is parsed: 20 clips a second from one socket was 24 MB a second to parse, decode and push.
const BIG_FRAME = 64_000;
const CLIPS_AT_ONCE = 3;              // big frames one socket may send at once: a phone records five seconds a clip
const CLIP_EVERY_MS = 3000;           // and the pace it earns one back at
const STAFF_TOKENS_MAX = 1000;        // staff sign-ins kept for tonight; past it the oldest is forgotten
// A venue's share of them: its passcode holder signing in over and over forgets that venue's oldest, never another's.
// Fifty devices a venue can hold a notification subscription (PUSH_SUBS_MAX), so this leaves room for as many again.
const STAFF_TOKENS_PER_VENUE = 100;
const PUSH_SUBS_MAX = 50;             // staff devices a venue sends notifications to; past it the oldest is forgotten
const CODE_MAX = 200;                 // the longest passcode a staff sign-in may carry
const CHECKS_AT_ONCE = 8;             // passcode checks running at once: libuv's pool has four threads, so a queue is only ever a guesser's
const REPORT_WINDOW_MS = 3_600_000;   // the window reports are counted in
const PERSON_REPORTS = 10;            // reports one person may send in it
const ADDRESS_REPORTS = 60;           // and one network, over everyone on it
const NIGHT_V = 1;                    // the night file's format: a build that cannot read the last one bumps it

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

// The staff page's policy (docs/superpowers/specs/2026-09-29-staff-security-design.md §4): its own scripts, styles,
// fonts, worker, manifest and socket, and nothing else. It can be this tight because the page has no inline script or
// style, and because its fonts are files of its own (app/fonts/) rather than Google's. `ws:` and `wss:` are named
// beside 'self' because some browsers do not count a WebSocket to the page's own host as 'self'.
export const STAFF_POLICY = [
  "default-src 'self'", "script-src 'self'", "style-src 'self'",
  "font-src 'self'", "img-src 'self' data:", "connect-src 'self' ws: wss:", "worker-src 'self'",
  "manifest-src 'self'", "base-uri 'none'", "object-src 'none'", "form-action 'self'", "frame-ancestors 'none'",
].join('; ');
// The phone app's policy (docs/superpowers/specs/2026-09-30-app-csp-design.md): the staff page's, with `media-src`
// added for the two places a clip plays — the five seconds just recorded, from a blob URL the phone made itself,
// and the floor's, from /clip/. Nothing else widens: the built app has no inline script or style, no eval and no
// worker of its own, and the camera scanner needs no allowance here (a MediaStream on a <video> is not a fetched
// source, and getUserMedia answers to the browser's permission, not to this header).
export const APP_POLICY = [
  "default-src 'self'", "script-src 'self'", "style-src 'self'",
  "font-src 'self'", "img-src 'self' data:", "media-src 'self' blob:",
  "connect-src 'self' ws: wss:", "worker-src 'self'", "manifest-src 'self'",
  "base-uri 'none'", "object-src 'none'", "form-action 'self'", "frame-ancestors 'none'",
].join('; ');
// What the phone app was served under before its policy, and still is by a relay told so (APP_CSP=framing-only): the
// framing rule alone. The policy above is written and was walked in headless Chrome and WebKit, but no iPhone has read
// its `connect-src` yet, so Fly holds the app to this until one has (docs/superpowers/specs/2026-09-30-app-csp-design.md,
// "Rollout switch"). The staff page is not in the switch: it has run under its full policy since 29 Sep 2026.
export const FRAMING_ONLY = "frame-ancestors 'none'";

/** A venue's room key: its name, folded, so "The Roundhouse " and "the roundhouse" meet. */
export const venueKey = (v) => String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 80);

/** A venue key as a log line may carry it. A stranger typed it, so no control, format or separator character goes through. */
const plain = (text) => String(text).replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, '?');

/** A wristband's id: the first 32 hex of SHA-256 over its 16-byte key. Only the wristband knows the key. */
export const bandIdOf = (key) => createHash('sha256').update(Buffer.from(key, 'hex')).digest('hex').slice(0, 32);
// Three things are enough to act as someone: a phone's id, a wristband's secret, a staff token. The relay holds
// each only as its SHA-256, in memory and in the night file
// (docs/superpowers/specs/2026-09-29-restart-persistence-design.md §4).
const sha256 = (s) => createHash('sha256').update(String(s)).digest('hex');
/** The person a phone's id stands for inside the relay: the id itself never goes further than the join. */
export const personOf = (me) => sha256(me).slice(0, 32);
const secretHashOf = (secret) => sha256(secret);
const tokenHashOf = (token) => sha256(token);

// A name out of a shows file, as a log line may carry it: short, and with no control character.
const shown = (text) => { const t = plain(text); return t.length > 80 ? t.slice(0, 80) + '...' : t; };

// The fields of a show the phone app draws as text, and the two it reads as a list of text. React cannot draw an object, so one
// of them typed wrong in a hand-edited file would blank the app for every phone; such an entry is dropped, and the rest stand.
// Only the id is required: a field that is absent, or null, is the app's own default.
const SHOW_TEXT = ['act', 'venue', 'doors', 'support', 'break', 'headline', 'end'];
const SHOW_LISTS = ['spots', 'setlist'];

/** What is wrong with one entry of a shows file, or '' when it stands. A show is named by its id, which is its room's key. */
const showFault = (s) => {
  if (!s || typeof s !== 'object') return 'not a show';
  if (typeof s.id !== 'string') return 'no id';
  const key = venueKey(s.id);
  if (!key) return 'the id is empty';
  if (key !== s.id) return `the id "${shown(s.id)}" should read "${shown(key)}"`;
  for (const f of SHOW_TEXT) if (s[f] != null && typeof s[f] !== 'string') return `"${f}" must be text`;
  for (const f of SHOW_LISTS) if (s[f] != null && !(Array.isArray(s[f]) && s[f].every((x) => typeof x === 'string'))) return `"${f}" must be a list of text`;
  return '';
};

/** A shows file's entries as { all }, or why there are none as { why }. A byte order mark a Windows editor left is not a fault. */
function readShowsFile(file) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (err) {
    return { why: err?.code === 'ENOENT' ? `no file at ${file}` : `cannot read ${file} (${err?.code ?? err?.message})` };
  }
  let all;
  try {
    all = JSON.parse(text.codePointAt(0) === 0xfeff ? text.slice(1) : text);
  } catch (err) {
    return { why: `${file} is not JSON (${plain(err.message)})` };
  }
  return Array.isArray(all) ? { all } : { why: `${file} is not a list of shows` };
}

/** Tonight's shows, as the venue team wrote them. A venue nobody listed still gets a room. Never complains: chooseShows says what is wrong. */
export function loadShows(file) {
  return (readShowsFile(file).all ?? []).filter((s) => !showFault(s));
}

/**
 * The shows the relay starts with: `file` when it holds at least one usable show, else `bundled`, the list that ships
 * with the relay, and never none. Every way a file can fail is said once on `say`, with the file's name, and so is every
 * entry dropped and why, so a typo is found in the log and not in the middle of a night. No `file` named is the ordinary
 * case and is silent.
 */
export function chooseShows(file, bundled, say = (line) => console.log(line)) {
  if (!file) return loadShows(bundled);
  const read = readShowsFile(file);
  const kept = [];
  (read.all ?? []).forEach((s, i) => {
    const fault = showFault(s);
    if (fault) say(`shows: entry ${i + 1} of ${file} dropped: ${fault}`);
    else kept.push(s);
  });
  if (kept.length) {
    say(`shows: ${kept.length} from ${file}`);
    return kept;
  }
  const shipped = loadShows(bundled);
  say(`shows: ${read.why ?? `${file} has no usable show`}, using the ${shipped.length} that ship with the relay`);
  return shipped;
}

/**
 * STAFF_CODES: a JSON object of venue id -> passcode entry (relay/staff.js), or nothing. Anything else throws
 * when the relay starts, naming the venue and never the entry.
 */
export function readStaffCodes(text) {
  const entries = new Map();
  if (!text) return entries;
  let all;
  try { all = JSON.parse(text); } catch { throw new Error('STAFF_CODES is not JSON'); }
  if (!all || typeof all !== 'object' || Array.isArray(all)) throw new Error('STAFF_CODES is not an object of venue -> entry');
  for (const [venue, entry] of Object.entries(all)) {
    if (!venue || venueKey(venue) !== venue) throw new Error('STAFF_CODES: ' + JSON.stringify(venue) + ' is not a venue id');
    if (!isEntry(entry)) throw new Error('STAFF_CODES: the entry for ' + venue + ' is not one npm run staff-code makes');
    entries.set(venue, entry);
  }
  return entries;
}

/**
 * The relay: the app, and one socket per phone and per wristband.
 *
 * The clock and the waits are options so tests can drive them: `clock` reads
 * the time, `pairCheckMs` is how long a pairing waits for YES,
 * `bandAloneMs` how long a wristband alone holds its person or waits for its
 * owner, and `graceMs` how long a person with no phone and no live wristband
 * stays. `nightTz` is the venue's time zone, an IANA name, whose 06:00 ends
 * the night; the machine's own by default.
 * `clipEveryMs` is how often a socket earns back one of its three big (clip-sized) frames; CLIP_EVERY_MS, a test sets it.
 * `staffTokensMax` and `staffTokensPerVenue` are how many staff sign-ins the relay keeps in all and for one venue
 * (STAFF_TOKENS_MAX, STAFF_TOKENS_PER_VENUE); the oldest goes first, a test sets them small.
 * `staffCodes` is STAFF_CODES (readStaffCodes()): the venues with a staff page, and their passcodes' entries.
 * `nightFile` is where the night is kept across a restart, or none: in memory only
 * (docs/superpowers/specs/2026-09-29-restart-persistence-design.md). `saveEveryMs` is how often it is written,
 * when it changed.
 * `pushKeysFile` is where the relay's Web Push keys are kept, or none: made at start and kept in memory
 * (docs/superpowers/specs/2026-09-29-staff-push-design.md §2). `pushAllowed` is for tests: the check a push
 * service's address must pass, in place of the push services' own hosts (§3), and `pushEveryMs` the window (§4).
 * `staffCheck` is for tests: what checks a passcode against its entry, in place of relay/staff.js's checkCode.
 * `appCsp` is which policy the phone app's pages carry: 'full' (APP_POLICY), the default, or 'framing-only'
 * (FRAMING_ONLY); the staff page carries its own either way, and anything else throws here.
 * `loadEveryMs` is how often the relay says its load (relay/load.js), while anyone is on it: 0, the default, says
 * nothing and starts no meter. `loadSay` is where a line goes, the log by default, and `loadMeter` is for tests: the
 * reader of the process, in place of relay/load.js's createMeter. `handlesMax` is the most handles all its rooms may hold
 * between them (HANDLES_MAX, in relay/room.js); a test sets it small.
 */
export function createRelay({ port = 0, host = '0.0.0.0', root, shows: showsFile, maxBands = 5_000, maxRooms = 5_000,
  clock = Date.now, pairCheckMs = PAIR_CHECK_MS, bandAloneMs = BAND_ALONE_MS, graceMs = GRACE_MS, nightTz,
  clientIpHeader, allClipsMax = ALL_CLIPS_MAX, clipEveryMs = CLIP_EVERY_MS, staffTokensMax = STAFF_TOKENS_MAX, staffTokensPerVenue = STAFF_TOKENS_PER_VENUE, staffCodes = process.env.STAFF_CODES, nightFile, saveEveryMs = 1000,
  pushKeysFile, pushAllowed = isPushService, pushEveryMs = PUSH_EVERY_MS, staffCheck = checkCode,
  loadEveryMs = 0, loadSay = (line) => console.log(line), loadMeter, appCsp = 'full', handlesMax = HANDLES_MAX } = {}) {
  const now = () => clock();
  // The handles every room of this relay holds are one budget (relay/room.js, handleLedger), so a venue of any size cannot
  // take the machine's memory with it: past it a handle is worked out each time, and is the same.
  const handles = handleLedger(handlesMax);
  // A value that is neither throws here, when the relay starts: a typo that quietly served the wrong policy to every phone
  // is worse than a machine that says why it will not run.
  if (appCsp !== 'full' && appCsp !== 'framing-only') {
    throw new TypeError("appCsp (APP_CSP) must be 'full' or 'framing-only', not " + JSON.stringify(appCsp));
  }
  const appPolicy = appCsp === 'full' ? APP_POLICY : FRAMING_ONLY;
  // A misspelt zone throws here, when the relay starts, not at its first sweep in the middle of the night.
  nightOf(now(), nightTz);
  // The venues with a staff page (docs/superpowers/specs/2026-09-28-staff-reports-design.md §2). A mistake in
  // STAFF_CODES throws here too.
  const staffEntries = readStaffCodes(staffCodes);
  // A venue's passcode entry as a sign-in records it, or null when the venue has no staff page
  // (docs/superpowers/specs/2026-09-29-staff-security-design.md §1).
  const printOf = (key) => (staffEntries.has(key) ? entryPrint(staffEntries.get(key)) : null);
  // The night's file, if it has one (docs/superpowers/specs/2026-09-29-restart-persistence-design.md §2).
  const store = nightFile ? openNight(nightFile) : null;
  const saved = readNight();
  const here = fileURLToPath(new URL('..', import.meta.url));
  const dist = root ?? join(here, 'dist');
  // The file SHOWS names (fly.toml points it at the volume) when it holds a usable show, else the list that ships with
  // the relay: a bad file is said in the log and never leaves the relay with none (docs/show-night.md).
  const shows = chooseShows(showsFile ?? process.env.SHOWS, join(here, 'relay', 'shows.json'));
  const showsJson = JSON.stringify(shows);
  // key -> { room, sockets:Set, clips:Map(ref -> {mime, buf, by, slot, at}), left:Map(id -> timer),
  //          heard:Map(id -> when a phone of theirs last spoke), staff:Set of signed-in staff sockets }
  const rooms = new Map();
  let closing = false;
  // Each viewer's own address for a clip: its ref and a ticket only this relay can make, for that clip and that
  // viewer. It opens the clip only while their view shows it (serveClip), so a blocked person's old address stops.
  const clipKey = randomBytes(32);
  const ticketFor = (ref, id) => createHmac('sha256', clipKey).update(ref + ':' + id).digest('hex').slice(0, 32);
  const addressed = (ref, id) => (ref ? ref + '.' + ticketFor(ref, id) : ref);
  // Wrong pairing codes by address, so four letters cannot be walked: 23^4 is
  // 279,841 codes, and one unthrottled socket walked them in fifteen seconds.
  const tries = new Map();   // address -> [times of wrong codes]
  // Reports sent, by person and by network, over the last hour: a flood must not fill a venue's staff list or keep
  // its devices buzzing (docs/superpowers/specs/2026-09-29-staff-security-design.md §3).
  const reportsBy = rolling({ ms: REPORT_WINDOW_MS, max: PERSON_REPORTS });
  const reportsFrom = rolling({ ms: REPORT_WINDOW_MS, max: ADDRESS_REPORTS });
  // Staff signed in with a right passcode tonight: a token's hash -> { key, night, entry, push? }. Good until the
  // venue's 06:00, and only while the venue's passcode entry is the one it was made under: `entry` is its print
  // (§1), and STAFF_CODES is read once, at start, so nothing in memory is under another.
  const tokens = new Map();
  let checking = 0;   // passcode checks running now (§2)
  // Staff see a reported person as a tag: the same at one venue all night, and nothing like any handle a phone
  // is shown. A night carried across a restart keeps its key, and so its tags.
  const staffKey = saved ? Buffer.from(saved.staffKey, 'hex') : randomBytes(32);
  const tagOf = (key, id) => 'P-' + createHmac('sha256', staffKey).update(key + '|' + id).digest('hex').slice(0, 6).toUpperCase();
  // Staff devices' notifications are signed with the relay's own keys, kept in pushKeysFile across restarts
  // (docs/superpowers/specs/2026-09-29-staff-push-design.md §2).
  const pusher = createPusher({ keys: loadKeys(pushKeysFile), now, allowed: pushAllowed });

  /** The quiet corners a venue's show suggests, or the relay's own. */
  function spotsFor(key) {
    const show = shows.find((s) => s.id === key);
    return Array.isArray(show?.spots) && show.spots.length ? show.spots.map(String) : SPOTS;
  }

  function roomFor(key) {
    if (!rooms.has(key)) {
      if (rooms.size >= maxRooms) {
        for (const r of [...rooms.values()]) gcRoom(r);   // reclaim venues nobody is in
        if (rooms.size >= maxRooms) return null;          // every venue is genuinely in use
      }
      // sound: each person's sound switch, as their phone last said it. Leaving forgets it; the grace does not.
      // The room reads the relay's clock: a wave's number is the time it was made, so it only goes up.
      rooms.set(key, { key, room: createRoom({ spots: spotsFor(key), now, ledger: handles }), sockets: new Set(), clips: new Map(), left: new Map(), heard: new Map(), sound: new Map(), staff: new Set() });
    }
    return rooms.get(key);
  }

  /**
   * Every change in a room ends here. Working out a view is a pass over the room for each of its phones, so
   * one push per change let one socket's burst of changes stall the whole relay. Now a room's views go out
   * at most every PUSH_GAP_MS, on the real clock, and the push that goes carries every change before it.
   */
  function push(r) {
    if (r.due || closing) return;
    r.due = setTimeout(() => {
      r.due = null;
      r.pushedAt = Date.now();
      if (!closing) pushNow(r);
    }, Math.max(0, (r.pushedAt ?? 0) + PUSH_GAP_MS - Date.now()));
  }

  function pushNow(r) {
    for (const ws of r.sockets) {
      const view = r.room.viewFor(ws.me);
      if (!view) continue;
      const b = bandOf(r.key, ws.me);
      // Its own field: me.band is where in the room they are.
      view.me.wristband = b ? { battery: b.battery, live: !!b.ws } : null;
      // A pairing waiting for YES belongs to the person, not the socket: every phone of theirs is asked.
      view.me.check = pendingOf(r.key, ws.me)?.pending.number ?? null;
      view.me.clip = addressed(view.me.clip, ws.me);
      for (const c of view.floor) c.ref = addressed(c.ref, ws.me);
      const text = JSON.stringify({ t: 'view', view });
      if (text !== ws.lastView) { ws.lastView = text; ws.send(text); }
    }
    for (const b of bands.values()) if (b.key === r.key || b.pending?.key === r.key) showBand(b);
    reportsTo(r);
  }

  /** The venue's reports, to its signed-in staff sockets that do not have this list yet. */
  function reportsTo(r, sockets = r.staff) {
    if (!sockets.size) return;
    const text = JSON.stringify({ t: 'reports', reports: r.room.staffReports((id) => tagOf(r.key, id)) });
    for (const ws of sockets) if (text !== ws.lastReports) { ws.lastReports = text; ws.send(text); }
  }

  // ---------- the grace, and leaving (rule 2) ----------
  // One grace for every trigger: a person whose last phone socket closed with
  // no live wristband, or whose wristband closed with no phone. A live
  // wristband holds its person without a phone — for BAND_ALONE_MS since a
  // phone of theirs was last heard, or until 06:00 (expire()).

  function startGrace(r, me) {
    stopGrace(r, me);
    // A relay that is shutting down starts no grace period: close() has
    // already cleared them, and a new one would hold the process open.
    if (closing || !r.room.has(me)) return;
    r.left.set(me, setTimeout(() => { r.left.delete(me); leaveRoom(r, me); }, graceMs));
  }

  function stopGrace(r, me) {
    clearTimeout(r.left.get(me));
    r.left.delete(me);
  }

  function leaveRoom(r, me) {
    r.room.leave(me);
    push(r);
    gcRoom(r);
  }

  const toPerson = (r, me, m) => { for (const s of r.sockets) if (s.me === me) s.send(JSON.stringify(m)); };
  const phoneOf = (r, me) => [...r.sockets].some((s) => s.me === me);

  // ---------- wristbands ----------
  // A wristband makes a key at every boot, and its id is the key's hash; every
  // hello proves the id with the key. It is not in a room until a phone pairs
  // it: it shows four letters, the phone types them, the wristband shows a
  // number and the phone confirms it. Then the relay gives both a secret, and
  // a paired wristband is only ever reached with it. From then on it shows what
  // its person is doing; its face button can make them invisible, and its side
  // button can change their card (setFromBand).

  const bands = new Map();   // id -> { id, ws, battery, code, key, person, testUntil, lastShow }
  const codes = new Map();   // code -> band id, while it waits to be typed
  const gone = new Map();    // id -> when: paired records and placeholders forgotten tonight

  const bandOf = (key, person) => [...bands.values()].find((b) => b.key === key && b.person === person) || null;
  const pendingOf = (key, person) => [...bands.values()].find((b) => b.pending?.key === key && b.pending.person === person) || null;
  const clampBattery = (v) => Math.max(0, Math.min(100, Math.round(Number(v) || 0)));

  const makeBand = (id, ws) => ({ id, ws, battery: null, code: null, key: null, person: null,
    testUntil: 0, lastShow: null, everWs: !!ws, goneAt: 0, claimedAt: now(), old: false,
    secretHash: null, pending: null,  // secretHash: of the secret given at YES; pending: { key, person, number, until } while a pairing waits for YES
    waiting: false,     // after a relay restart: said hello with a secret, and waits for its owner
    waitingAt: 0,
    quiet: false,       // a hold with nobody in a room to hide, kept until they are
    setAt: 0,           // when this wristband last changed its person (rule 1)
    waveAt: 0,          // when it last waved back, landed or not
    foundTry: 0,        // when it last said found, landed or not
  });

  // How long a record has been dead weight: a live wristband is never that, a
  // real paired band whose wristband has connected at least once is kept, and
  // everything else — an unclaimed band that dropped, a claim no wristband ever
  // answered — is measured from when it went quiet.
  function bandIdle(b, now) {
    if (b.ws) return -1;
    if (!b.person) return now - (b.goneAt || b.claimedAt || now);
    if (!b.everWs) return now - (b.claimedAt || now);
    return -1;
  }
  // Make room for one more band by dropping the deadest one; never a live one.
  function evictBand(now) {
    let worst = null, worstIdle = -1;
    for (const b of bands.values()) { const idle = bandIdle(b, now); if (idle > worstIdle) { worst = b; worstIdle = idle; } }
    if (!worst || worstIdle < 0) return false;
    codes.delete(worst.code);
    bands.delete(worst.id);
    return true;
  }

  function showBand(b, now = clock()) {
    if (!b.ws) return;
    const r = b.key ? rooms.get(b.key) : null;
    const view = r?.room.viewFor(b.person) ?? null;
    const sound = r?.sound.get(b.person) ?? null;
    const waves = view ? r.room.wavesAt(b.person) : [];
    const text = JSON.stringify({ t: 'show', show: bandShow({ view, battery: b.battery, code: b.code, check: b.pending?.number ?? null, waiting: b.waiting, testUntil: b.testUntil, sound, waves, now }) });
    if (text !== b.lastShow) { b.lastShow = text; b.ws.send(text); }
  }

  /** Nobody's, and nobody is pairing it: fresh letters while it is worn; forgotten when it is not. */
  function freshLetters(b) {
    codes.delete(b.code);
    Object.assign(b, { code: null, key: null, person: null, secretHash: null, pending: null, waiting: false, quiet: false });
    if (b.ws) {
      b.code = newCode(new Set(codes.keys()));
      codes.set(b.code, b.id);
    } else {
      // Nobody is wearing it. If it comes back, it comes back new.
      bands.delete(b.id);
    }
  }

  function unpairBand(b) {
    const r = b.key ? rooms.get(b.key) : null;
    freshLetters(b);
    if (r) push(r);
    showBand(b);
  }

  /** A pairing that did not end in YES. `why` is told to the person's phones: 'timeout', or null when they said NO themselves. */
  function dropPending(b, why) {
    const r = rooms.get(b.pending.key);
    const person = b.pending.person;
    freshLetters(b);
    if (r && why) toPerson(r, person, { t: 'check', ok: false, why });
    if (r) push(r);
    showBand(b);
  }

  function forget(id, at) {
    gone.set(id, at);
    if (gone.size > maxBands) gone.delete(gone.keys().next().value);
  }

  /** NOT NOW from the wrist. With nobody in a room to hide, it is kept until they are. */
  function holdOn(b) {
    const room = b.key ? rooms.get(b.key)?.room : null;
    if (b.person && room?.has(b.person)) room.setInvisible(b.person, true, 'band');
    else if (b.person || b.waiting) b.quiet = true;
  }

  /** Rule 1: the wristband may say `set`. Returns whether anything changed. */
  function setFromBand(ws, b, m) {
    // Dropped whole, before anything is touched, unless it is exactly a set.
    if (!('intent' in m) || !(m.intent === null || INTENTS.includes(m.intent)) || !Number.isInteger(m.basis)) return false;
    const refuse = (why) => { ws.send(JSON.stringify({ t: 'set', ok: false, why })); return false; };
    if (!b.person) return refuse('unpaired');
    const room = rooms.get(b.key)?.room;
    if (!room?.has(b.person)) return refuse('no room');
    if (m.basis !== room.revOf(b.person)) return refuse('changed');
    if (now() - b.setAt < SET_GAP_MS) return refuse('too fast');
    b.setAt = now();
    room.setInvisible(b.person, false, 'band');
    room.arm(b.person, m.intent, 'band');
    return true;
  }

  /**
   * A wave back from the wrist, to the newest who waved at its person
   * (docs/superpowers/specs/2026-09-25-wrist-waves-design.md §3). The relay
   * answers ok, or no and why; a refused wave changes nothing and tells
   * nobody else. Returns whether it landed.
   */
  function waveFromBand(ws, b, m) {
    // Dropped whole, unanswered and unstamped, unless it is exactly a wave.
    if (typeof m.ref !== 'string' || !/^[a-f0-9]{10}$/.test(m.ref) || !Number.isInteger(m.basis)) return false;
    const answer = (why) => { ws.send(JSON.stringify(why ? { t: 'wave', ok: false, why } : { t: 'wave', ok: true })); return !why; };
    // Stamped before anything is looked up, refused or not: finding a handle is a pass over the room.
    if (now() - b.waveAt < WAVE_GAP_MS) return answer('too fast');
    b.waveAt = now();
    if (!b.person) return answer('unpaired');
    const room = rooms.get(b.key)?.room;
    if (!room?.has(b.person)) return answer('no room');
    if (m.basis !== room.revOf(b.person) || room.armedOf(b.person) !== 'hi') return answer('changed');
    // Not someone who waved at its person, or no longer someone it may wave at. A block must read exactly as
    // leaving (promise 4). A band never starts a wave: with none to answer, nothing is recorded.
    if (!room.wavedAtYou(b.person, m.ref) || room.wave(b.person, m.ref) === false) return answer('gone');
    return answer(null);
  }

  /**
   * We found each other, said on the wrist's meeting face
   * (docs/superpowers/specs/2026-09-26-wrist-found-design.md §2): for its
   * person's meeting with that number, under MEET_MS old and not yet found by
   * both. The relay answers ok, or no and why; a refused one changes nothing
   * and tells nobody. Returns whether it landed.
   */
  function foundFromBand(ws, b, m) {
    // Dropped whole, unanswered and unstamped, unless it is exactly a found: a meeting's number is two digits.
    if (typeof m.number !== 'string' || !/^[1-9][0-9]$/.test(m.number)) return false;
    const answer = (why) => { ws.send(JSON.stringify(why ? { t: 'found', ok: false, why } : { t: 'found', ok: true })); return !why; };
    // Stamped before anything is looked up, refused or not: finding the meeting is a view of the person.
    if (now() - b.foundTry < FOUND_GAP_MS) return answer('too fast');
    b.foundTry = now();
    if (!b.person) return answer('unpaired');
    const room = rooms.get(b.key)?.room;
    if (!room?.has(b.person)) return answer('no room');
    // The meeting its face shows: the newest with that number. Over, found by both, or blocked, it is gone.
    const meeting = room.viewFor(b.person).matches
      .filter((x) => String(x.number) === m.number && now() - x.at < MEET_MS && !x.foundAt)
      .sort((x, y) => y.at - x.at)[0];
    if (!meeting || !room.found(b.person, meeting.id)) return answer('gone');
    return answer(null);
  }

  /**
   * A check turned away on the wrist: its person held the face button on a
   * number they did not ask for, which someone who read the letters off the
   * wrist may be holding open. It lands only on the check the wrist shows —
   * a hold that arrives after YES, or names another number, changes nothing.
   */
  function refuseFromBand(b, m) {
    // Only the number its check shows, said as the wrist shows it: two digits, in a string.
    if (b.pending && m.number === String(b.pending.number)) dropPending(b, 'refused');
  }

  function handleBand(ws, m) {
    const b = bands.get(ws.band);
    // Only from the wristband's current socket: a set stuck in a replaced one must not land.
    if (!b || b.ws !== ws) return;
    // What it heard is for the room's next tick, which pushes what changed: nothing to push now.
    if (m.t === 'heard') { heardFromBand(b, m); return; }
    // Dropping the check shows the new letters and pushes the room of the phone that typed.
    if (m.t === 'refuse') { refuseFromBand(b, m); return; }
    if (m.t === 'battery') b.battery = clampBattery(m.level);
    // Held: NOT NOW, from the wrist. The phone follows.
    if (m.t === 'hold') holdOn(b);
    if (m.t === 'set' && !setFromBand(ws, b, m)) return;
    if (m.t === 'wave' && !waveFromBand(ws, b, m)) return;
    if (m.t === 'found' && !foundFromBand(ws, b, m)) return;
    const r = b.key ? rooms.get(b.key) : null;
    if (r) push(r); else showBand(b);
  }

  /**
   * What a wristband heard of the others by radio (near spec §2): `ch`, its
   * Wi-Fi channel, and `near`, [air, rssi] pairs. From a band paired in a room,
   * at most every HEARD_GAP_MS, whole or not at all. An air counts only as the
   * air of exactly one band paired in the same room; the room itself ignores the
   * band's own person and anyone no longer in it. `marks`, when there, is the
   * markers it heard: [area, rssi] pairs, each area a key of MARKS and none twice
   * (markers spec §3).
   */
  function heardFromBand(b, m) {
    const r = b.person && b.key ? rooms.get(b.key) : null;
    if (!r?.room.has(b.person) || (b.heardAt !== undefined && now() - b.heardAt < HEARD_GAP_MS)) return;
    if (!Number.isInteger(m.ch) || m.ch < 1 || m.ch > 14 || !Array.isArray(m.near) || m.near.length > HEARD_MAX) return;
    const fits = (e) => Array.isArray(e) && e.length === 2 && typeof e[0] === 'string' && AIR.test(e[0])
      && Number.isInteger(e[1]) && e[1] >= -100 && e[1] <= 0;
    if (!m.near.every(fits)) return;
    // Each area once: a fourth pair is always one too many, so every() stops by then.
    const areas = new Set();
    const marks = (e) => Array.isArray(e) && e.length === 2 && Object.hasOwn(MARKS, e[0]) && !areas.has(e[0])
      && areas.add(e[0]) && Number.isInteger(e[1]) && e[1] >= -100 && e[1] <= 0;
    if (m.marks !== undefined && !(Array.isArray(m.marks) && m.marks.every(marks))) return;
    b.heardAt = now();
    // A band has its room's key only while it is paired there.
    const here = [...bands.values()].filter((o) => o.key === b.key);
    const near = [];
    for (const [air, rssi] of m.near) {
      const who = here.filter((o) => o.air === air);
      if (who.length === 1) near.push({ id: who[0].person, rssi });
    }
    r.room.heard(b.person, { ch: m.ch, near, marks: (m.marks ?? []).map(([area, rssi]) => ({ area, rssi })) });
  }

  function refuseBand(ws) {
    ws.send(JSON.stringify({ t: 'error', why: 'bad band' }));
    ws.close(4001, 'bad band');
  }

  function hello(ws, m) {
    if (ws.r) { ws.send(JSON.stringify({ t: 'error', why: 'bad band' })); return; }
    const id = String(m.id || '');
    const v2 = m.v === 2;
    const key = String(m.key || '');
    // The key proves the id; a socket says hello once.
    const proven = v2 ? HEX32.test(id) && HEX32.test(key) && bandIdOf(key) === id : /^[a-f0-9]{16,64}$/.test(id);
    if (ws.band || !proven) { refuseBand(ws); return; }
    // Its radio, if it has one: twelve hex digits, or no hello at all.
    if (m.air !== undefined && !AIR.test(String(m.air))) { refuseBand(ws); return; }
    const secret = HEX32.test(String(m.secret || '')) ? String(m.secret) : null;
    const proof = secret && secretHashOf(secret);
    let b = bands.get(id);
    // A hello with no version never reaches a record made by one with, nor the other way round.
    if (b && b.old === v2) { refuseBand(ws); return; }
    // A paired record is only reached with its secret. The live socket is left alone.
    if (b?.person && b.everWs && proof !== b.secretHash) { refuseBand(ws); return; }
    if (b?.person && !b.everWs && proof !== b.secretHash) {
      // A phone was back first and holds a placeholder, but not with this wristband's secret.
      const r = rooms.get(b.key);
      if (r) toPerson(r, b.person, { t: 'claim', ok: false, why: 'gone' });
      bands.delete(id);
      b = null;
      if (r) push(r);
    }
    if (!b) {
      if (bands.size >= maxBands && !evictBand(now())) { ws.send(JSON.stringify({ t: 'error', why: 'too many wristbands' })); return; }
      b = makeBand(id, ws);
      b.old = !v2;
      // A secret the relay does not know: it restarted, and this wristband waits for its owner.
      if (secret) Object.assign(b, { waiting: true, secretHash: proof, waitingAt: now() });
      bands.set(id, b);
    }
    // Replaced, not cut off: it may still be closing, and its frames are dropped from here on.
    if (b.ws && b.ws !== ws) b.ws.close(4000, 'replaced');
    b.ws = ws;
    b.everWs = true;
    b.lastShow = null;
    b.air = m.air === undefined ? null : String(m.air);
    ws.band = id;
    if (m.battery !== undefined) b.battery = clampBattery(m.battery);
    if (!b.person && !b.code && !b.pending && !b.waiting) freshLetters(b);
    const r = b.key ? rooms.get(b.key) : null;
    if (r) stopGrace(r, b.person);
    if (m.quiet === true) holdOn(b);
    if (r) push(r); else showBand(b);
  }

  function checkNumber() {
    // Two digits, like a meeting number, and not one another pairing is showing.
    const taken = new Set([...bands.values()].filter((b) => b.pending).map((b) => b.pending.number));
    let n = 10 + randomInt(90);
    for (let i = 0; i < 90 && taken.has(n); i += 1) n = n === 99 ? 10 : n + 1;
    return n;
  }

  /** By the four letters. Nothing pairs yet: the wristband that was reached shows a number, and the phone is asked. */
  function pairByCode(ws, r, me, m) {
    const error = (why) => ws.send(JSON.stringify({ t: 'error', why }));
    if (tooMany(ws)) { error('too many tries'); return; }
    attempt(ws);   // every attempt counts, right or wrong
    const b = bands.get(codes.get(cleanCode(m.code)));
    if (!b) { error('no such wristband'); return; }
    if (b.old) { error('old firmware'); return; }
    if (b.pending) { error('busy'); return; }
    const mine = pendingOf(r.key, me);
    if (mine) dropPending(mine, null);   // one pending per person: the newest letters win
    b.pending = { key: r.key, person: me, number: checkNumber(), until: now() + pairCheckMs };
    showBand(b);
  }

  function confirm(r, me, m) {
    const b = pendingOf(r.key, me);
    if (!b) return;
    if (m.yes !== true) { dropPending(b, null); return; }
    if (!b.ws) { dropPending(b, 'timeout'); return; }   // nothing on the wrist to give a secret to
    const old = bandOf(r.key, me);
    if (old) unpairBand(old);
    codes.delete(b.code);
    const secret = randomBytes(16).toString('hex');
    Object.assign(b, { pending: null, code: null, key: r.key, person: me, secretHash: secretHashOf(secret) });
    // Paired: it flashes white once, so the right wrist knows it was the one.
    b.testUntil = now() + 900;
    // The secret itself goes out once, to the wrist and to the phone; the relay keeps its hash.
    b.ws.send(JSON.stringify({ t: 'paired', secret }));
    toPerson(r, me, { t: 'paired', band: b.id, secret });
  }

  /** After a reconnect, by the id and the secret this phone was given. */
  function claim(ws, r, me, m) {
    const id = String(m.band || '');
    const secret = String(m.secret || '');
    const answer = (x) => ws.send(JSON.stringify({ t: 'claim', ...x }));
    const b = bands.get(id);
    const proven = HEX32.test(secret) && b?.secretHash === secretHashOf(secret);
    if (proven && b.key === r.key && b.person === me) {
      // Its own wristband — or its own placeholder, still waiting for the wristband.
      answer(b.everWs ? { ok: true, band: id } : { ok: false, why: 'waiting' });
      return;
    }
    if (proven && b.waiting) {
      // After a relay restart the wristband was back first, and this is its owner.
      const old = bandOf(r.key, me);
      if (old) unpairBand(old);
      Object.assign(b, { waiting: false, key: r.key, person: me });
      if (b.quiet) r.room.setInvisible(me, true, 'band');
      b.quiet = false;
      answer({ ok: true, band: id });
      return;
    }
    // Unproven from here, and counted: a claim is how the ids would be walked.
    if (tooMany(ws)) { ws.send(JSON.stringify({ t: 'error', why: 'too many tries' })); return; }
    attempt(ws);
    if (b || gone.has(id) || !HEX32.test(id) || !HEX32.test(secret)) { answer({ ok: false, why: 'gone' }); return; }
    // The phone is back before its wristband: a placeholder with that secret, one per person.
    for (const p of [...bands.values()]) if (!p.everWs && p.key === r.key && p.person === me) bands.delete(p.id);
    if (bands.size >= maxBands && !evictBand(now())) { ws.send(JSON.stringify({ t: 'error', why: 'too many wristbands' })); return; }
    bands.set(id, Object.assign(makeBand(id, null), { key: r.key, person: me, secretHash: secretHashOf(secret) }));
    answer({ ok: false, why: 'waiting' });
  }

  /** The video held in memory, all rooms together: what the clip caps are held to, and what the load line says. */
  function clipBytes() {
    let n = 0;
    for (const r of rooms.values()) for (const c of r.clips.values()) n += c.buf.length;
    return n;
  }

  /**
   * One clip per person per slot: 'floor' for everyone, or 'to:<handle>' for a
   * dance back. A new one replaces the old; past every room's cap together the
   * oldest go, in whichever room. A floor clip that goes is taken off the floor
   * rather than left to 404.
   */
  function keepClip(r, id, mime, data, slot) {
    const buf = Buffer.from(String(data || ''), 'base64');
    if (!buf.length || buf.length > CLIP_MAX || !/^video\/(webm|mp4)/.test(String(mime))) return null;
    const drop = (room, ref, c) => {
      room.clips.delete(ref);
      if (c.slot === 'floor' && room.room.has(c.by)) {
        room.room.postClip(c.by, null);
        if (room !== r) push(room);   // this room is pushed by the message that brought the clip
      }
    };
    for (const [ref, c] of r.clips) if (c.by === id && c.slot === slot) r.clips.delete(ref);
    const every = [...rooms.values()].flatMap((room) => [...room.clips].map(([ref, c]) => [room, ref, c]));
    let all = every.reduce((n, [, , c]) => n + c.buf.length, 0) + buf.length;
    for (const [room, ref, c] of every.sort((a, b) => a[2].at - b[2].at)) {
      if (all <= allClipsMax) break;
      drop(room, ref, c);
      all -= c.buf.length;
    }
    const ref = randomBytes(12).toString('hex');
    r.clips.set(ref, { mime: String(mime).split(';')[0], buf, by: id, slot, at: now() });
    return ref;
  }

  // ---------- staff (docs/superpowers/specs/2026-09-28-staff-reports-design.md §3) ----------
  // A socket is a phone, a wristband or staff, and only one. Staff sign in with their venue's passcode, or the
  // token a right one got tonight, and are then sent the venue's reports; they can only mark them.

  async function staffIn(ws, m) {
    const answer = (x) => ws.send(JSON.stringify({ t: 'staff', ...x }));
    if (ws.staffing) return;   // one sign-in at a time: the page waits for its answer
    if (ws.me || ws.band) { answer({ ok: false, why: 'bad staff' }); return; }
    const key = venueKey(m.venue);
    if (typeof m.token === 'string') {
      const t = tokens.get(tokenHashOf(m.token));
      if (!t || t.key !== key || t.night !== nightOf(now(), nightTz)) { answer({ ok: false, why: 'expired' }); return; }
      signIn(ws, key, m.token, t.night);
      return;
    }
    if (typeof m.code !== 'string') { answer({ ok: false, why: 'bad staff' }); return; }
    if (tooMany(ws)) { answer({ ok: false, why: 'too many tries' }); return; }
    // Busy: four threads run the checks, and a queue behind them only helps whoever is guessing. It is the relay
    // that is full, so it is not counted against this socket or this address (§2).
    if (checking >= CHECKS_AT_ONCE) { answer({ ok: false, why: 'too many tries' }); return; }
    attempt(ws);   // every sign-in by passcode counts, right or wrong, on the pairing counters
    const entry = staffEntries.get(key);
    if (!entry) { answer({ ok: false, why: 'no staff page' }); return; }
    ws.staffing = true;
    checking += 1;
    let right;
    try {
      right = await staffCheck(entry, m.code.slice(0, CODE_MAX));
    } finally {
      checking -= 1;
      ws.staffing = false;
    }
    if (closing || ws.readyState !== ws.OPEN) return;
    // It may have joined as a phone, or said hello as a wristband, while the check ran.
    if (ws.me || ws.band) { answer({ ok: false, why: 'bad staff' }); return; }
    if (!right) { answer({ ok: false, why: 'wrong code' }); return; }
    const token = randomBytes(16).toString('hex');
    const night = nightOf(now(), nightTz);
    tokens.set(tokenHashOf(token), { key, night, entry: printOf(key) });
    // This venue's own first (oldest first, the new one last), so a flood of sign-ins here cannot reach another venue's.
    const here = [...tokens].filter(([, t]) => t.key === key);
    for (const [hash] of here.slice(0, Math.max(0, here.length - staffTokensPerVenue))) tokens.delete(hash);
    if (tokens.size > staffTokensMax) tokens.delete(tokens.keys().next().value);
    signIn(ws, key, token, night);
  }

  function signIn(ws, key, token, night) {
    const r = roomFor(key);
    if (!r) { ws.send(JSON.stringify({ t: 'staff', ok: false, why: 'too many venues' })); return; }
    // Its token's hash too: a subscription or a sign-out names the sign-in it came from (push spec §3).
    ws.staff = { key, night, hash: tokenHashOf(token) };
    r.staff.add(ws);
    ws.send(JSON.stringify({ t: 'staff', ok: true, venue: key, token, push: pusher.publicKey }));
    reportsTo(r, new Set([ws]));
  }

  /** A staff socket marks a report of its own venue handled, or opens it again: every staff screen there sees it. */
  function handledBy(ws, m) {
    if (typeof m.id !== 'string' || typeof m.on !== 'boolean') return;
    const r = rooms.get(ws.staff.key);
    // Only while signed in there: a socket signed out at 06:00 may still be closing.
    if (r?.staff.has(ws) && r.room.markHandled(m.id, m.on)) push(r);
  }

  // ---------- staff devices' notifications (docs/superpowers/specs/2026-09-29-staff-push-design.md §3) ----------

  /** Tonight's sign-ins at a venue that hold a subscription, the oldest subscription first. */
  function subscribed(key) {
    const tonight = nightOf(now(), nightTz);
    return [...tokens.values()].filter((t) => t.key === key && t.night === tonight && t.push).sort((a, b) => a.push.at - b.push.at);
  }

  /** A signed-in staff device's subscription, onto its sign-in: one a sign-in, an endpoint once, 50 a venue. */
  function pushFrom(ws, m) {
    const t = tokens.get(ws.staff.hash);
    const sub = subscriptionOf(m.sub, pushAllowed);
    if (!t || !sub) { ws.send(JSON.stringify({ t: 'push', ok: false, why: 'bad push' })); return; }
    for (const other of tokens.values()) if (other.push?.endpoint === sub.endpoint) delete other.push;
    const held = subscribed(t.key).filter((x) => x !== t);
    while (held.length >= PUSH_SUBS_MAX) delete held.shift().push;
    t.push = { ...sub, at: now() };
    ws.send(JSON.stringify({ t: 'push', ok: true }));
  }

  /** SIGN OUT: the sign-in goes, with its subscription, and every socket signed in with it is signed out. */
  function signOutFrom(ws) {
    const { key, hash } = ws.staff;
    tokens.delete(hash);
    const r = rooms.get(key);
    for (const s of [...(r?.staff ?? [])]) {
      if (s.staff.hash !== hash) continue;
      r.staff.delete(s);
      s.send(JSON.stringify({ t: 'staff', ok: false, why: 'signed out' }));
      s.close(4004, 'signed out');
    }
  }

  // ---------- sending (push spec §4) ----------

  // A venue's staff devices hear of new reports at most once a window: key -> { again, timer }.
  const alerts = new Map();
  const openAt = (key) => rooms.get(key)?.room.reports().filter((x) => !x.handledAt).length ?? 0;

  /** A report was taken at `key`: its devices are told now, or when the window ends. */
  function alertStaff(key) {
    const w = alerts.get(key);
    if (w) { w.again = true; return; }
    pushAll(key);
  }

  /**
   * Every device subscribed at `key` is sent the venue and how many are open, and a window opens. A report in it
   * brings one more push when it ends, unless nothing is open by then. A push service's 404, 410 or 403 forgets that
   * device. The log says how many, never to whom.
   */
  function pushAll(key) {
    const w = { again: false, timer: null };
    alerts.set(key, w);
    w.timer = setTimeout(() => {
      alerts.delete(key);
      if (w.again && openAt(key) > 0) pushAll(key);
    }, pushEveryMs);
    const held = subscribed(key);
    if (!held.length) return;
    const payload = { venue: shows.find((s) => s.id === key)?.venue ?? key, open: openAt(key) };
    Promise.all(held.map((t) => {
      const sub = t.push;
      return pusher.send(sub, payload).then((status) => ({ t, sub, status }));
    })).then((results) => {
      let sent = 0;
      let gone = 0;
      let failed = 0;
      for (const { t, sub, status } of results) {
        if (typeof status === 'number' && status >= 200 && status < 300) sent += 1;
        else if (status === 404 || status === 410 || status === 403 || status === 'refused') {
          gone += 1;
          if (t.push === sub) delete t.push;   // unless the device has sent a new one since
        } else failed += 1;
      }
      console.log('push: ' + key + ' ' + sent + ' sent, ' + gone + ' gone, ' + failed + ' failed');
    });
  }

  function handle(ws, m) {
    // A phone of theirs was heard: any message, pings included (rule 2).
    if (ws.r && ws.me) ws.r.heard.set(ws.me, now());
    if (m.t === 'ping') { ws.send('{"t":"pong"}'); return; }
    // A signed-in staff socket only marks reports, hands over its device's subscription, or signs out: what a
    // phone or a wristband would say is ignored.
    if (ws.staff) {
      if (m.t === 'handled') handledBy(ws, m);
      if (m.t === 'push') pushFrom(ws, m);
      if (m.t === 'signout') signOutFrom(ws);
      return;
    }
    // Its check runs off the event loop; a failure there ends this socket, never the process.
    if (m.t === 'staff') { staffIn(ws, m).catch(() => ws.terminate()); return; }
    if (m.t === 'wristband') { hello(ws, m); return; }
    if (ws.band) { handleBand(ws, m); return; }
    if (m.t === 'join') {
      const key = venueKey(m.venue);
      const said = String(m.me || '');
      if (!key || !/^[a-f0-9]{16,64}$/.test(said)) { ws.send(JSON.stringify({ t: 'error', why: 'bad join' })); return; }
      // Its hash from here on: the id a phone says is what makes it that person (restart spec §4).
      const me = personOf(said);
      // A socket stands for one person in one room. Joining as someone else, or somewhere else, is leaving as
      // whoever it stood for — at once, unless another phone or a live wristband of theirs still holds them —
      // or one socket could leave people behind with no phone and no grace, on SAY HI for as long as the venue
      // is busy. The app itself opens a new socket for a new venue or a new night.
      if (ws.r && (ws.r.key !== key || ws.me !== me)) {
        const was = ws.r;
        was.sockets.delete(ws);
        ws.r = null;
        if (!phoneOf(was, ws.me) && !bandOf(was.key, ws.me)?.ws) {
          stopGrace(was, ws.me);
          leaveRoom(was, ws.me);
        }
      }
      const nextRoom = roomFor(key);
      if (!nextRoom) { ws.send(JSON.stringify({ t: 'error', why: 'too many venues' })); return; }
      ws.r = nextRoom;
      ws.me = me;
      stopGrace(ws.r, me);
      ws.r.heard.set(me, now());
      // `quiet` counts only if this join makes the person.
      ws.r.room.join(me, { quiet: m.quiet === true });
      // A hold on their wristband while they were out of the room.
      const b = bandOf(key, me);
      if (b?.quiet) { ws.r.room.setInvisible(me, true, 'band'); b.quiet = false; }
      ws.r.sockets.add(ws);
      push(ws.r);
      return;
    }
    const r = ws.r;
    if (!r) return;
    const room = r.room, me = ws.me;
    switch (m.t) {
      case 'profile': room.setProfile(me, { name: m.name, contact: m.contact }); break;
      case 'arm':
      case 'invisible':
        // Rules 3 to 5 are in room.fromPhone(). A seq that is there but not a number drops the frame.
        if ('seq' in m && !Number.isFinite(m.seq)) return;
        if (room.fromPhone(me, m) === 'changed') ws.send(JSON.stringify({ t: 'refused', why: 'changed', seq: Number.isFinite(m.seq) ? m.seq : 0 }));
        break;
      case 'pair':
        if (m.code !== undefined && m.code !== null) pairByCode(ws, r, me, m);
        else claim(ws, r, me, m);
        break;
      case 'confirm': confirm(r, me, m); break;
      case 'unpair': { const b = bandOf(r.key, me); if (b) unpairBand(b); break; }
      case 'testLight': {
        const b = bandOf(r.key, me);
        if (b) { b.testUntil = now() + 2000; showBand(b); }
        break;
      }
      case 'sound':
        // The person's own switch, for their own band's shows. Like TEST THE LIGHT it reaches nobody else's.
        if (typeof m.on !== 'boolean') return;
        r.sound.set(me, m.on);
        break;
      case 'pick': room.pick(me, m.track); break;
      case 'wave': room.wave(me, m.handle); break;
      case 'like': room.like(me, m.handle); break;
      case 'unlike': room.unlike(me, m.handle); break;
      case 'block': room.block(me, m.handle); break;
      case 'report': {
        // Ten an hour a person and sixty a network. Both count every report sent, so one who keeps sending stays
        // refused; a refused report is neither kept, logged nor pushed.
        const at = now();
        const person = reportsBy.take(r.key + '|' + me, at);
        const network = reportsFrom.take(ws.addr, at);
        if (!person || !network) { ws.send(JSON.stringify({ t: 'error', why: 'report refused' })); break; }
        // To the venue's staff page, with the push below, and to its staff devices' notifications. The log says
        // one came and nothing it says: logs are kept.
        if (room.report(me, m.handle || null, m.why)) {
          console.log('REPORT', plain(r.key), room.reports().at(-1).id);
          alertStaff(r.key);
        }
        break;
      }
      case 'keep': room.keep(me, m.match, m.on); break;
      case 'found': room.found(me, m.match); break;
      case 'clip': {
        const to = m.to ? String(m.to) : null;
        const ref = keepClip(r, me, m.mime, m.data, to ? 'to:' + to : 'floor');
        if (!ref) { ws.send(JSON.stringify({ t: 'error', why: 'clip refused' })); return; }
        if (!to) room.postClip(me, ref);
        else if (room.danceBack(me, to, ref) === false) {
          // They are gone, blocked or invisible. Keep nothing for nobody.
          r.clips.delete(ref);
          ws.send(JSON.stringify({ t: 'error', why: 'clip refused' }));
          return;
        }
        ws.send(JSON.stringify({ t: 'sent', to }));
        break;
      }
      case 'leave': {
        // Carried until it is heard: the phone re-sends it until this answer comes.
        const b = bandOf(r.key, me);
        if (b) unpairBand(b);
        stopGrace(r, me);
        r.sound.delete(me);
        room.leave(me);
        r.sockets.delete(ws);
        ws.r = null;
        ws.send(JSON.stringify({ t: 'left' }));
        gcRoom(r);
        break;
      }
      default: return;
    }
    push(r);
  }

  /**
   * /clip/<venue>/<ref>.<ticket>: the clip, only for the viewer the ticket was made for, and only while their own
   * view shows it — so not once either has blocked the other, its owner is NOT NOW, or the viewer has left. A
   * browser must ask again before it plays it again, and is told the same.
   */
  function serveClip(req, res, url) {
    const [, , key, address] = url.split('?')[0].split('/');
    const [ref = '', ticket = ''] = String(address || '').split('.');
    let r = null;
    try { r = rooms.get(venueKey(decodeURIComponent(key || ''))); } catch { /* malformed */ }
    const c = r?.clips.get(ref);
    const same = (id) => {
      const want = Buffer.from(ticketFor(ref, id));
      const got = Buffer.from(ticket);
      return got.length === want.length && timingSafeEqual(got, want);
    };
    const viewer = c ? r.room.ids().find(same) : undefined;
    const view = viewer ? r.room.viewFor(viewer) : null;
    if (!view || !(view.me.clip === ref || view.floor.some((f) => f.ref === ref))) { res.writeHead(404).end(); return; }
    const etag = '"' + ref + '"';
    const head = { 'content-type': c.mime, 'cache-control': 'private, no-cache', etag, 'x-content-type-options': 'nosniff' };
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, head).end(); return; }
    res.writeHead(200, head).end(c.buf);
  }

  /** A file from dist/, the staff page at /staff, or the app itself for any route it owns. Never anything outside dist/. */
  function serveStatic(res, url) {
    let file = join(dist, /^\/staff\/?$/.test(url.split('?')[0]) ? 'staff.html' : 'index.html');
    try {
      const want = join(dist, normalize(decodeURIComponent(url.split('?')[0])).replace(/^([/\\])+/, ''));
      const inside = relative(dist, want);
      if (inside && !inside.startsWith('..') && !isAbsolute(inside) && extname(want) && existsSync(want)) file = want;
    } catch { /* a malformed escape is just a route the app does not have */ }
    if (!existsSync(file)) { res.writeHead(503).end('build the app first: npm run build'); return; }
    const hashed = /[/\\]assets[/\\]/.test(file);
    // A page nobody may frame, each under its own full policy, chosen by the file that is served (§4).
    const page = extname(file) === '.html'
      ? { 'x-frame-options': 'DENY', 'content-security-policy': file === join(dist, 'staff.html') ? STAFF_POLICY : appPolicy }
      : {};
    res.writeHead(200, {
      'content-type': TYPES[extname(file)] || 'application/octet-stream',
      'cache-control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
      'x-content-type-options': 'nosniff',
      ...page,
    }).end(readFileSync(file));
  }

  const server = createServer((req, res) => {
    // On every response, a 404, a 304 and a 503 included (§4). HSTS only where the request came in over https, as
    // Fly's proxy says: the relay itself never speaks TLS.
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('referrer-policy', 'no-referrer');
    if (String(req.headers['x-forwarded-proto'] ?? '').split(',')[0].trim() === 'https') res.setHeader('strict-transport-security', 'max-age=31536000');
    const url = req.url || '/';
    if (url === '/api/shows') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff' }).end(showsJson);
    } else if (url.startsWith('/clip/')) serveClip(req, res, url);
    else serveStatic(res, url);
  });

  /**
   * Who is guessing. Behind the tunnel every socket comes from this machine and
   * cloudflared names the real address; a header from anywhere else is a claim
   * anyone can make, so there the socket's own address stands. On a host whose
   * proxy is the only way in and names each client (`clientIpHeader`, e.g.
   * Fly.io's fly-client-ip), that name is the address. An IPv6 address counts as its /64 (relay/address.js): anyone
   * on such a network holds 2^64 addresses, and would get an allowance for each.
   */
  function addressOf(req) {
    const a = req.socket.remoteAddress || '';
    const named = clientIpHeader ? req.headers[clientIpHeader] : undefined;
    if (named) return addressKey(String(named).slice(0, 64));
    const cf = req.headers['cf-connecting-ip'];
    return addressKey(cf && (a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1') ? String(cf).slice(0, 64) : a);
  }
  const recent = (list, now) => list.filter((t) => now - t < TRIES_MS);
  function tooMany(ws, now = clock()) {
    ws.fails = recent(ws.fails, now);
    return ws.fails.length >= SOCKET_TRIES || recent(tries.get(ws.addr) || [], now).length >= ADDRESS_TRIES;
  }
  function attempt(ws, now = clock()) {
    ws.fails.push(now);
    tries.set(ws.addr, [...recent(tries.get(ws.addr) || [], now), now]);
  }

  const wss = new WebSocketServer({
    server, path: WS_PATH, maxPayload: MAX_FRAME,
    // Only this site's pages, the wristband and tools that set no Origin (§5): anything else is 403 before a socket exists.
    verifyClient: ({ origin, req }, done) => (originAllowed(origin, req.headers.host) ? done(true) : done(false, 403, 'origin not allowed')),
  });
  wss.on('connection', (ws, req) => {
    ws.addr = addressOf(req);
    ws.fails = [];
    ws.alive = true;
    // Its frame budget, on the real clock: FRAMES_AT_ONCE, earned back at FRAMES_A_SECOND.
    ws.frames = FRAMES_AT_ONCE;
    ws.framesAt = Date.now();
    ws.clips = CLIPS_AT_ONCE;
    ws.clipsAt = ws.framesAt;
    ws.on('pong', () => { ws.alive = true; });
    // An oversized or broken frame ends this socket, never the process.
    ws.on('error', () => ws.terminate());
    ws.on('message', (data) => {
      const t = Date.now();
      ws.frames = Math.min(FRAMES_AT_ONCE, ws.frames + ((t - ws.framesAt) * FRAMES_A_SECOND) / 1000);
      ws.framesAt = t;
      // Far faster than any phone or wristband: closed before its frame is even read.
      if (ws.frames < 1) { ws.close(4003, 'too fast'); return; }
      ws.frames -= 1;
      if (data.length >= BIG_FRAME) {
        ws.clips = Math.min(CLIPS_AT_ONCE, ws.clips + (t - ws.clipsAt) / clipEveryMs);
        ws.clipsAt = t;
        if (ws.clips < 1) { ws.send(JSON.stringify({ t: 'error', why: 'clip too fast' })); return; }
        ws.clips -= 1;
      }
      let m;
      try { m = JSON.parse(String(data)); } catch { return; }
      if (m && typeof m.t === 'string') handle(ws, m);
    });
    ws.on('close', () => {
      if (ws.staff) {
        const sr = rooms.get(ws.staff.key);
        if (sr) {
          sr.staff.delete(ws);
          if (!closing) gcRoom(sr);
        }
        return;
      }
      const b = ws.band && bands.get(ws.band);
      if (b && b.ws === ws) {
        b.ws = null;
        b.goneAt = now();
        // A wristband nobody has claimed keeps its letters for a minute, so a
        // dropped connection does not change the code someone is typing. The
        // sweep forgets it after that.
        const br = b.key ? rooms.get(b.key) : null;
        if (br) {
          if (b.person && !phoneOf(br, b.person)) startGrace(br, b.person);
          push(br);
        }
      }
      const r = ws.r;
      if (!r || closing) return;
      r.sockets.delete(ws);
      if (phoneOf(r, ws.me) || bandOf(r.key, ws.me)?.ws) return;
      startGrace(r, ws.me);
    });
  });

  const beat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.alive) { ws.terminate(); continue; }
      ws.alive = false;
      ws.ping();
    }
  }, PING_MS);

  // An hour on the floor, then gone — from the floor and from memory.
  const sweep = setInterval(() => expire(now()), 60_000);
  // A pairing check that timed out, and every wristband's face, once a second.
  function tickBands(at = now()) {
    for (const b of [...bands.values()]) if (b.pending && at >= b.pending.until) dropPending(b, 'timeout');
    for (const b of bands.values()) showBand(b, at);
  }
  const lights = setInterval(() => tickBands(), 1000);
  // Who is near whom, worked out in each room; only the views that changed are sent (push).
  function tickNear() {
    for (const r of rooms.values()) if (r.room.nearTick()) push(r);
  }
  const nearly = setInterval(() => tickNear(), NEAR_TICK_MS);
  // The relay's own load, said every loadEveryMs while anyone is on it (relay/load.js): counts and sizes, no names. The
  // meter is read when nobody is too, so the first line after a quiet spell covers its own minute, not everything since.
  const meter = loadEveryMs > 0 ? (loadMeter ?? createMeter()) : null;
  function reportLoad() {
    const sample = meter.sample();
    const venues = new Set();
    let phones = 0;
    let staff = 0;
    let live = 0;
    for (const r of rooms.values()) {
      phones += r.sockets.size;
      staff += r.staff.size;
      if (r.sockets.size || r.staff.size) venues.add(r.key);
    }
    for (const b of bands.values()) {
      if (!b.ws) continue;
      live += 1;
      if (b.key) venues.add(b.key);
    }
    if (phones || staff || live) loadSay(formatLoad({ phones, bands: live, staff, venues: venues.size, ...sample, clips: clipBytes() }));
  }
  const loading = meter ? setInterval(reportLoad, loadEveryMs) : null;
  // A venue with nobody in it, nobody in its grace window, no staff signed in, no clip still loading
  // and no wristband still worn holds nothing — so it is let go, or a long-lived
  // relay would keep a room object for every venue anyone ever typed.
  function gcRoom(r) {
    if (r.sockets.size || r.left.size || r.clips.size || r.staff.size) return;
    // A venue with a staff page keeps tonight's reports for its team once everyone has gone; 06:00 clears them.
    if (staffEntries.has(r.key) && r.room.hasReports()) return;
    for (const b of bands.values()) if (b.key === r.key && b.ws) return;
    rooms.delete(r.key);
  }

  function expire(at) {
    const night = (t) => nightOf(t, nightTz);
    for (const b of [...bands.values()]) {
      // Nobody came for a wristband waiting after a restart: it is new to the relay again.
      if (b.waiting && (at - b.waitingAt >= bandAloneMs || night(b.waitingAt) !== night(at))) { freshLetters(b); showBand(b, at); continue; }
      if (b.ws) continue;
      const idle = at - (b.goneAt || b.claimedAt || at);
      const dead = b.person ? idle >= bandAloneMs : idle >= BAND_GRACE_MS;
      if (!dead) continue;
      if (b.person) forget(b.id, at);   // a paired wristband away for the hour, or a placeholder nobody answered
      codes.delete(b.code);
      bands.delete(b.id);
    }
    // Someone held only by their wristband leaves an hour after a phone of theirs
    // was last heard, or when the night ends at 06:00, whichever is first.
    for (const r of [...rooms.values()]) {
      for (const me of r.room.ids()) {
        if (phoneOf(r, me) || r.left.has(me) || !bandOf(r.key, me)?.ws) continue;
        const heard = r.heard.get(me) ?? 0;
        if (at - heard >= bandAloneMs || night(heard) !== night(at)) leaveRoom(r, me);
      }
    }
    // A wristband still worn when the night ends, with no phone of its person's here and none heard since, goes back to
    // four letters, as one waiting for its owner does. Otherwise it stays paired to last night's person for as long as it
    // is on, and keeps their room (matches, blocks, NOT NOWs) open in memory and in the night file: the room goes below.
    for (const b of [...bands.values()]) {
      if (!b.ws || !b.person || b.waiting) continue;
      const r = rooms.get(b.key);
      if (r && phoneOf(r, b.person)) continue;
      const heard = r?.heard.get(b.person);
      if (heard === undefined || night(heard) === night(at)) continue;
      freshLetters(b);
    }
    for (const [addr, list] of tries) {
      const left = recent(list, at);
      if (left.length) tries.set(addr, left); else tries.delete(addr);
    }
    reportsBy.prune(at);
    reportsFrom.prune(at);
    for (const r of rooms.values()) {
      let changed = false;
      for (const [ref, c] of r.clips) {
        if (at - c.at < CLIP_TTL_MS) continue;
        r.clips.delete(ref);
        if (c.slot === 'floor' && r.room.has(c.by)) r.room.postClip(c.by, null);
        changed = true;
      }
      if (changed) push(r);
    }
    // 06:00: a night's reports go, and staff signed in for it are signed out; the page asks for the passcode again.
    const tonight = night(at);
    for (const [token, t] of tokens) if (t.night !== tonight) tokens.delete(token);
    for (const r of rooms.values()) {
      for (const ws of [...r.staff]) {
        if (ws.staff.night === tonight) continue;
        r.staff.delete(ws);
        ws.send(JSON.stringify({ t: 'staff', ok: false, why: 'expired' }));
        ws.close(4004, 'expired');
      }
      if (r.room.forgetReports((t) => night(t) !== tonight)) push(r);
    }
    for (const r of [...rooms.values()]) gcRoom(r);
  }

  // ---------- the night across a restart (docs/superpowers/specs/2026-09-29-restart-persistence-design.md) ----------

  /** What a restart must carry (§1), as plain data: wristbands only with a person, or waiting for one. */
  function dumpNight() {
    return {
      staffKey: staffKey.toString('hex'),
      rooms: [...rooms.values()].map((r) => ({ key: r.key, room: r.room.dump(), heard: [...r.heard], sound: [...r.sound] })),
      bands: [...bands.values()].filter((b) => b.person || b.waiting).map((b) => ({
        id: b.id, old: b.old, key: b.key, person: b.person, secretHash: b.secretHash, everWs: b.everWs, live: !!b.ws,
        goneAt: b.goneAt, claimedAt: b.claimedAt, waiting: b.waiting, waitingAt: b.waitingAt, quiet: b.quiet, battery: b.battery,
      })),
      gone: [...gone],
      tokens: [...tokens],
    };
  }

  /**
   * The night file, if it holds tonight in a form this build reads (§2). Anything else is removed and the relay
   * starts empty: it never refuses to start over the file. What is logged is counts, never a name or an id.
   */
  function readNight() {
    if (!store) return null;
    let saved = null;
    let why = null;
    try {
      const text = store.read();
      if (text === null) { console.log('night: none at ' + store.path); return null; }
      saved = JSON.parse(text);
      const shaped = saved?.v === NIGHT_V && Number.isFinite(saved.at) && /^[a-f0-9]{64}$/.test(saved.staffKey)
        && [saved.rooms, saved.bands, saved.gone, saved.tokens].every(Array.isArray);
      if (!shaped) throw new TypeError('not a night file of version ' + NIGHT_V);
    } catch (e) {
      why = e.name;
    }
    if (!why && nightOf(saved.at, nightTz) !== nightOf(now(), nightTz)) why = 'another night';
    if (!why) return saved;
    console.log(why === 'another night' ? 'night: from another night, discarded' : 'night: unreadable (' + why + '), discarded');
    try { store.remove(); } catch { /* the next write replaces it */ }
    return null;
  }

  /**
   * A sign-in from the night file, or null when it was not made under its venue's passcode entry as it is now, or
   * records none (§1). A subscription that fails §3's checks now is left behind; the sign-in stays.
   */
  function tokenFrom({ key, night, entry, push }) {
    if (typeof entry !== 'string' || entry !== printOf(key)) return null;
    const sub = push && subscriptionOf({ endpoint: push.endpoint, keys: { p256dh: push.p256dh, auth: push.auth } }, pushAllowed);
    return sub ? { key, night, entry, push: { ...sub, at: Number(push.at) || 0 } } : { key, night, entry };
  }

  /**
   * The night read at start (§2), built whole and only then taken: a file that fails half way leaves nothing
   * behind. No socket is open yet, so everyone starts the usual grace from now, and a wristband that was worn
   * counts as gone from now: it could not reach a relay that was not there.
   */
  function restoreNight(saved) {
    let built;
    let ended = 0;   // sign-ins made under another entry than their venue's now, or under none on record (§1)
    try {
      built = {
        rooms: saved.rooms.map((e) => ({
          key: String(e.key), room: createRoom({ spots: spotsFor(e.key), now, restore: e.room, ledger: handles }),
          sockets: new Set(), clips: new Map(), left: new Map(), heard: new Map(e.heard), sound: new Map(e.sound), staff: new Set(),
        })),
        bands: saved.bands.map((e) => Object.assign(makeBand(String(e.id), null), {
          old: !!e.old, key: e.key, person: e.person, secretHash: e.secretHash, everWs: !!e.everWs,
          goneAt: e.live ? now() : e.goneAt, claimedAt: e.claimedAt, waiting: !!e.waiting, waitingAt: e.waitingAt,
          quiet: !!e.quiet, battery: e.battery,
        })),
        gone: new Map(saved.gone),
        tokens: new Map(saved.tokens.flatMap(([hash, t]) => {
          const kept = tokenFrom(t);
          if (!kept) ended += 1;
          return kept ? [[hash, kept]] : [];
        })),
      };
    } catch (e) {
      console.log('night: unreadable (' + e.name + '), discarded');
      try { store.remove(); } catch { /* the next write replaces it */ }
      return;
    }
    for (const r of built.rooms) rooms.set(r.key, r);
    for (const b of built.bands) bands.set(b.id, b);
    for (const [id, at] of built.gone) gone.set(id, at);
    for (const [hash, t] of built.tokens) tokens.set(hash, t);
    for (const r of built.rooms) for (const me of r.room.ids()) startGrace(r, me);
    const people = built.rooms.reduce((n, r) => n + r.room.size(), 0);
    console.log('night: carried on from ' + store.path + ' — ' + built.rooms.length + ' rooms, ' + people + ' people, '
      + built.bands.length + ' wristbands, ' + built.tokens.size + ' staff sign-ins');
    // Counts only, as the line above: which venue's passcode changed is for whoever changed it to know.
    if (ended) console.log('night: ' + ended + " staff sign-ins ended: their venue's passcode changed");
  }

  let lastText = null;   // the night as last written, less its `at`
  let failing = null;    // why the last write failed, said once

  /**
   * The night to its file if it changed since it was last written (§2): with `at` set to now, or removed when the
   * night holds nothing. 'off' with no file; 'same' when nothing changed and the file holds the night; 'written';
   * 'removed' when the night holds nothing, so there is no file, whether it was removed now or already gone; or
   * 'failed' — said once, and tried again next time.
   */
  function save() {
    if (!store) return 'off';
    const night = dumpNight();
    const text = JSON.stringify(night);
    const empty = !night.rooms.length && !night.bands.length && !night.tokens.length;
    // An empty night has no file to be the same as, and a stop must not call it written.
    if (text === lastText) return empty ? 'removed' : 'same';
    try {
      if (empty) store.remove();
      else store.write(JSON.stringify({ v: NIGHT_V, at: now(), ...night }));
    } catch (e) {
      const why = e.code || e.name;
      if (failing !== why) console.log('night: cannot write (' + why + ')');
      failing = why;
      return 'failed';
    }
    if (failing) console.log('night: writing again');
    failing = null;
    lastText = text;
    return empty ? 'removed' : 'written';
  }

  // Every saveEveryMs, written if it changed: an idle relay writes nothing.
  const keeper = store ? setInterval(() => save(), saveEveryMs) : null;

  if (saved) restoreNight(saved);

  return new Promise((resolve) => {
    server.listen(port, host, () => resolve({
      port: server.address().port,
      rooms,
      /** How many handles the rooms hold between them now (relay/room.js, handleLedger): a count for the tests. */
      handlesHeld: () => handles.held,
      /** The public key staff devices subscribe with (base64url): the page has it from its sign-in answer. */
      pushKey: pusher.publicKey,
      /** For tests: run the sweep — clips, wristbands, the band-alone hour, 06:00, old attempts — as if the clock read `at`. */
      expire,
      /** For tests: time out pairing checks and redraw every wristband as if the clock read `at`. */
      tickBands,
      /** For tests: work out who is near whom now, as the relay does every NEAR_TICK_MS. */
      tickNear,
      /** For tests: how many wristband records the relay is holding. */
      bandCount: () => bands.size,
      /** For tests: how many venue rooms the relay is holding. */
      roomCount: () => rooms.size,
      /** For tests: the bytes of video held in memory, every room's clips together. */
      clipBytes,
      /** For tests: the endpoints a venue's staff devices are held for, oldest first, whatever their night. */
      pushedTo: (key) => [...tokens.values()].filter((t) => t.key === key && t.push).sort((a, b) => a.push.at - b.push.at)
        .map((t) => t.push.endpoint),
      /** Writes the night now, as the relay does every saveEveryMs: 'off', 'same', 'written', 'removed' (no night, no file) or 'failed'. */
      save,
      close: () => new Promise((done) => {
        closing = true;
        clearInterval(beat);
        clearInterval(sweep);
        clearInterval(lights);
        clearInterval(nearly);
        clearInterval(loading);
        meter?.stop();
        clearInterval(keeper);
        for (const w of alerts.values()) clearTimeout(w.timer);
        // Written before a socket closes, so a wristband still worn is written worn (§2).
        save();
        for (const r of rooms.values()) {
          for (const t of r.left.values()) clearTimeout(t);
          clearTimeout(r.due);
        }
        for (const ws of wss.clients) ws.terminate();
        wss.close(() => server.close(() => done()));
      }),
    }));
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === normalize(process.argv[1])) {
  // The night's file: NIGHT_FILE, on Fly /data/night.json (fly.toml); without it, the night is in memory only.
  const nightFile = process.env.NIGHT_FILE || undefined;
  if (!nightFile) console.log('night: in memory only');
  // The keys staff devices' notifications are signed with: PUSH_KEYS_FILE, on Fly /data/push-keys.json.
  const pushKeysFile = process.env.PUSH_KEYS_FILE || undefined;
  if (!pushKeysFile) console.log('push: keys in memory only');
  // How often the relay says its load while anyone is on it: LOAD_EVERY_MS milliseconds, a minute when unset or not a
  // number a timer can count (Node would run a longer one every millisecond), and 0 for none. The first line says what
  // this machine allows; docs/show-night.md reads the rest.
  const loadEveryMs = /^\d+$/.test(process.env.LOAD_EVERY_MS ?? '') && Number(process.env.LOAD_EVERY_MS) <= 2 ** 31 - 1
    ? Number(process.env.LOAD_EVERY_MS) : 60_000;
  if (loadEveryMs) console.log(startLine());
  // The phone app's policy: APP_CSP is 'full' (also when unset or empty) or 'framing-only', the rule the live app ran under
  // before its policy was tried on an iPhone, which fly.toml keeps until it has been. Anything else stops the start.
  const appCsp = process.env.APP_CSP || 'full';
  const relay = await createRelay({
    // A number, 0 included (any free port); 8790 when unset.
    port: /^\d+$/.test(process.env.PORT ?? '') ? Number(process.env.PORT) : 8790,
    nightTz: process.env.NIGHT_TZ || undefined,
    clientIpHeader: process.env.CLIENT_IP_HEADER ? process.env.CLIENT_IP_HEADER.toLowerCase() : undefined,
    nightFile,
    pushKeysFile,
    loadEveryMs,
    appCsp,
  });
  console.log(appCsp === 'full' ? 'app policy: full' : 'app policy: the framing rule only (APP_CSP=framing-only)');
  console.log('ON THE BEAT relay on http://localhost:' + relay.port + '/');
  // Fly stops the machine with SIGINT on a deploy or a restart, and allows 5 s: the night is written before a
  // socket closes, and the process is gone within 3 s whatever the sockets do
  // (docs/superpowers/specs/2026-09-29-restart-persistence-design.md §2).
  const stop = () => {
    const how = relay.save();
    if (how === 'written' || how === 'same') console.log('night: written on stop');
    if (how === 'removed') console.log('night: nothing to keep on stop');
    if (how === 'failed') console.log('night: not written on stop');
    setTimeout(() => process.exit(0), 3000).unref();
    relay.close().then(() => process.exit(0));
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}
