// ON THE BEAT — the fonts the pages carry themselves (scripts/fonts.mjs, app/fonts/). Chewy and the icon font used to
// come from Google on every first visit; they are files beside the page now, and the icon font holds only the icons the
// code draws. A name the font lacks shows on a phone as a word (waving_hand across a card), so the scan that finds the
// names must read every form the app uses and refuse any it cannot, and the files must be the ones the manifest says.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { APP_POLICY, STAFF_POLICY, createRelay } from '../relay/server.js';
import {
  CHEWY_CSS, FONTS_DIR, checkFonts, fetchFonts, iconCssUrl, manifestFor, parseFontFaces, readAppSource, scanIcons,
} from '../scripts/fonts.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), 'otb-fonts-'));
after(() => rmSync(scratch, { recursive: true, force: true }));

const sha = (data) => createHash('sha256').update(data).digest('hex');
const src = (path, text) => ({ path, text });

// What Google answered when asked on 1 Oct 2026, trimmed to what the parser reads.
const CHEWY_ANSWER = `/* latin */
@font-face {
  font-family: 'Chewy';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/chewy/v18/uK_94ruUb-k-wn52KjI.woff2) format('woff2');
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+2000-206F;
}
`;
const ICONS_ANSWER = `/* fallback */
@font-face {
  font-family: 'Material Symbols Outlined';
  font-style: normal;
  font-weight: 400;
  font-display: block;
  src: url(https://fonts.gstatic.com/s/materialsymbolsoutlined/v374/abc.woff2) format('woff2');
}

.material-symbols-outlined {
  font-family: 'Material Symbols Outlined';
  font-weight: normal;
}
`;

// --- reading the code's icons ---

test('the scan reads an icon from every form the app uses', () => {
  const { names, problems } = scanIcons([
    src('ui.jsx', '<span aria-hidden="true" className="ms" style={{ fontSize: size }}>{name}</span>\n<Icon name={r.icon} size={20} />'),
    src('Back.jsx', '<Icon name="arrow_back" size={24} />\n<Icon name="chevron_right" />'),
    src('rows.js', "const a = { icon: 'block', label: 'Block' };\nconst b = { icon: \"flag\" };\nconst c = { icon: null };"),
    src('more.js', 'rows: PROMISES.map((p) => ({ icon: p.icon, label: p.main }))'),
    src('Hi.jsx', '<div><span className="ms">waving_hand</span></div>'),
    src('Home.jsx', '{c.icon ? <Icon name={c.icon} size={36} /> : <Glyph />}'),
  ]);
  assert.deepEqual(problems, []);
  assert.deepEqual(names, ['arrow_back', 'block', 'chevron_right', 'flag', 'waving_hand']);
});

test('the scan names the place of every form it cannot read, and takes nothing from it', () => {
  const { names, problems } = scanIcons([
    src('A.jsx', 'ok\n<Icon name={foo} />'),
    src('B.jsx', '<Icon name={`level_${n}`} />'),
    src('C.js', "const x = { icon: pick('a', 'b') };"),
    src('D.jsx', '<span className="ms">{label}</span>'),
    src('E.jsx', '<Icon size={2} />'),
    src('F.js', "const y = { icon: 'Not Valid' };"),
    src('G.jsx', '<span className="ms">{name}</span>'),
    src('H.jsx', "<span className={'ms ' + extra}>x</span>"),
  ]);
  assert.deepEqual(names, []);
  assert.deepEqual(problems.map((p) => p.split(' ')[0]), ['A.jsx:2', 'B.jsx:1', 'C.js:1', 'D.jsx:1', 'E.jsx:1', 'F.js:1', 'G.jsx:1', 'H.jsx:1'],
    "a bare {name} is only ui.jsx's own door, in any other file it is an unread icon");
});

test('the scan reads the real app: every icon it draws is a name it understands', () => {
  const { names, problems } = scanIcons(readAppSource());
  assert.deepEqual(problems, []);
  for (const known of ['waving_hand', 'arrow_back', 'visibility_off', 'queue_music', 'qr_code_scanner']) assert.ok(names.includes(known), known);
  assert.ok(names.length >= 30, 'found ' + names.length);
  assert.ok(names.every((n) => /^[a-z][a-z0-9_]*$/.test(n)), 'a name is a glyph\'s, not a path like the staff worker\'s icon');
});

// --- asking Google, once, for the files ---

