// ON THE BEAT — the fonts the phone app and the staff page carry themselves.
//
//   npm run fonts             # fetch them again, for the icons the code draws today
//   npm run fonts -- --check  # say whether app/fonts/ matches the code; fetches nothing
//
// The pages used to ask Google for Chewy and for the whole Material Symbols icon set (324 KB) on every first visit: two
// more hosts to find and connect to on a venue's network, which is the one thing nobody controls; icons that are words
// until the last byte lands; and Google told the address of every phone that opened the app. They are files of ours in
// app/fonts/ now, served beside the page. Chewy is the file Google serves. Material Symbols is cut down to the icons the
// app draws, by asking Google's own API for exactly those names once, here, and keeping the answer. Nothing is fetched
// while the app builds or runs: this is the only thing that reaches out, and only when a person runs it.
//
// A name the icon font lacks shows on a phone as the word itself, so the code's icons are read from its source and
// held to the manifest (app/fonts/fonts.json) by tests/fonts.test.js: an icon added without running this fails the suite.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, normalize, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_DIR = fileURLToPath(new URL('../app/', import.meta.url));
export const FONTS_DIR = join(APP_DIR, 'fonts');
const MANIFEST = 'fonts.json';
const CHEWY_FILE = 'chewy-latin.woff2';
const ICONS_FILE = 'material-symbols-outlined.woff2';

export const CHEWY_CSS = 'https://fonts.googleapis.com/css2?family=Chewy&display=swap';
// The one instance of the icon font the app has always drawn: size 24, regular weight, outlined, no grade.
const ICONS_CSS = 'https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,400,0,0';
/** Google answers a browser with woff2 files and a script with something else: ask as Chrome does. */
const BROWSER = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const sha = (data) => createHash('sha256').update(data).digest('hex');
const isWoff2 = (data) => data.subarray(0, 4).toString('latin1') === 'wOF2';

/** The request for the icon font cut to these names (Google wants them sorted, each once). */
export const iconCssUrl = (names) => ICONS_CSS + '&icon_names=' + [...new Set(names)].sort().join(',') + '&display=block';

// --- the icons the code draws ---

/** Every script of the app (not the files served as they are, nor the fonts): `{ path, text }`, paths relative to app/. */
export function readAppSource(dir = APP_DIR) {
  const out = [];
  const walk = (at) => {
    for (const e of readdirSync(at, { withFileTypes: true })) {
      const full = join(at, e.name);
      const rel = relative(dir, full).split(/[\\/]/).join('/');
      if (e.isDirectory()) { if (rel !== 'public' && rel !== 'fonts') walk(full); }
      else if (/\.(?:jsx?|mjs)$/.test(e.name)) out.push({ path: rel, text: readFileSync(full, 'utf8') });
    }
  };
  walk(dir);
  return out.sort((a, b) => (a.path < b.path ? -1 : 1));
}

const GLYPH = /^[a-z][a-z0-9_]*$/;
/** `row.icon`: a name read from a table that is itself scanned. */
const FROM_TABLE = /^[A-Za-z_$][\w$]*\.icon$/;

/**
 * Every icon name the sources hand to the font, and every place that names one in a way this does not understand.
 * Closed on purpose: the forms below are the ones the app uses, and anything else (a name built from parts, passed in as
 * a variable, drawn through another class) is a problem to be looked at, because a name missed here is a word on a phone.
 */
