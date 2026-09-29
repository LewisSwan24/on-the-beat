# Staff: a new report reaches a closed or sleeping staff device

Date: 29 Sep 2026. Item 3 of the owner's queue of 28 Sep (「2134」), decided
with him question by question the same day. His choices:

- a system notification, by Web Push (「系统通知（推荐）」);
- only the venue and how many are open on the lock screen
  (「只说有新举报（推荐）」);
- a tap on it opens straight to the list (「直接看到列表（推荐）」);
- Web Push written on `node:crypto`, with no new dependency
  (「A · Node 自带加密库自己写（推荐）」).

He approved the design in three sections, as presented.

## What is true today

Checked on 29 Sep 2026, in the code:

- **The staff page is live only.** A new report reaches a staff screen over
  its socket (`reportsTo()` in `relay/server.js`): it flashes, counts in the
  title and chimes once a tap has allowed sound. Nothing reaches a device
  whose page is closed or asleep. README tells the team to keep it open on a
  screen that stays awake.
- **The sign-in lives in one tab.** `app/staff/Staff.jsx` keeps `{ venue,
  token }` in `sessionStorage` under `otb:staff`, so a closed tab has to type
  the passcode again. SIGN OUT forgets the token in the tab and reloads; the
  relay keeps it until 06:00.
- **Tokens.** The relay holds `tokens`, a Map from `tokenHashOf(token)` to
  `{ key, night }`, at most 1,000 of them. The 06:00 sweep drops the night's
  tokens and sends `expired` to every staff socket signed in for it. The
  night file carries `tokens` across a restart
  (`docs/superpowers/specs/2026-09-29-restart-persistence-design.md`).
- **No service worker or manifest of its own.** `app/staff.html` links no
  manifest. The app registers `/sw.js` (scope `/`) in production only, and
  that worker leaves `/staff`, `/staff/` and `/staff.html` to the network.
- **The relay makes no outbound request of any kind.** It depends on `ws`
  alone, and serves `.js` and `.webmanifest` files from `dist/` with their
  types.

## Goal

A report made at a venue reaches every staff device there that turned
notifications on, even if its page is closed or the phone is asleep. The
lock screen says only that there is a new report, at which venue, and how
many are open. A tap on it opens the list, still signed in. Nothing more
personal leaves the relay than it does today, and the relay sends only to
real push services.

## Not in this spec

- **Reminding again** while a report stays open.
- **Taking a notification back** from other devices when one marks the
  report handled.
- **A badge** on the Home Screen icon.
- **Turning notifications off while staying signed in.** SIGN OUT turns them
  off, and so does the browser's own setting.
- **Holding back the push while the page is on screen.** A device that is
  looking at the page gets both the chime and the notification (§1).
- **Ending sign-ins when a venue's passcode changes.** Since the night
  carries across a restart, a new passcode no longer signs out the old one's
  tokens before 06:00, and a device's notifications ride its sign-in. Item 4,
  the staff security review, takes this.

## §1. The staff device (`app/staff.html`, `app/staff/`, `app/public/`)

- **Its own manifest.** `app/public/staff.webmanifest`: name *On The Beat
  staff*, `id` `/staff`, `start_url` `/staff`, `scope` `/staff`, `display`
  `standalone`, the app's colours and icons. `app/staff.html` links it, with
  an `apple-touch-icon`. This is what lets an iPhone add the page to its Home
  Screen, which iOS requires before it allows Web Push (16.4 or later).
- **Its own service worker.** `app/public/staff-sw.js`, registered by the
  page whenever it loads in a secure context, with scope `/staff`. It
  handles `push` and `notificationclick` and nothing else. It has no `fetch`
  handler, so the page stays live or nothing. `/sw.js` is unchanged.
- **The notification.** The title is *New report · <venue>*. The body is
  *<n> open — tap to see them*, or *1 open — tap to see it*. The tag is
  `otb-reports` and `renotify` is on, so a newer one replaces the older and
  still alerts. A push with no readable data still shows *New report*: Safari
  revokes the permission of a site whose push shows nothing.
- **A tap on it** focuses an open window under `/staff` if there is one, and
  otherwise opens `/staff`.
- **The line under the header**, once signed in, depends on the device:
  - *NOTIFY THIS DEVICE*, a button, where the device can have notifications
    and has none yet. The tap calls `pushManager.subscribe()` before anything
    else is awaited, because iOS takes a permission request only from a tap.
    The page then sends the subscription to the relay.
  - *Turning on…* while the relay has not answered.
  - *Notifications on for this device.*
  - On an iPhone in Safari, where `navigator.standalone` is `false`: *To get
    notifications on iPhone: Share, then Add to Home Screen, and open Staff
    from there.*
  - Where permission was refused: *Notifications are blocked for this page.
    Allow them in the browser's settings to get them here.*
  - Where there is no Web Push at all: *This browser can't show
    notifications. Keep this page open to hear new reports.*
  - Where the relay refuses the subscription, or `subscribe()` fails: *This
    browser's notifications can't be used here.*
