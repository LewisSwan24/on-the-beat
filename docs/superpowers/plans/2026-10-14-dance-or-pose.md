# LET'S DANCE!, or strike a pose: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** LET'S DANCE! takes one posed photo as well as five seconds of dancing, on the floor and as a dance back, with the matching rule unchanged.

**Architecture:** A photo rides the clip pipeline. The relay's `keepClip` accepts `image/jpeg` (marker-checked, 300 KB cap) into the same one-slot-per-person store. The room learns each ref's kind through a new `clipKind(ref)` option and puts `kind` on every floor row and `me.clipKind`. The phone's camera screen gains a VIDEO | PHOTO switch with a 3-second count and a pose prompt, and the floor draws `<img>` for a photo.

**Tech Stack:** Node 24 (relay, `node:test`), React + Vite (phone). No firmware change.

**Spec:** `docs/superpowers/specs/2026-10-14-dance-or-pose-design.md`

## Global Constraints

- Artefacts are English. The repository is public: no secrets.
- The card stays `dance`, titled LET'S DANCE!; band words, firmware and `relay/cards.js` do not change.
- A photo: `image/jpeg`, bytes beginning `FF D8 FF`, at most `PHOTO_MAX = 300_000` bytes. Kinds are exactly `'photo'` and `'clip'`.
- A photo is captured from the live stream, long side at most 640 px, JPEG quality 0.8, NOT mirrored, after a 3-second count.
- Pose prompts (exact, in this order): "Air guitar, as loud as it looks." / "Phone torch up, like the encore." / "Make a heart with your hands." / "Point at the stage like it owes you money." / "Side on, eyes on the stage." / "Your best album-cover stare." / "Both arms up for the chorus." / "Sunglasses on. Indoors. At night."
- App CSP becomes `img-src 'self' data: blob:` for the phone app only; the staff page keeps `img-src 'self' data:`.
- Every commit ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; send `git commit` as its own command.
- Single test files that start a relay serving the app need `npm run build` first.
- Deploying waits for our yes.

## Review Focus

1. **A phone that sends `image/jpeg` whose bytes are HTML or script:** refused, never served under any type. Pinned in Task 2.
2. **A person who had a clip on the floor and now posts a photo (or the reverse):** the old one goes; they never have two tiles. Pinned in Task 2.
3. **A photo dance back to someone whose own floor item is a clip:** each tile shows its own kind. Pinned in Task 1.
4. **A restart with a photo on the floor:** it comes back as a photo, not as a broken video. Pinned in Task 2.
5. **A browser that cannot make a JPEG (`toBlob` gives null):** the screen stays usable, says so, and nothing is sent. Pinned in Task 3 (browser walk, by stubbing `HTMLCanvasElement.prototype.toBlob`).

---

### Task 1: The room says what each floor item is

**Files:**
- Modify: `relay/room.js` (createRoom options near `clipKept = () => false,` ~158; `plays.dance.rows` ~660; `viewFor` me line ~960)
- Create: `tests/pose-room.test.js`

**Interfaces:**
- Produces: `createRoom({ clipKind })` where `clipKind(ref) -> 'photo' | 'clip'` (default `() => 'clip'`); each `floor` row gains `kind`; `viewFor(id).me.clipKind` is `'photo' | 'clip'` when `me.clip` is set, else `null`.

- [ ] **Step 1: Write the failing test**

`tests/pose-room.test.js`:

