# The phone app under a Content-Security-Policy of its own

Date: 30 Sep 2026. Item 4 of the menu the owner asked for on 29 Sep, taken on
his 「继续」. The staff page got a full policy in the security review of 29 Sep
(`2026-09-29-staff-security-design.md` §4); the phone app carried only the
framing rule, because its policy was to be drafted against a real inventory of
what the app loads, and rolled out only after Safari's reading of
`connect-src` had been tried on a real phone. This is the draft and the local
proof. The rollout gate still stands.

## What the app loads, checked against the built `dist/`

- **Scripts:** one module bundle (`/assets/main-*.js`) plus the lazy chunks
  (`jsQR`, `styles`), and `/sw.js`, registered only in a production build over
  https. No inline script in the built page, no `eval`, no `new Function`, no
  worker of its own — checked in the built bundles, not only in `app/`.
- **Styles:** one built stylesheet, plus two Google Fonts stylesheets the page
  links (Chewy, Material Symbols). React sets element styles through the CSSOM,
  which no policy gates; nothing writes a `<style>` at runtime.
- **Fonts:** the files those stylesheets name, from `fonts.gstatic.com`. No
  font or `data:` URL is inlined in the built CSS.
- **Images:** its own icons and manifest. `data:` stays allowed as in the staff
  policy, since Vite may inline a small image into a future build.
- **Media — the one way the app is wider than the staff page:** a recorded
  five seconds loops back from a `blob:` URL the phone made itself
  (`URL.createObjectURL`, Dance and the keep-it sheet), and the floor's clips
  play from `/clip/…` on this origin. Both belong in `media-src`.
- **Socket:** one WebSocket to the page's own host (`/api/ws`). `ws:` and
  `wss:` are named beside `'self'` for the browsers that do not count a socket
  to the page's own host as same-origin — the same reason the staff policy
  carries them, and the reading Safari gives this is what the real-phone trial
  will check.
- **The camera needs no allowance here.** `getUserMedia` answers to the
  browser's permission, not to CSP, and a MediaStream on a `<video>` is not a
  fetched source. The QR scanner draws frames to a canvas, which no directive
  gates.

## The policy (`APP_POLICY` in `relay/server.js`)

    default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com;
    font-src https://fonts.gstatic.com; img-src 'self' data:; media-src 'self' blob:;
    connect-src 'self' ws: wss:; worker-src 'self'; manifest-src 'self';
    base-uri 'none'; object-src 'none'; form-action 'self'; frame-ancestors 'none'

The staff page's, plus `media-src`. Served on every phone-app page (the app's
own routes all resolve to `index.html`); the staff page keeps its own; assets,
clips and API answers carry no policy, as before, and `X-Frame-Options: DENY`,
`nosniff` and `no-referrer` are unchanged everywhere.

## Proven where, gated on what

- **Local, headless Chrome:** the app opens under the policy, its screens run
  and its console stays empty of refusals; the staff page re-checked beside it.
  `tests/staff.test.js` holds the served header, directive by directive.
- **Local, headless WebKit (30 Sep, corroboration only):** WebKit is the
  engine family Safari reads `connect-src` with, so the same page was opened
  in Playwright's WebKit against a local relay: the app rendered, the console
  held nothing at all, and a WebSocket opened from the page's own context
  joined a venue and got its `view` back — one frame each way under
  `connect-src 'self' ws: wss:`. This narrows the Safari risk; it does not
  replace the phone.
- **Not yet on the live machine.** Pushing this does not redeploy Fly. The
  policy goes live with the next `flyctl deploy`, and that deploy waits until
  Safari on a real iPhone has been seen to hold `connect-src 'self' ws: wss:`
  and open its socket — an iPhone has never run the app. Until then the live
  phone app keeps the framing rule only, exactly as README's *What is not
  done* says.

## Tests

`tests/staff.test.js`, "every response carries the security headers…": both
pages now assert their full policy, the app's including `media-src 'self'
blob:` and no `unsafe-` anywhere; non-pages assert they carry no policy.