test('the icon request names each icon once, in order, with the axes the app draws', () => {
  const url = iconCssUrl(['watch', 'arrow_back', 'watch']);
  assert.match(url, /^https:\/\/fonts\.googleapis\.com\/css2\?family=Material\+Symbols\+Outlined:opsz,wght,FILL,GRAD@24,400,0,0&/);
  assert.match(url, /&icon_names=arrow_back,watch&display=block$/);
  assert.equal(CHEWY_CSS, 'https://fonts.googleapis.com/css2?family=Chewy&display=swap');
});

test('a stylesheet from Google is read for its font faces and nothing else in it', () => {
  assert.deepEqual(parseFontFaces(CHEWY_ANSWER), [{
    family: 'Chewy', display: 'swap', src: 'https://fonts.gstatic.com/s/chewy/v18/uK_94ruUb-k-wn52KjI.woff2',
    range: 'U+0000-00FF, U+0131, U+0152-0153, U+2000-206F',
  }]);
  assert.deepEqual(parseFontFaces(ICONS_ANSWER), [{
    family: 'Material Symbols Outlined', display: 'block', src: 'https://fonts.gstatic.com/s/materialsymbolsoutlined/v374/abc.woff2', range: null,
  }]);
  assert.deepEqual(parseFontFaces('body { color: red }'), []);
});

/** A fetch that answers from a table, saying what it was asked and with which user agent. */
function stand(routes, seen = []) {
  return async (url, init) => {
    seen.push({ url, agent: init?.headers?.['user-agent'] });
    if (!(url in routes)) return { ok: false, status: 404, text: async () => '', arrayBuffer: async () => new ArrayBuffer(0) };
    const body = Buffer.from(routes[url]);
    return { ok: true, status: 200, text: async () => body.toString('utf8'), arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.length) };
  };
}
const woff2 = (tail) => Buffer.concat([Buffer.from('wOF2'), Buffer.from(tail)]);
const CHEWY_FILE = 'https://fonts.gstatic.com/s/chewy/v18/uK_94ruUb-k-wn52KjI.woff2';
const ICONS_FILE = 'https://fonts.gstatic.com/s/materialsymbolsoutlined/v374/abc.woff2';
const routes = (names) => ({
  [CHEWY_CSS]: CHEWY_ANSWER, [CHEWY_FILE]: woff2('chewy'), [iconCssUrl(names)]: ICONS_ANSWER, [ICONS_FILE]: woff2('icons'),
});

test('both fonts are fetched as a browser would ask for them, and kept as they came', async () => {
  const seen = [];
  const got = await fetchFonts({ names: ['watch', 'arrow_back'], fetchImpl: stand(routes(['arrow_back', 'watch']), seen) });
  assert.deepEqual(seen.map((s) => s.url), [CHEWY_CSS, CHEWY_FILE, iconCssUrl(['arrow_back', 'watch']), ICONS_FILE]);
  for (const s of seen) assert.match(s.agent, /Chrome\/\d+/, 'Google picks woff2 for a browser, and something else for a script');
  assert.equal(got.chewy.file, 'chewy-latin.woff2');
  assert.equal(got.chewy.range, 'U+0000-00FF, U+0131, U+0152-0153, U+2000-206F');
  assert.deepEqual(got.chewy.data, woff2('chewy'));
  assert.equal(got.icons.file, 'material-symbols-outlined.woff2');
  assert.deepEqual(got.icons.names, ['arrow_back', 'watch']);
  assert.deepEqual(got.icons.data, woff2('icons'));
  const manifest = manifestFor(got);
  assert.equal(manifest.chewy.bytes, 9);
  assert.equal(manifest.chewy.sha256, sha(woff2('chewy')));
  assert.equal(manifest.icons.sha256, sha(woff2('icons')));
  assert.deepEqual(manifest.icons.names, ['arrow_back', 'watch']);
  assert.equal(manifest.icons.from, iconCssUrl(['arrow_back', 'watch']));
});

test('an answer that is not exactly one woff2 font is refused, in words', async () => {
  const names = ['watch'];
  await assert.rejects(fetchFonts({ names, fetchImpl: stand({}) }), /answered 404/);
  await assert.rejects(fetchFonts({ names, fetchImpl: stand({ ...routes(names), [CHEWY_FILE]: 'GIF89a' }) }), /not a woff2/);
  await assert.rejects(fetchFonts({ names, fetchImpl: stand({ ...routes(names), [CHEWY_CSS]: CHEWY_ANSWER + CHEWY_ANSWER }) }), /expected one @font-face.*got 2/);
  await assert.rejects(fetchFonts({ names, fetchImpl: stand({ ...routes(names), [CHEWY_CSS]: 'nothing here' }) }), /expected one @font-face.*got 0/);
  await assert.rejects(fetchFonts({ names: [], fetchImpl: stand({}) }), /no icons/);
});

// --- the files in the repository ---