```js
// LET'S DANCE!, or a pose: the room says what each thing on the floor is (docs/superpowers/specs/2026-10-14-dance-or-pose-design.md §2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRoom } from '../relay/room.js';

const KINDS = { p1: 'photo', c1: 'clip', p2: 'photo' };
const room = (opts = { clipKind: (ref) => KINDS[ref] ?? 'clip' }) => {
  const r = createRoom({ salt: 'p', ...opts });
  for (const p of ['ana', 'ben', 'cal']) { r.join(p); r.arm(p, 'dance'); }
  return r;
};
const rowOf = (r, viewer, who) => r.viewFor(viewer).floor.find((c) => c.band === r.viewFor(who).me.band);

test('each floor row and your own says photo or clip, as the relay told the room', () => {
  const r = room();
  r.postClip('ana', 'p1');
  r.postClip('ben', 'c1');
  assert.equal(rowOf(r, 'cal', 'ana').kind, 'photo');
  assert.equal(rowOf(r, 'cal', 'ben').kind, 'clip');
  assert.deepEqual([r.viewFor('ana').me.clip, r.viewFor('ana').me.clipKind], ['p1', 'photo']);
  assert.equal(r.viewFor('cal').me.clipKind, null, 'nothing on the floor, no kind');
});

test('a photo danced back to someone whose own is a clip: each tile says its own kind', () => {
  const r = room();
  r.postClip('ben', 'c1');
  assert.equal(r.danceBack('ana', rowOf(r, 'ana', 'ben').handle, 'p2'), null);
  const toBen = rowOf(r, 'ben', 'ana');
  assert.deepEqual([toBen.toYou, toBen.kind], [true, 'photo']);
  assert.equal(rowOf(r, 'ana', 'ben').kind, 'clip');
});

test('a room not told kinds says clip for everything, as before photos', () => {
  const r = room({});
  r.postClip('ana', 'p1');
  assert.equal(rowOf(r, 'ben', 'ana').kind, 'clip');
  assert.equal(r.viewFor('ana').me.clipKind, 'clip');
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test tests/pose-room.test.js`
Expected: FAIL: `kind` is `undefined` where `'photo'` is expected.

- [ ] **Step 3: Implement**

In `relay/room.js`, after `clipKept = () => false,` add:

```js
  // What a clip ref holds, as the relay kept it: 'photo' for a posed photo, else 'clip' (dance-or-pose spec §2).
  clipKind = () => 'clip',
```

In `plays.dance.rows`, change the returned row to:

```js
        const ref = toYou ?? p.clip.ref;
        return [{ ...row(p), ref, kind: clipKind(ref), toYou: !!toYou, dancedBack: dances.has(id + '>' + p.id) }];
```

(replacing the line `return [{ ...row(p), ref: toYou ?? p.clip.ref, toYou: !!toYou, dancedBack: dances.has(id + '>' + p.id) }];`), and update the comment above `dance:` from "your own five seconds" to "your own five seconds or a pose".

In `viewFor`'s `me`, change `clip: me.clip?.ref ?? null,` to:

```js
clip: me.clip?.ref ?? null, clipKind: me.clip ? clipKind(me.clip.ref) : null,
```

- [ ] **Step 4: Run the tests**

Run: `node --test tests/pose-room.test.js tests/room.test.js tests/cards.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add relay/room.js tests/pose-room.test.js docs/superpowers/plans/2026-10-14-dance-or-pose.md docs/superpowers/specs/2026-10-14-dance-or-pose-design.md
git commit -m "LET'S DANCE!: the room says whether each thing on the floor is a photo or a clip" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The relay keeps a posed photo

**Files:**
- Modify: `relay/server.js` (constants near `CLIP_MAX` ~38; `keepClip` ~836-862; the two `createRoom` calls ~385 and ~1659; `APP_POLICY` ~102)
- Modify: `tests/staff.test.js` (the app CSP directive list ~714)
- Modify: `tests/restart.test.js` (append one test)
- Create: `tests/pose-relay.test.js`

**Interfaces:**
- Consumes: `createRoom({ clipKind })` from Task 1.
- Produces: phones may send `{ t: 'clip', mime: 'image/jpeg', data, to? }`; the relay stores it with `mime: 'image/jpeg'` and serves it at `/clip/<venue>/<ref>` as `content-type: image/jpeg`.

- [ ] **Step 1: Write the failing tests**

`tests/pose-relay.test.js`:

```js
// A posed photo over real sockets: kept, served as itself, listed as a photo, and nothing else under its name.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createRelay } from '../relay/server.js';
import { helpers, pause } from './relay-harness.js';

const JPEG = (n = 2000) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(n)]);
const VENUE = 'pose-room';