- **Every sign-in carries notifications on by itself.** The relay's `ok`
  answer carries its public key (§2). If permission is granted and the
  browser already holds a subscription made with that key, the page sends
  it without a tap. It does this every night and after every reconnect. A
  subscription made with another key is unsubscribed and made again, and
  the button shows if the browser wants a tap for that.
- **The sign-in is kept on the device once notifications are on.** After
  the relay accepts the subscription, `{ venue, token }` moves from
  `sessionStorage` to `localStorage`. It stays there until 06:00, when the
  relay answers `expired`, or until SIGN OUT. The page reads
  `localStorage` first, then `sessionStorage`. Any refusal of a sign-in
  clears both. A device without notifications keeps its sign-in in the tab,
  as today.
- **SIGN OUT** sends `{t:'signout'}`, unsubscribes the browser's
  subscription, clears both stores and reloads.
- **On screen, the notifications go.** When the page becomes visible, and
  whenever a new list arrives while it is visible, it closes the
  notifications tagged `otb-reports`.
- **Words** live beside `REFUSED` in `app/staff/list.js` and are chosen by a
  pure function in `app/staff/notify.js`, so they are tested without a
  browser. `REFUSED` gains `signed out`: *Signed out. Enter the passcode
  again.*

## §2. Keys (`relay/push.js`, `PUSH_KEYS_FILE`)

- **One P-256 key pair (VAPID) for the relay.** It is made the first time the
  relay starts and kept in `PUSH_KEYS_FILE` as `{ "v": 1, "jwk": { kty, crv,
  x, y, d } }`, mode 0600, written the way the night file is
  (`relay/store.js`). `fly.toml` sets `PUSH_KEYS_FILE =
  "/data/push-keys.json"` on the volume. With no `PUSH_KEYS_FILE`, as under
  `npm start`, the keys live in memory for the life of the process.
- **Logs** say `push: keys from <path>`, `push: keys made at <path>`, or
  `push: keys in memory only`. A file that cannot be read, or has another
  shape, is replaced by new keys and logged as `push: keys unreadable (<error
  name>), made new ones`. Subscriptions made under the old keys then fail
  with 403 and are forgotten (§4), and each page subscribes again after its
  next sign-in (§1). The relay never refuses to start over this file.
- **No new secret to set.** The public key reaches the page in the sign-in
  answer: `{t:'staff', ok:true, venue, token, push}`, where `push` is the
  65-byte uncompressed key in base64url.

## §3. Taking a subscription (`relay/server.js`)

- **`{t:'push', sub:{endpoint, keys:{p256dh, auth}}}`** is taken only from a
  signed-in staff socket. The subscription joins that socket's token record:
  `{ key, night, push:{ endpoint, p256dh, auth, at } }`. The socket now
  remembers its token's hash, which it did not before. The answer is
  `{t:'push', ok:true}`, or `{t:'push', ok:false, why:'bad push'}` for
  anything that fails a check below. The socket of a phone or a wristband is
  ignored, as it is for `handled`.
- **The endpoint** must parse as a URL with all of these:
  - the scheme `https:`;
  - no port given;
  - no user name or password;
  - at most 2,000 characters;
  - a host that is exactly `fcm.googleapis.com` or `android.googleapis.com`,
    or ends in `.push.apple.com`, `.push.services.mozilla.com` or
    `.notify.windows.com`, compared a whole label at a time.

  Anything else is `bad push`, so the relay only ever calls the push
  services of Google, Apple, Mozilla and Microsoft.
- **The keys**: `p256dh` must be base64url for a valid 65-byte P-256 point,
  and `auth` base64url for 16 bytes.
- **One device, one subscription.** A token holds at most one, and a new one
  replaces it. An endpoint is held once: taking it removes it from any other
  token that had it. A venue holds at most 50; past that, the oldest by `at`
  is forgotten.
- **`{t:'signout'}`** from a signed-in staff socket deletes its token, and
  the subscription with it. Every socket signed in with that token is then
  sent `{t:'staff', ok:false, why:'signed out'}` and closed, as at 06:00.
- **It lasts the night.** Subscriptions ride their token records into the
  night file and back (`NIGHT_V` stays 1: a file without them has none). A
  restored record whose subscription fails the checks above keeps its
  sign-in and loses the subscription. The 06:00 sweep drops them with their
  tokens.

## §4. Sending (`relay/push.js`, `relay/server.js`)

- **When.** A report the room takes (`room.report()` true) calls
  `alertStaff(r)`. Marking a report handled sends nothing.