test('the font files are the ones the manifest names, and the icon font holds every icon the code draws', () => {
  assert.deepEqual(checkFonts(), []);
});

/** A copy of the real fonts to break one way at a time. */
function copyOfFonts(name) {
  const dir = join(scratch, name);
  cpSync(FONTS_DIR, dir, { recursive: true });
  return dir;
}

test('a font that is missing, changed or not the one listed is said so, and so is a name the font lacks', () => {
  const gone = copyOfFonts('gone');
  rmSync(join(gone, 'material-symbols-outlined.woff2'));
  assert.match(checkFonts({ dir: gone }).join('\n'), /material-symbols-outlined\.woff2.*missing/);

  const changed = copyOfFonts('changed');
  const bytes = readFileSync(join(changed, 'chewy-latin.woff2'));
  bytes[bytes.length - 1] ^= 0xff;
  writeFileSync(join(changed, 'chewy-latin.woff2'), bytes);
  assert.match(checkFonts({ dir: changed }).join('\n'), /chewy-latin\.woff2.*sha256/);

  const notFont = copyOfFonts('not-font');
  const manifest = JSON.parse(readFileSync(join(notFont, 'fonts.json'), 'utf8'));
  writeFileSync(join(notFont, 'chewy-latin.woff2'), 'GIF89a');
  manifest.chewy.sha256 = sha('GIF89a');
  manifest.chewy.bytes = 6;
  writeFileSync(join(notFont, 'fonts.json'), JSON.stringify(manifest));
  assert.match(checkFonts({ dir: notFont }).join('\n'), /chewy-latin\.woff2.*not a woff2/);

  const lacking = checkFonts({ sources: [src('New.jsx', '<Icon name="zzz_new_icon" />')] });
  assert.equal(lacking.length, 1);
  assert.match(lacking[0], /zzz_new_icon.*npm run fonts/);

  const unreadable = checkFonts({ sources: [src('New.jsx', '<Icon name={whatever} />')] });
  assert.match(unreadable.join('\n'), /New\.jsx:1/);

  const noManifest = join(scratch, 'empty');
  cpSync(FONTS_DIR, noManifest, { recursive: true });
  rmSync(join(noManifest, 'fonts.json'));
  assert.match(checkFonts({ dir: noManifest }).join('\n'), /fonts\.json.*missing/);
});

test('the stylesheet declares the two faces from the manifest\'s files, the way Google did', () => {
  const manifest = JSON.parse(readFileSync(join(FONTS_DIR, 'fonts.json'), 'utf8'));
  const faces = parseFontFaces(readFileSync(root + 'app/styles.css', 'utf8'));
  assert.deepEqual(faces.map((f) => f.family), ['Chewy', 'Material Symbols Outlined']);
  const [chewy, icons] = faces;
  assert.equal(chewy.src, './fonts/' + manifest.chewy.file);
  assert.equal(chewy.range, manifest.chewy.range, 'the range keeps text Chewy does not draw on the system font, as before');
  assert.equal(chewy.display, 'swap');
  assert.equal(icons.src, './fonts/' + manifest.icons.file);
  assert.equal(icons.display, 'block', 'an icon is empty until its font is in, never a word');
});

// --- nothing left that asks another host ---

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
}