async function withRelay(fn) {
  const relay = await createRelay({ port: 0, host: '127.0.0.1' });
  const h = helpers(() => relay.port);
  const get = (ref) => fetch('http://127.0.0.1:' + relay.port + '/clip/' + VENUE + '/' + ref);
  try { await fn(h, get); } finally { h.cleanup(); await relay.close(); }
}

test('a photo is kept, served byte for byte as a JPEG, and listed on the floor as a photo', async () => {
  await withRelay(async ({ phone }, get) => {
    const ana = await phone(VENUE);
    const ben = await phone(VENUE);
    const photo = JPEG();
    ana.send({ t: 'clip', mime: 'image/jpeg', data: photo.toString('base64') });
    const [row] = (await ben.until((v) => v.floor.length === 1)).floor;
    assert.equal(row.kind, 'photo');
    assert.equal((await ana.until((v) => v.me.clipKind === 'photo')).me.clip, row.ref);
    const res = await get(row.ref);
    assert.equal(res.headers.get('content-type'), 'image/jpeg');
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), photo);
  });
});

test('image/jpeg that is not a JPEG, or is too big, is refused and never kept', async () => {
  await withRelay(async ({ phone }) => {
    const ana = await phone(VENUE);
    ana.send({ t: 'clip', mime: 'image/jpeg', data: Buffer.from('<script>alert(1)</script>').toString('base64') });
    ana.send({ t: 'clip', mime: 'image/jpeg', data: JPEG(300_000).toString('base64') });
    await ana.until((v, p) => p.errors.filter((e) => e === 'clip refused').length === 2);
    await pause(200);
    assert.equal(ana.view.me.clip, null);
  });
});

test('a photo replaces the same person\'s clip on the floor, and a clip replaces a photo', async () => {
  await withRelay(async ({ phone }) => {
    const ana = await phone(VENUE);
    const ben = await phone(VENUE);
    ana.send({ t: 'clip', mime: 'video/webm', data: randomBytes(1500).toString('base64') });
    await ben.until((v) => v.floor.length === 1 && v.floor[0].kind === 'clip');
    ana.send({ t: 'clip', mime: 'image/jpeg', data: JPEG().toString('base64') });
    await ben.until((v) => v.floor.length === 1 && v.floor[0].kind === 'photo');
    ana.send({ t: 'clip', mime: 'video/mp4', data: randomBytes(1500).toString('base64') });
    await ben.until((v) => v.floor.length === 1 && v.floor[0].kind === 'clip');
  });
});

test('a dance back may be a photo, and the one it goes to sees a photo', async () => {
  await withRelay(async ({ phone }) => {
    const ana = await phone(VENUE);
    const ben = await phone(VENUE);
    ana.send({ t: 'clip', mime: 'video/webm', data: randomBytes(1500).toString('base64') });
    const [onFloor] = (await ben.until((v) => v.floor.length === 1)).floor;
    ben.send({ t: 'clip', mime: 'image/jpeg', data: JPEG().toString('base64'), to: onFloor.handle });
    const back = (await ana.until((v) => v.floor.some((c) => c.toYou))).floor.find((c) => c.toYou);
    assert.equal(back.kind, 'photo');
  });
});
```

Append to `tests/restart.test.js`, after the test "a clip on the floor and a dance back come back after a restart, byte for byte":

```js
test('a photo on the floor comes back after a restart as a photo, byte for byte', async () => {
  const n = night();
  await n.start();
  const photo = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(2000)]);
  const ana = await n.on.phone('restart-photo');
  ana.send({ t: 'clip', mime: 'image/jpeg', data: photo.toString('base64') });
  await ana.until((v) => v.me.clipKind === 'photo');
  await n.restart();
  const ben = await n.on.phone('restart-photo');
  const [onFloor] = (await ben.until((v) => v.floor.length === 1)).floor;
  assert.equal(onFloor.kind, 'photo');
  assert.deepEqual(await video(n, 'restart-photo', onFloor.ref), photo);
});
```

In `tests/staff.test.js`, in the app directive list (the one with `"media-src 'self' blob:"`), change `"img-src 'self' data:"` to `"img-src 'self' data: blob:"`.

- [ ] **Step 2: Run them to see them fail**

Run: `npm run build && node --test tests/pose-relay.test.js tests/restart.test.js tests/staff.test.js`
Expected: FAIL: the photo is refused (`clip refused` / floor stays empty), the restart photo test times out, and the CSP test lacks `img-src 'self' data: blob:`.

- [ ] **Step 3: Keep, kind and serve photos**

In `relay/server.js`, after `const CLIP_MAX = 1_200_000;` add:

```js
const PHOTO_MAX = 300_000;            // bytes of one posed photo (dance-or-pose spec §2)
const JPEG_MARK = Buffer.from([0xff, 0xd8, 0xff]);
```

In `keepClip`, replace the type check and the size check:

```js
    const type = /^video\/(webm|mp4)(?:;|$)/.exec(String(mime));
    if (!buf.length || buf.length > CLIP_MAX || !type) return null;