- **At most one push a venue each 10 seconds.** The first report in a quiet
  venue sends at once. Reports inside the next 10 s are covered by one more
  push when the window ends. That push carries the count at that moment and
  opens a window of its own. It is skipped if nothing is open by then. The
  window is held in memory only.
- **What.** Every subscription held for that venue's tonight gets
  `{"venue":"<the show's venue>","open":<n>}`. `venue` is the name from
  `relay/shows.json`, or the venue id when the show is not there; `open` is
  how many of tonight's reports there are not handled. It is encrypted per
  RFC 8291 (`aes128gcm`, one record, a fresh key pair and salt each time),
  so the push service sees neither.
- **The request.** A `POST` to the endpoint with these headers:
  - `TTL: 600`
  - `Urgency: high`
  - `Topic: reports`
  - `Content-Encoding: aes128gcm`
  - `Authorization: vapid t=<JWT>, k=<public key>`

  The JWT is ES256 with `aud` the endpoint's origin, `exp` 12 hours on, and
  `sub` `https://on-the-beat.fly.dev`. One JWT is kept for each push service
  and made again only once it is 11 hours old: Apple allows at most a day,
  and no new one within the hour. The endpoint is checked again against §3
  right before every request. Redirects are not followed, and a request
  gives up after 10 seconds.
- **The answer.**
  - 201: sent.
  - 404, 410 or 403: that subscription is forgotten. 404 and 410 mean the
    device unsubscribed or it expired; 403 means it was made under another
    key.
  - Anything else, a timeout or a network error: nothing changes, and the
    next report tries again.

  No answer body is read or passed on.
- **Off the socket's path.** All of a venue's requests go at once, once the
  report is in the room. A slow push service delays nothing else.
- **The log** says `push: <venue id> <n> sent, <n> gone, <n> failed`, and
  never an endpoint or a key.
- **For tests only**, `createRelay()` takes `pushAllowed`, a check that
  replaces the host list of §3 at intake and at send, and `pushEveryMs`, the
  window. Neither can be set from the environment.

## §5. Privacy and abuse

- **What the push services see**: that a message of about a hundred bytes
  went to a device, and when. They do not see the venue or the count.
- **The lock screen** shows the venue and the open count, never a person, a
  tag, a place in the room or the reporter's words.
- **What the relay keeps** for each subscription is its endpoint and two
  public keys. They are in memory and in the night file, and gone at 06:00
  or at SIGN OUT. The VAPID private key is on the volume beside them, so the
  volume stays what must be protected; item 4 reviews it.
- **Server-side request forgery.** The relay calls only the five push
  service host families, only over https on 443, and never follows a
  redirect. The check runs when a subscription is taken and again before
  every send.
- **Floods.** A venue sends at most one push each 10 s, and holds at most
  50 subscriptions. Reports themselves keep their existing limits.
- **A leaked passcode** lets its holder subscribe a device of their own. It
  learns when reports come and how many are open, which is less than the
  staff page they could already open until 06:00.

## §6. Errors and edge cases

- **No Web Push, permission refused, or an iPhone not yet on the Home
  Screen**: the page says so (§1) and still chimes while it is open.
- **`subscribe()` throws**, as it does on a phone without Google's services:
  *This browser's notifications can't be used here.*
- **The socket drops while a subscription is on its way**: the next sign-in
  sends it again (§1).
- **A restart or a deploy**: subscriptions come back with the night, and
  the keys file is unchanged. A report made in the last 10 s before a
  restart may miss its window's second push.
- **SIGN OUT while offline**: `{t:'signout'}` never arrives, but the browser
  has unsubscribed. The next push is answered 404 or 410, and the relay
  forgets the subscription. The token stays, unused, until 06:00.
- **06:00**: sign-ins and subscriptions go together, and the page asks for
  the passcode. The next night, the first sign-in turns notifications on
  again by itself.
- **A push service that is slow or down**: each request gives up at 10 s;
  the page and the list are unaffected.

## §7. Tests and proof

- **`tests/push.test.js`**, for `relay/push.js`:
  - RFC 8291's worked example, with its keys and salt, gives its exact bytes.
  - A payload encrypted to a test subscriber decrypts to itself.
  - The JWT verifies under the public key. `aud`, `exp` and `sub` are as §4
    says. The same JWT comes back within 11 hours and a new one after.
  - The host check takes each of the five families. It refuses `http:`, a
    port, a user name, an IP address, `localhost`,
    `fcm.googleapis.com.evil.example`, `evilnotify.windows.com` and a
    2,001-character endpoint.
  - The key checks refuse a 64-byte `p256dh`, a point off the curve and a
    15-byte `auth`.