test('the pages and the shell worker name no font host, and the built pages name no host at all', () => {
  for (const page of ['index.html', 'staff.html']) {
    for (const where of [root + 'app/' + page, root + 'dist/' + page]) {
      const html = readFileSync(where, 'utf8');
      assert.doesNotMatch(html, /fonts\.(googleapis|gstatic)\.com/, where);
      assert.doesNotMatch(html, /\b(?:href|src)="(?:https?:)?\/\//, where + ' loads something from another host');
    }
  }
  assert.doesNotMatch(readFileSync(root + 'app/public/sw.js', 'utf8'), /googleapis|gstatic/);
  for (const file of walk(root + 'dist').filter((f) => /\.(html|css|js|webmanifest)$/.test(f))) {
    assert.doesNotMatch(readFileSync(file, 'utf8'), /fonts\.(googleapis|gstatic)\.com/, file);
  }
});

test('the built stylesheet points each face at a woff2 file the build wrote, never inline', () => {
  const css = walk(root + 'dist/assets').filter((f) => f.endsWith('.css')).map((f) => readFileSync(f, 'utf8')).join('\n');
  const faces = parseFontFaces(css);
  assert.deepEqual(faces.map((f) => f.family).sort(), ['Chewy', 'Material Symbols Outlined']);
  for (const face of faces) {
    assert.match(face.src, /^\/assets\/[^/]+\.woff2$/, face.family + ' is a file under /assets/, which is cached for good and carried by the shell');
    assert.ok(existsSync(root + 'dist' + face.src), face.src);
  }
  assert.doesNotMatch(css, /url\(\s*["']?data:(?:font|application\/(?:x-)?font)/i, 'a data: font would be refused under font-src \'self\'');
});

test('neither page\'s policy names a host: styles and fonts come from the page\'s own origin', () => {
  for (const [name, policy] of [['staff', STAFF_POLICY], ['app', APP_POLICY]]) {
    const directives = Object.fromEntries(policy.split('; ').map((d) => [d.split(' ')[0], d.split(' ').slice(1)]));
    assert.deepEqual(directives['style-src'], ["'self'"], name);
    assert.deepEqual(directives['font-src'], ["'self'"], name);
    assert.doesNotMatch(policy, /https?:\/\//, name);
  }
});

test('the build never turns a font into a data: URL, however small the subset gets', () => {
  // A font under 4 KB (a subset of a handful of icons) is what Vite inlines unless told not to, and a data: font is
  // refused under font-src 'self'. So the real config builds a tiny font here, in a process of its own, and a build
  // without its rule builds the same one as the control: the fixture can fail.
  // The real path: Windows may hand the temp folder over by its short name, which Vite then reads as another folder.
  mkdirSync(join(scratch, 'inline'));
  const dir = realpathSync.native(join(scratch, 'inline'));
  writeFileSync(join(dir, 'index.html'), '<!doctype html><link rel="stylesheet" href="./a.css"><p>x</p>');
  writeFileSync(join(dir, 'a.css'), "@font-face { font-family: T; src: url('./tiny.woff2') format('woff2'); } p { font-family: T; }");
  writeFileSync(join(dir, 'tiny.woff2'), woff2('0123456789'));
  const script = [
    "import { build } from 'vite';",
    'import config from ' + JSON.stringify(pathToFileURL(root + 'vite.config.js').href) + ';',
    'const dir = ' + JSON.stringify(dir.split(sep).join('/')) + ';',
    "for (const [name, limit] of [['real', config.build.assetsInlineLimit], ['plain', 4096]]) {",
    "  await build({ configFile: false, root: dir, logLevel: 'silent', build: { outDir: dir + '/' + name, emptyOutDir: true, assetsInlineLimit: limit, rolldownOptions: { input: dir + '/index.html' } } });",
    '}',
  ].join('\n');
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: root, encoding: 'utf8', timeout: 120_000 });
  assert.equal(run.status, 0, 'the two builds ran: ' + run.stderr);
  const cssOf = (name) => walk(join(dir, name, 'assets')).filter((f) => f.endsWith('.css')).map((f) => readFileSync(f, 'utf8')).join('\n');
  assert.match(cssOf('plain'), /url\(\s*["']?data:/, 'under the limit a plain build inlines the font');
  const real = cssOf('real');
  assert.doesNotMatch(real, /data:/, 'the real config does not');
  assert.match(parseFontFaces(real)[0].src, /^\/assets\/tiny-[^/]+\.woff2$/, 'it is a file under /assets/, as the others are');
});

test('the relay hands each built font out as a font, cached for good, and the page that uses it allows it', async () => {
  const relay = await createRelay({ port: 0, host: '127.0.0.1', root: root + 'dist', nightTz: 'Australia/Brisbane' });
  try {
    /** The answer with its body read to the end, so no connection is left waiting on it. */
    const at = async (path) => {
      const res = await fetch('http://127.0.0.1:' + relay.port + path);
      return { status: res.status, headers: res.headers, body: Buffer.from(await res.arrayBuffer()) };
    };
    const css = walk(root + 'dist/assets').filter((f) => f.endsWith('.css')).map((f) => readFileSync(f, 'utf8')).join('\n');
    const faces = parseFontFaces(css);
    assert.equal(faces.length, 2);
    for (const face of faces) {
      const res = await at(face.src);
      assert.equal(res.status, 200, face.src);
      assert.equal(res.headers.get('content-type'), 'font/woff2', face.src);
      assert.match(res.headers.get('cache-control'), /immutable/, face.src);
      assert.equal(res.headers.get('content-security-policy'), null, face.src + ' is not a page');
      assert.equal(res.body.subarray(0, 4).toString('latin1'), 'wOF2', face.src);
    }
    for (const path of ['/', '/staff']) {
      const policy = (await at(path)).headers.get('content-security-policy');
      assert.ok(policy.split('; ').includes("font-src 'self'") && policy.split('; ').includes("style-src 'self'"), path + ' lacks its own fonts in ' + policy);
    }
  } finally {
    await relay.close();
  }
});