```

with:

```js
    // A posed photo is kept only if it is a JPEG: it is served under that type, with nosniff.
    const photo = /^image\/jpeg(?:;|$)/.test(String(mime));
    const type = photo ? null : /^video\/(webm|mp4)(?:;|$)/.exec(String(mime));
    if (!buf.length || !(photo || type)) return null;
    if (photo ? buf.length > PHOTO_MAX || !buf.subarray(0, 3).equals(JPEG_MARK) : buf.length > CLIP_MAX) return null;
```

and change the store line `r.clips.set(ref, { mime: 'video/' + type[1], buf, by: id, slot, at: now() });` to:

```js
    r.clips.set(ref, { mime: photo ? 'image/jpeg' : 'video/' + type[1], buf, by: id, slot, at: now() });
```

Above `function roomFor(key)`, add:

```js
  /** What a kept ref holds, for the room's views: 'photo' or 'clip'. */
  const clipKindOf = (key, ref) => (rooms.get(key)?.clips.get(ref)?.mime === 'image/jpeg' ? 'photo' : 'clip');
```

In `roomFor`, add `clipKind: (ref) => clipKindOf(key, ref),` to the `createRoom({ ... })` options. In the restore `createRoom({ ... })`, add `clipKind: (ref) => clipKindOf(String(e.key), ref),`.

In `APP_POLICY`, change `"img-src 'self' data:"` to `"img-src 'self' data: blob:"`, and add to the comment above it: "and `img-src blob:` for a posed photo's preview before it is sent".

Then confirm the restored clip record keeps its mime: `grep -n "mime: c.mime" relay/server.js` shows the restore line (~1624) passing `mime: c.mime`; no change needed.

- [ ] **Step 4: Run the tests**

Run: `npm run build && node --test tests/pose-relay.test.js tests/restart.test.js tests/staff.test.js tests/server.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add relay/server.js tests/pose-relay.test.js tests/restart.test.js tests/staff.test.js
git commit -m "LET'S DANCE!: the relay keeps a posed photo beside clips, and only a real JPEG" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The phone takes and shows a pose

**Files:**
- Create: `app/lib/pose.js`, `tests/pose.test.js`
- Modify: `app/screens/Dance.jsx` (`Camera`, `Floor`)
- Modify: `app/App.jsx` (`sendClip`, `keepClip`, `tileSheet`, the `floor` case)
- Modify: `app/copy.js` (`WORDS.dance` armed lines, `HOW.cards`)
- Modify: `app/styles.css` (`.cam video` rule, the mode switch)
- Modify: `tests/cards.test.js` (the dance armed line ~42)

**Interfaces:**
- Consumes: `view.floor[].kind`, `view.me.clipKind` (Task 1); `image/jpeg` clips (Task 2).
- Produces: `POSES: string[]`, `nextPose(previous: number, random = Math.random) -> number`, `PHOTO_SIDE = 640`, `PHOTO_QUALITY = 0.8`, `PHOTO_MAX = 300_000` from `app/lib/pose.js`.

- [ ] **Step 1: Write the failing test**