- **`tests/staff-push.test.js`**, the relay against a fake push service that
  decrypts with the test subscriber's private key:
  - A report arrives once, with the right headers, and decrypts to `{venue,
    open}`.
  - A phone's or a wristband's `push` is ignored. A bad endpoint or bad keys
    are answered `bad push` and not held.
  - The second report inside the window waits for its end. The window's
    push is skipped when nothing is open.
  - 404, 410 and 403 forget the subscription; 500 does not.
  - A redirect is not followed. A service that never answers is given up.
  - After `signout`: no pushes, the token is `expired`, and the other
    sockets on that token are signed out.
  - 06:00 drops subscriptions with their tokens.
  - Across a restart the subscription is still sent to, and the keys file is
    the same.
  - The 51st subscription at a venue forgets the oldest. An endpoint taken
    under a second token leaves the first.
- **`tests/staff-sw.test.js`** runs `app/public/staff-sw.js` in a `vm` with a
  fake `self`:
  - A push with data shows the title, the body and the tag.
  - A push with no data, or data that is not JSON, still shows *New report*.
  - A click focuses a `/staff` window, or opens `/staff` when there is none.
- **`app/staff/notify.js`** is tested for every state's words.
  `tests/deploy.test.js` checks that `PUSH_KEYS_FILE` is on the volume.
- **Mutations.** Each guard is broken on its own, and exactly its test must
  go red. The guards are:
  - each part of the host check;
  - the key checks;
  - staff only;
  - the token binding;
  - the per-venue cap;
  - the window;
  - forgetting on 404, 410 and 403;
  - `signout`;
  - 06:00;
  - no redirects.
- **In a browser.** Headless Chrome over CDP, as for the offline shell, is
  used because the in-app browser pane cannot register service workers. It
  must show all of these:
  - the worker registered at `/staff`;
  - the manifest linked;
  - each line of §1;
  - SIGN OUT unsubscribing.
- **A real push on this laptop.** A separate Chrome window runs with a
  throwaway profile, never the owner's Chrome. It opens the local relay's
  staff page with a test passcode, turns notifications on and gets a real
  `fcm.googleapis.com` endpoint. A stand-in phone then reports. Proof is the
  relay's `1 sent`, plus the notification's title and body read back with
  `getNotifications()`. The owner is told first, because a Chrome window and
  a notification appear on his screen.
- **On Fly**, after deploying, check that:
  - the log says `push: keys made at /data/push-keys.json`, and
    `push: keys from …` after a restart;
  - `/staff.webmanifest` and `/staff-sw.js` answer with their types.

  No venue has `STAFF_CODES` there yet, so a push on Fly waits for him.
- **Owed by him.**
  - His Android phone: turn notifications on, lock the phone, have a
    report made, see the lock screen, and tap straight into the list.
  - An iPhone, if there is one, from the Home Screen.

  Both need a staff page: `npm run staff-code` and `STAFF_CODES` on Fly, or
  a local relay with a tunnel.

## Also to change when this is built

- **README**:
  - *The staff page*: notifications, the sign-in kept on the device, and
    SIGN OUT reaching the relay.
  - *How it is built*: `relay/push.js` and `app/public/staff-sw.js`.
  - *Always on*: the keys file on the volume.
  - *Abuse resistance*: a push bullet.
  - *What is not done*: drop "Nothing reaches a staff device whose page is
    closed or asleep"; say what a real phone has not yet shown.
- **CLAUDE.md**: the test count.
- **Memory**: `staff-reports`, `work-queue` and `fly-relay`.

## Risks

- **iOS is unproven here.** No iPhone is at hand. Two things rest on
  WebKit's and Apple's documents alone: the tap-only permission rule, and
  how a Home Screen app keeps `localStorage`.
- **Android battery savers.** Some makers hold back background work even
  for high-urgency pushes. A phone like that may alert late.
- **Third parties.** Delivery goes through Google, Apple, Mozilla or
  Microsoft. If one of them is down, the page still works; the push does
  not.

## Amended while planning

1. **The redirect and timeout checks are tested on `send()` in `tests/push.test.js`,** not through the relay: a 10-second wait has no place in the relay's tests.
2. **The relay object gains `pushKey`** (its public key), and for tests `pushedTo(key)`: every held subscription's endpoint at a venue, oldest first, whatever its night.
3. **A push with no readable data** shows *New report* with the body *Tap to see the list*.
4. **An endpoint that fails the check at send time** is `refused` and forgotten, like a 404.
5. **A permission prompt dismissed without an answer** puts the button back. It does not say the browser cannot be used.
6. **The 06:00 test passes at once:** subscriptions ride the token record, which the sweep already drops. It stays as a guard.
7. **Proven in build (Task 10), not in design:** on this laptop's Chrome, which shows Windows' own notifications, `getNotifications()` returns nothing, even for a notification the page itself has just shown. So the real push was proven from Chrome's own DevTools records (push received and decrypted, event dispatched, notification displayed with its title and body), not with `getNotifications()`. It also means the page's clearing of notifications on screen does nothing on Windows desktop Chrome; Android is untried.