export function scanIcons(sources) {
  const names = new Set();
  const problems = [];
  for (const { path, text } of sources) {
    const place = (index) => path + ':' + (text.slice(0, index).split('\n').length);
    const literal = (index, value) => {
      if (GLYPH.test(value)) names.add(value);
      else problems.push(place(index) + " '" + value + "' is not a glyph name");
    };
    // <Icon name="x" /> and <Icon name={row.icon} />: the app's one door for an icon.
    for (const m of text.matchAll(/<Icon\b([^>]*?)\/?>/g)) {
      const attr = m[1].match(/\bname=(?:"([^"]*)"|\{([^}]*)\})/);
      if (!attr) problems.push(place(m.index) + ' <Icon> without a name');
      else if (attr[1] !== undefined) literal(m.index, attr[1]);
      else if (!FROM_TABLE.test(attr[2].trim())) problems.push(place(m.index) + ' <Icon name={' + attr[2].trim() + "}> is neither a literal nor a row's .icon");
    }
    // { icon: 'x' } in the tables the rows are made from; null for a card that draws its own glyph.
    for (const m of text.matchAll(/\bicon\s*:\s*([^,}\n]+)/g)) {
      const value = m[1].trim();
      const quoted = value.match(/^(['"])([^'"]*)\1$/);
      if (quoted) literal(m.index, quoted[2]);
      else if (value !== 'null' && !FROM_TABLE.test(value)) problems.push(place(m.index) + ' icon: ' + value + " is neither a literal, null nor a row's .icon");
    }
    // The class itself, where an icon is drawn by hand instead of through <Icon>; the door's own span names no icon.
    for (const m of text.matchAll(/className=("[^"]*"|\{[^}]*\})/g)) {
      if (!m[1].replace(/[^A-Za-z0-9_-]+/g, ' ').split(' ').includes('ms')) continue;
      const child = text.slice(m.index + m[0].length).match(/^[^>]*>([^<]*)</);
      if (m[1][0] !== '"') problems.push(place(m.index) + ' the class ms is set from an expression, so its icon cannot be read');
      else if (!child) problems.push(place(m.index) + ' an element of class ms with no text to read');
      else if (child[1] === '{name}' && path === 'ui.jsx') continue;
      else literal(m.index, child[1]);
    }
  }
  return { names: [...names].sort(), problems };
}

// --- asking Google, once ---

/** The font faces in a stylesheet: where the file is, which letters it is for, and how a browser waits for it. */
export function parseFontFaces(css) {
  const faces = [];
  for (const m of css.matchAll(/@font-face\s*\{([^}]*)\}/g)) {
    const body = m[1];
    const prop = (name) => body.match(new RegExp('(?:^|[;\\s{])' + name + '\\s*:\\s*([^;]+?)\\s*(?:;|$)'))?.[1] ?? null;
    faces.push({
      family: prop('font-family')?.replace(/^['"]|['"]$/g, '') ?? null,
      display: prop('font-display'),
      src: body.match(/url\(\s*(['"]?)([^'")]+)\1\s*\)/)?.[2] ?? null,
      range: prop('unicode-range'),
    });
  }
  return faces;
}

/** Chewy as Google serves it, and the icon font cut to `names`: `{ chewy, icons }`, each with its bytes in `data`. */
export async function fetchFonts({ names, fetchImpl = fetch }) {
  if (!names.length) throw new Error('no icons to ask for: the app names none');
  const ask = async (url) => {
    const res = await fetchImpl(url, { headers: { 'user-agent': BROWSER } });
    if (!res.ok) throw new Error(url + ' answered ' + res.status);
    return res;
  };
  // One face each: a second would be a subset Google began to split by script, which wants a person's eye, not a guess.
  const font = async (what, cssUrl) => {
    const faces = parseFontFaces(await (await ask(cssUrl)).text());
    if (faces.length !== 1) throw new Error(what + ': expected one @font-face in the answer to ' + cssUrl + ', got ' + faces.length);
    const data = Buffer.from(await (await ask(faces[0].src)).arrayBuffer());
    if (!isWoff2(data)) throw new Error(what + ': ' + faces[0].src + ' is not a woff2 file');
    return { face: faces[0], data };
  };
  const chewy = await font('Chewy', CHEWY_CSS);
  const sorted = [...new Set(names)].sort();
  const icons = await font('Material Symbols', iconCssUrl(sorted));
  return {
    chewy: { file: CHEWY_FILE, from: CHEWY_CSS, range: chewy.face.range, data: chewy.data },
    icons: { file: ICONS_FILE, from: iconCssUrl(sorted), names: sorted, data: icons.data },
  };
}

/** What app/fonts/fonts.json says about the files: where they came from, how big, which icons the second holds. */
export const manifestFor = ({ chewy, icons }) => ({
  note: 'Written by scripts/fonts.mjs (npm run fonts). Do not edit by hand.',
  chewy: { file: chewy.file, from: chewy.from, range: chewy.range, bytes: chewy.data.length, sha256: sha(chewy.data) },
  icons: { file: icons.file, from: icons.from, names: icons.names, bytes: icons.data.length, sha256: sha(icons.data) },
});

export function writeFonts(got, dir = FONTS_DIR) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, got.chewy.file), got.chewy.data);
  writeFileSync(join(dir, got.icons.file), got.icons.data);
  writeFileSync(join(dir, MANIFEST), JSON.stringify(manifestFor(got), null, 2) + '\n');
}

// --- holding the files to the code ---

/** What is wrong with the font files, in words: none missing, none changed, none not a font, no icon drawn but not in. */
export function checkFonts({ dir = FONTS_DIR, sources = readAppSource() } = {}) {
  const problems = [];
  const path = join(dir, MANIFEST);
  if (!existsSync(path)) return [MANIFEST + ' is missing from ' + dir + ': run npm run fonts'];
  let manifest;
  try { manifest = JSON.parse(readFileSync(path, 'utf8')); } catch (e) { return [MANIFEST + ' is not JSON: ' + e.message]; }
  for (const key of ['chewy', 'icons']) {
    const entry = manifest[key];
    if (!entry?.file) { problems.push(MANIFEST + ' lists no ' + key + ' font'); continue; }
    const file = join(dir, entry.file);
    if (!existsSync(file)) { problems.push(entry.file + ' is missing'); continue; }
    const data = readFileSync(file);
    if (!isWoff2(data)) problems.push(entry.file + ' is not a woff2 file');
    if (data.length !== entry.bytes || sha(data) !== entry.sha256) problems.push(entry.file + ' is not the file ' + MANIFEST + ' lists (its sha256 differs)');
  }
  const scan = scanIcons(sources);
  problems.push(...scan.problems);
  const held = new Set(manifest.icons?.names ?? []);
  for (const name of scan.names) if (!held.has(name)) problems.push("the icon '" + name + "' is drawn but is not in the icon font: run npm run fonts");
  return problems;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === normalize(process.argv[1])) {
  if (process.argv.includes('--check')) {
    const problems = checkFonts();
    if (problems.length) console.error(problems.join('\n'));
    else console.log('fonts: app/fonts/ holds every icon the code draws, and the files are the ones listed');
    process.exitCode = problems.length ? 1 : 0;
  } else {
    const { names, problems } = scanIcons(readAppSource());
    if (problems.length) {
      console.error(problems.join('\n'));
      process.exit(1);
    }
    const got = await fetchFonts({ names });
    writeFonts(got);
    console.log('fonts: ' + got.chewy.file + ' ' + got.chewy.data.length + ' B, ' + got.icons.file + ' ' + got.icons.data.length + ' B (' + names.length + ' icons)');
  }
}