`tests/pose.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { POSES, PHOTO_MAX, PHOTO_QUALITY, PHOTO_SIDE, nextPose } from '../app/lib/pose.js';

test('eight solo poses, none of them needing two people', () => {
  assert.equal(POSES.length, 8);
  assert.equal(POSES[0], 'Air guitar, as loud as it looks.');
  for (const p of POSES) assert.doesNotMatch(p, /together|each|both of you/i, p);
  assert.deepEqual([PHOTO_SIDE, PHOTO_QUALITY, PHOTO_MAX], [640, 0.8, 300_000]);
});

test('another pose is never the one just shown, and every pose can come up', () => {
  const seen = new Set();
  for (let prev = -1, i = 0; i < 400; i += 1) {
    const next = nextPose(prev);
    assert.ok(next >= 0 && next < POSES.length);
    assert.notEqual(next, prev);
    seen.add(next);
    prev = next;
  }
  assert.equal(seen.size, POSES.length);
  assert.equal(nextPose(3, () => 3 / POSES.length), 4, 'the draw that would repeat steps on');
  assert.equal(nextPose(-1, () => 0), 0, 'the first draw may be any');
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test tests/pose.test.js`
Expected: FAIL, `Cannot find module '../app/lib/pose.js'`.

- [ ] **Step 3: Write `app/lib/pose.js`**

```js
// LET'S DANCE!, or strike a pose (docs/superpowers/specs/2026-10-14-dance-or-pose-design.md §1).

/** Solo poses that do not need the whole face. */
export const POSES = [
  'Air guitar, as loud as it looks.',
  'Phone torch up, like the encore.',
  'Make a heart with your hands.',
  'Point at the stage like it owes you money.',
  'Side on, eyes on the stage.',
  'Your best album-cover stare.',
  'Both arms up for the chorus.',
  'Sunglasses on. Indoors. At night.',
];

export const PHOTO_SIDE = 640;       // the long side of a photo, at most
export const PHOTO_QUALITY = 0.8;    // JPEG quality
export const PHOTO_MAX = 300_000;    // bytes; the relay refuses more

/** Another pose, never the one shown now (`previous`, or -1 for none yet). */
export function nextPose(previous, random = Math.random) {
  const n = Math.min(POSES.length - 1, Math.floor(random() * POSES.length));
  return n === previous ? (n + 1) % POSES.length : n;
}
```

Run: `node --test tests/pose.test.js`
Expected: PASS.

- [ ] **Step 4: The camera screen**

In `app/screens/Dance.jsx`, add to the imports:

```js
import { PHOTO_QUALITY, PHOTO_SIDE, POSES, nextPose } from '../lib/pose.js';
```

Inside `Camera`, after `const [sending, setSending] = useState(false);`, add:

```js
  const [mode, setMode] = useState('video');           // video | photo
  const [pose, setPose] = useState(() => nextPose(-1));
  const [count, setCount] = useState(0);                // 3, 2, 1 before a photo; 0 when not counting
  const [failed, setFailed] = useState(false);          // this browser could not make a JPEG
  const counter = useRef(null);
  useEffect(() => () => clearInterval(counter.current), []);

  // One frame of the live stream, not mirrored, long side at most PHOTO_SIDE, as a JPEG.
  const snap = () => {
    const v = live.current;
    if (!v || !v.videoWidth) return;
    const k = Math.min(1, PHOTO_SIDE / Math.max(v.videoWidth, v.videoHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(v.videoWidth * k);
    c.height = Math.round(v.videoHeight * k);
    c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
    c.toBlob((blob) => {
      if (!blob) { setFailed(true); return; }
      setClip({ blob, url: URL.createObjectURL(blob), type: 'image/jpeg', photo: true });
    }, 'image/jpeg', PHOTO_QUALITY);
  };
  const shoot = () => {
    if (count || cam !== 'ready') return;
    setFailed(false);
    setCount(3);
    let n = 3;
    clearInterval(counter.current);
    counter.current = setInterval(() => {
      n -= 1;
      setCount(n);
      if (n === 0) { clearInterval(counter.current); snap(); }
    }, 1000);
  };
```

Change `const again = () => { setClip(null); setMs(0); };` to:

```js
  const again = () => { setClip(null); setMs(0); setCount(0); };
```

Replace the preview line:

```jsx
      {clip ? <video key={clip.url} src={clip.url} muted playsInline autoPlay loop aria-label="Your five seconds, looping" /> : null}
```

with:

```jsx
      {clip?.photo ? <img key={clip.url} src={clip.url} alt="Your pose" /> : null}
      {clip && !clip.photo ? <video key={clip.url} src={clip.url} muted playsInline autoPlay loop aria-label="Your five seconds, looping" /> : null}
```

In the `!clip ?` branch of `.bottom`, wrap the existing recording controls so the screen reads, in order: the switch, then either the video controls (unchanged) or the photo controls. Replace from `<div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>` through its closing `</div>` (the one just before `) : (`) with:

```jsx
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
            <div className="seg" role="group" aria-label="Video or photo">
              <button type="button" aria-pressed={mode === 'video'} disabled={recording || count > 0} onClick={() => setMode('video')}>VIDEO</button>
              <button type="button" aria-pressed={mode === 'photo'} disabled={recording || count > 0} onClick={() => setMode('photo')}>PHOTO</button>
            </div>
            {cam === 'none' ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, textAlign: 'center' }}>
                <span className="h2">The camera's off.</span>
                <span className="small">allow the camera for this page to dance or pose. nothing is sent until you send it.</span>
                <button type="button" className="btn-s" style={{ '--c': 'var(--dance)', '--f': 'var(--dance)' }} onClick={start}>TRY AGAIN</button>
              </div>
            ) : mode === 'photo' ? (
              <>
                <button type="button" className="pose" onClick={() => setPose((p) => nextPose(p))} disabled={count > 0}
                  aria-label={'Pose: ' + POSES[pose] + ' Tap for another.'}>
                  <span className="h2">{POSES[pose]}</span>
                  <span className="small">tap for another</span>
                </button>
                {failed ? <span className="small" role="status">this phone could not take the photo. try the video.</span> : null}
                <span className="small">{count ? 'hold it…' : backTo ? 'one pose, straight back to them.' : 'one pose. three seconds to get ready.'}</span>
              </>
            ) : (
              <span className="small">{recording ? 'hold the phone still' : backTo ? 'five seconds, straight back to them.' : 'five seconds. no sound needed.'}</span>
            )}
            {mode === 'photo' ? (
              <button type="button" className="rec" onClick={shoot} disabled={cam !== 'ready' || count > 0} aria-label="Take a photo in three seconds">
                <span className="ring" style={{ background: 'rgba(255,255,255,.22)' }} />
                <span className="hole" />
                <span className="core" style={{ width: 62, height: 62, borderRadius: 31 }} />
              </button>
            ) : (
              <button type="button" className="rec" onClick={record} disabled={cam !== 'ready' || recording} aria-label="Record five seconds">
                <span className="ring" style={{ background: `conic-gradient(var(--dance) ${deg}deg, rgba(255,255,255,.22) 0deg)` }} />
                <span className="hole" />
                <span className="core" style={{ width: core, height: core, borderRadius: recording ? 8 : 31 }} />
              </button>
            )}
            <span className="tnum" aria-live="polite" style={{ font: 'var(--num)', color: 'var(--text-2)', minHeight: 18 }}>
              {mode === 'photo' ? (count ? count + '' : '') : recording ? Math.ceil((CLIP_MS - ms) / 1000) + 's' : ''}
            </span>
          </div>
```

In the preview branch, change the label line `5 seconds · looping` to:

```jsx
              {clip.photo ? 'your pose' : '5 seconds · looping'}
```

and the "Record again" button text to `{clip.photo ? 'Take another' : 'Record again'}`.

- [ ] **Step 5: The floor**

In `Floor`, change the signature to `export function Floor({ floor, mine, mineKind, room, onBack, onTile })`. Add at module level, just above `Floor` (never inside it: a component defined in a render is a new type each render, and every tile would restart on each push):

```jsx
/** A floor item: a photo is drawn as one; anything else is the looping five seconds. */
function Media({ kind, ...rest }) {
  return kind === 'photo'
    ? <img {...rest} alt={rest['aria-label'] ?? ''} />
    : <video {...rest} muted loop autoPlay playsInline />;
}
```

Replace the own tile's `<video src={src(mine)} muted loop autoPlay playsInline aria-label="Your five seconds, on the floor" onError={...} />` with:

```jsx
            <Media kind={mineKind} src={src(mine)} aria-label={mineKind === 'photo' ? 'Your pose, on the floor' : 'Your five seconds, on the floor'}
              onError={() => setGone((g) => ({ ...g, [mine]: true }))} />
```

and each tile's `<video src={src(c.ref)} muted loop autoPlay playsInline aria-hidden="true" onError={...} />` with:

```jsx
            <Media kind={c.kind} src={src(c.ref)} aria-hidden="true"
              onError={() => setGone((g) => ({ ...g, [c.ref]: true }))} />
```

Change the floor's subtitle to `five seconds each, or a pose. no sound needed.`, the empty line to `Five seconds of you, or one pose, gets it going.`, and the doc comment to `/** S10 — the floor: five seconds or a pose each, and one sent to you comes first. */`.

- [ ] **Step 6: App, copy and styles**

In `app/App.jsx`:

- The `floor` case passes `mineKind={view.me?.clipKind}` to `Floor`.
- In `sendClip`, replace the size check line with:

```js
    const photo = type === 'image/jpeg';
    if (blob.size > (photo ? PHOTO_MAX : 1_150_000)) { say(photo ? 'that photo is too big to send. try another.' : 'that one is too big to send. try again, a little stiller.'); return; }
```

  and the floor branch's event and toast with:

```js
      if (!store.hasEvent(s, 'clip')) update((prev) => store.addEvent(prev, 'clip', photo ? 'sent a pose to the floor' : 'sent five seconds to the floor'));
      say('sent. it stays on the floor for an hour.');
```

  (`photo` is in scope from the size check), and import `PHOTO_MAX` from `./lib/pose.js`.
- In `keepClip`, change the extension to `(type === 'image/jpeg' ? '.jpg' : type.includes('mp4') ? '.mp4' : '.webm')`.
- In `tileSheet`, change the DANCE BACK `sub` to `'five seconds or a pose, straight back to them.'`.

In `app/copy.js`:

- `WORDS.dance` armed: `['Dance or strike a pose', 'to your fav ' + actShort(act) + '’s piece!']`.
- `HOW.cards`: `LET’S DANCE! puts a clip on the floor.` becomes `LET’S DANCE! puts a clip or a pose on the floor.`

In `tests/cards.test.js` line ~42, the expected armed line becomes `'to your fav Bruno’s piece!'`.

In `app/styles.css`:

- Change `.cam video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }` to `.cam video, .cam > img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }`.
- Append:

```css
/* LET'S DANCE!: video or photo, and the pose to strike. */
.cam .seg { display: inline-flex; border: 1px solid var(--line); border-radius: 999px; padding: 3px; background: rgba(8,8,10,.72); }
.cam .seg button { min-height: 36px; padding: 0 16px; border-radius: 999px; font: var(--label); letter-spacing: .08em; color: var(--text-2); background: none; border: none; }
.cam .seg button[aria-pressed="true"] { background: var(--dance); color: #000; }
.cam .pose { display: flex; flex-direction: column; align-items: center; gap: 2px; text-align: center; background: none; border: none; color: #fff; padding: 4px 12px; max-width: 320px; }
.floor .tile img { width: 100%; height: 100%; object-fit: cover; display: block; }
```

Before appending, confirm the names: `grep -nE "^\s*--label:|^\.floor \.tile video" app/styles.css`. If `--label` does not exist, use the font the existing `.label` class uses (`grep -n "^\.label" app/styles.css`). If the floor's video rule is `.floor video` or `.tile video`, write the `img` rule with the same selector shape.

- [ ] **Step 7: Build, run the suite, and walk it in a browser**

Run: `npm test`
Expected: PASS (6 skipped as before).

Then start a relay on a spare port with Bash `run_in_background` (`PORT=8791 node relay/server.js`), and in the built-in browser at 375×812 with two tabs on two origins (`http://localhost:8791/` and `http://127.0.0.1:8791/`), each seeded per CLAUDE.md "Verifying the phone in a browser" with different `me` values and the same typed venue:

- A arms LET'S DANCE!, opens the camera, switches to PHOTO, taps the prompt (it changes), shoots: the count shows 3, 2, 1, then the preview is an `<img>`; SEND TO THE FLOOR.
- B's floor shows a tile with an `<img>`; B taps it, DANCE BACK, sends a 5-second VIDEO.
- A's floor shows the dance back as a `<video>` marked "danced back to you"; A dances back with a PHOTO; both show the match.
- With `HTMLCanvasElement.prototype.toBlob = function (cb) { cb(null); }` on A, a shot says "this phone could not take the photo. try the video." and nothing is sent.
- `document.documentElement.scrollWidth` is 375 on the camera and floor screens.

The headless browser may have no camera: if `getUserMedia` fails (`The camera's off.`), stub it before opening the camera with a canvas stream: `navigator.mediaDevices.getUserMedia = async () => { const c = Object.assign(document.createElement('canvas'), { width: 480, height: 640 }); const g = c.getContext('2d'); setInterval(() => { g.fillStyle = '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0'); g.fillRect(0, 0, 480, 640); }, 100); return c.captureStream(10); }`.

Stop the relay by its port, reset the viewport.

- [ ] **Step 8: Commit**

```bash
git add app/lib/pose.js tests/pose.test.js app/screens/Dance.jsx app/App.jsx app/copy.js app/styles.css tests/cards.test.js
git commit -m "LET'S DANCE!: a PHOTO switch with a pose to strike, and photos on the floor" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Docs, the guards proved, and pushed

**Files:**
- Modify: `README.md`, `docs/how-it-works.md`, `docs/canvas.md`

- [ ] **Step 1: The docs**

- `README.md`: `**LET'S DANCE!** (five seconds of you dancing, on a\nshared floor)` becomes `**LET'S DANCE!** (five seconds of you dancing, or one pose, on a\nshared floor)`.
- `docs/how-it-works.md`: the row `| a dance back (LET'S DANCE!) | yes — the clip goes straight to them, with no name on it |` becomes `| a dance back (LET'S DANCE!) | yes — the clip or photo goes straight to them, with no name on it |`; and where it describes the clip store (`grep -n "clip" docs/how-it-works.md`), add one sentence: "A posed photo is kept the same way: a JPEG of at most 300 KB, in the same one place per person."
- `docs/canvas.md`: a bullet "**LET'S DANCE! takes a pose.** The canvas records five seconds. The owner chose on 14 Oct 2026, from the team's v3 selfie, to let the same card post one posed photo instead, with a prompt to strike; it shares the clip's place on the floor and in the store."

- [ ] **Step 2: Prove the guards**

For each, make the change, run the named test, see exactly that test go red, restore with `git checkout -- relay/<file>`:

| Mutation | File | Expected red |
|---|---|---|
| in `keepClip`, delete `\|\| !buf.subarray(0, 3).equals(JPEG_MARK)` | `relay/server.js` | `tests/pose-relay.test.js` "image/jpeg that is not a JPEG, or is too big…" |
| in `plays.dance.rows`, delete `kind: clipKind(ref), ` | `relay/room.js` | `tests/pose-room.test.js` (all three) |
| in `roomFor`, delete the `clipKind:` option | `relay/server.js` | `tests/pose-relay.test.js` "a photo is kept, served byte for byte…" |

Run after restoring: `git status --short relay/` shows nothing; `npm test` passes.

- [ ] **Step 3: Commit and push**

```bash
git add README.md docs
git commit -m "LET'S DANCE!: the docs say it takes a pose" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

```bash
git push -u origin dance-or-pose
```

Expected: the branch is on `origin`. Not merged, not deployed.
