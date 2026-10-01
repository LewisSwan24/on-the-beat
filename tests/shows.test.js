// ON THE BEAT — which shows the relay starts with: the operator's file on the volume when it is good, the list that
// ships with the relay when it is missing or bad, and never an empty list.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRelay, chooseShows, loadShows } from '../relay/server.js';

const bundled = fileURLToPath(new URL('../relay/shows.json', import.meta.url));
const shipped = loadShows(bundled);
const dir = mkdtempSync(join(tmpdir(), 'otb-shows-'));
after(() => rmSync(dir, { recursive: true, force: true }));

const show = (id) => ({ id, act: 'SOMEONE', venue: id, doors: '19:00' });
const fileWith = (name, body) => {
  const file = join(dir, name);
  writeFileSync(file, typeof body === 'string' ? body : JSON.stringify(body));
  return file;
};
const choose = (file) => {
  const said = [];
  const shows = chooseShows(file, bundled, (line) => said.push(line));
  return { shows, said };
};
const usingShipped = 'using the ' + shipped.length + ' that ship with the relay';

async function logged(fn) {
  const said = [];
  const was = console.log;
  console.log = (...a) => said.push(a.join(' '));
  try { await fn(); } finally { console.log = was; }
  return said;
}
const servedBy = async (relay) => (await (await fetch('http://127.0.0.1:' + relay.port + '/api/shows')).json()).map((s) => s.id);

test('the list that ships with the relay is there to fall back to', () => {
  assert.ok(shipped.length >= 1, 'relay/shows.json has no usable show');
});

test('a good file is the list, and the log says where it came from', () => {
  const file = fileWith('good.json', [show('first-venue'), show('second-venue')]);
  const { shows, said } = choose(file);
  assert.deepEqual(shows.map((s) => s.id), ['first-venue', 'second-venue']);
  assert.deepEqual(said, ['shows: 2 from ' + file]);
});

test('no file at the path is the ordinary case: the shipped list, said once', () => {
  const file = join(dir, 'never-made.json');
  const { shows, said } = choose(file);
  assert.deepEqual(shows, shipped);
  assert.equal(said.length, 1, said.join('\n'));
  assert.ok(said[0].includes('no file at ' + file), said[0]);
  assert.ok(said[0].includes(usingShipped), said[0]);
});

test('a file that is not JSON leaves the shipped list, and the log names the file and the fault', () => {
  const file = fileWith('not-json.json', '[{"id": "first-venue"},');
  const { shows, said } = choose(file);
  assert.deepEqual(shows, shipped);
  assert.equal(said.length, 1, said.join('\n'));
  assert.ok(said[0].includes(file) && said[0].includes('is not JSON'), said[0]);
  assert.ok(said[0].includes(usingShipped), said[0]);
});

test('a fault in a file laid out over several lines is still one line of log', () => {
  const { shows, said } = choose(fileWith('laid-out.json', '[\n  {"id": x}\n]'));   // V8 quotes the source back, newlines and all
  assert.deepEqual(shows, shipped);
  assert.equal(said.length, 1, said.join('\n'));
  assert.ok(said[0].includes('is not JSON') && !said[0].includes('\n'), JSON.stringify(said[0]));
});

test('JSON that is not a list of shows leaves the shipped list', () => {
  const file = fileWith('an-object.json', { id: 'first-venue' });
  const { shows, said } = choose(file);
  assert.deepEqual(shows, shipped);
  assert.equal(said.length, 1, said.join('\n'));
  assert.ok(said[0].includes(file) && said[0].includes('is not a list of shows'), said[0]);
});

test('an empty list, or a list with nothing usable in it, never empties the relay', () => {
  const empty = choose(fileWith('empty.json', []));
  assert.deepEqual(empty.shows, shipped);
  assert.equal(empty.said.length, 1, empty.said.join('\n'));
  assert.ok(empty.said[0].includes('has no usable show') && empty.said[0].includes(usingShipped), empty.said[0]);

  const unusable = choose(fileWith('unusable.json', [{ id: 'Moth Club' }, { act: 'NO ID' }]));
  assert.deepEqual(unusable.shows, shipped);
  assert.equal(unusable.said.filter((l) => l.includes('dropped')).length, 2, unusable.said.join('\n'));
  assert.ok(unusable.said.at(-1).includes('has no usable show') && unusable.said.at(-1).includes(usingShipped), unusable.said.join('\n'));
});

test('a bad entry is dropped by name and the rest stand', () => {
  const file = fileWith('mixed.json', [show('kept-venue'), { id: 'Moth Club' }, null, { id: 'bad\nid' }]);
  const { shows, said } = choose(file);
  assert.deepEqual(shows.map((s) => s.id), ['kept-venue']);
  assert.equal(said.length, 4, said.join('\n'));
  assert.ok(/^shows: entry 2 of .* dropped: .*"Moth Club"/.test(said[0]), said[0]);
  assert.ok(/^shows: entry 3 of .* dropped: not a show$/.test(said[1]), said[1]);
  assert.ok(/^shows: entry 4 of .* dropped: .*"bad\?id"/.test(said[2]), 'a control character goes into the log as itself: ' + JSON.stringify(said[2]));
  assert.equal(said[3], 'shows: 1 from ' + file);
  assert.ok(said.every((l) => !l.includes('\n')), 'one entry, one line');
});

test('no control character of an id reaches the log, in the id or in what it should read', () => {
  const { said } = choose(fileWith('control.json', [{ id: 'Bell' + String.fromCodePoint(7) + 'id' }, show('kept-venue')]));
  assert.equal(said.length, 2, said.join('\n'));
  assert.ok(said[0].includes('the id "Bell?id" should read "bell?id"'), JSON.stringify(said[0]));
});

test('an id that is blank or not text is dropped, and the line says which', () => {
  const file = fileWith('blank.json', [{ id: '' }, { id: '   ' }, { id: 42 }, show('kept-venue')]);
  const { shows, said } = choose(file);
  assert.deepEqual(shows.map((s) => s.id), ['kept-venue']);
  assert.equal(said.length, 4, said.join('\n'));
  assert.ok(/^shows: entry 1 of .* dropped: the id is empty$/.test(said[0]), said[0]);
  assert.ok(/^shows: entry 2 of .* dropped: the id is empty$/.test(said[1]), said[1]);
  assert.ok(/^shows: entry 3 of .* dropped: no id$/.test(said[2]), said[2]);
});

test('an id too long to be a room key is shown short in the log', () => {
  const { shows, said } = choose(fileWith('long.json', [{ id: 'x'.repeat(200) }, show('kept-venue')]));
  assert.deepEqual(shows.map((s) => s.id), ['kept-venue']);
  assert.ok(said[0].includes('"' + 'x'.repeat(80) + '..."'), said[0]);
  assert.ok(!said[0].includes('x'.repeat(81)), said[0]);
});

test('a byte order mark in front of the list is not a fault', () => {
  const file = fileWith('bom.json', String.fromCodePoint(0xfeff) + JSON.stringify([show('first-venue')]));
  const { shows, said } = choose(file);
  assert.deepEqual(shows.map((s) => s.id), ['first-venue']);
  assert.deepEqual(said, ['shows: 1 from ' + file]);
  assert.deepEqual(loadShows(file).map((s) => s.id), ['first-venue']);
});

test('a path that exists but cannot be read is unreadable, not missing', () => {
  const { shows, said } = choose(dir);
  assert.deepEqual(shows, shipped);
  assert.equal(said.length, 1, said.join('\n'));
  assert.ok(said[0].includes('cannot read ' + dir) && said[0].includes('EISDIR'), said[0]);
  assert.ok(!said[0].includes('no file at'), said[0]);
});

test('with no file named, the shipped list comes back and nothing is said', () => {
  const said = [];
  assert.deepEqual(chooseShows(undefined, bundled, (line) => said.push(line)), shipped);
  assert.deepEqual(said, []);
});

test('the relay serves the file it was given at /api/shows, and says so', async () => {
  const file = fileWith('serve.json', [show('first-venue'), show('second-venue')]);
  let relay;
  const said = await logged(async () => { relay = await createRelay({ port: 0, host: '127.0.0.1', root: dir, shows: file }); });
  try {
    assert.deepEqual(await servedBy(relay), ['first-venue', 'second-venue']);
    assert.ok(said.includes('shows: 2 from ' + file), said.join('\n'));
  } finally {
    await relay.close();
  }
});

test('a bad file at start leaves the relay with the shipped list, and says what is wrong', async () => {
  const file = fileWith('bad-serve.json', '[{"id": "Moth Club"},');
  let relay;
  const said = await logged(async () => { relay = await createRelay({ port: 0, host: '127.0.0.1', root: dir, shows: file }); });
  try {
    assert.deepEqual(await servedBy(relay), shipped.map((s) => s.id));
    assert.ok(said.some((l) => l.startsWith('shows: ') && l.includes('is not JSON')), said.join('\n'));
  } finally {
    await relay.close();
  }
});

test('the SHOWS environment variable names the file, which is what fly.toml sets, and a shows option beats it', async () => {
  const fromEnv = fileWith('from-env.json', [show('from-the-env')]);
  const fromOption = fileWith('from-option.json', [show('from-the-option')]);
  let byEnv;
  let byOption;
  process.env.SHOWS = fromEnv;
  try {
    await logged(async () => {
      byEnv = await createRelay({ port: 0, host: '127.0.0.1', root: dir });
      byOption = await createRelay({ port: 0, host: '127.0.0.1', root: dir, shows: fromOption });
    });
  } finally {
    delete process.env.SHOWS;
  }
  try {
    assert.deepEqual(await servedBy(byEnv), ['from-the-env']);
    assert.deepEqual(await servedBy(byOption), ['from-the-option']);
  } finally {
    await byEnv.close();
    await byOption.close();
  }
});

// The phone app draws a show's act, venue and times as text and its set list as a list of text (app/screens, app/lib/phase.js),
// and React cannot draw an object: one entry typed wrong in a hand-edited file would blank the app for every phone at doors.
// So an entry whose fields are the wrong kind is dropped and named, as one with a bad id is. Only `id` is required (the runbook
// says so): a field that is absent, or null, is fine.

test('an entry whose act, venue or times are not text is dropped and named, and the others stand', () => {
  const file = fileWith('wrong-kind.json', [
    { ...show('first-venue'), act: { name: 'SOMEONE' } },
    { ...show('second-venue'), venue: 5 },
    { ...show('third-venue'), doors: ['19:00'] },
    { ...show('fourth-venue'), support: true },
    { ...show('fifth-venue'), break: 2045 },
    { ...show('sixth-venue'), headline: {} },
    { ...show('seventh-venue'), end: false },
    show('kept-venue'),
  ]);
  const { shows, said } = choose(file);
  assert.deepEqual(shows.map((s) => s.id), ['kept-venue']);
  assert.deepEqual(said.slice(0, 7).map((l) => l.replace(file, 'FILE')), [
    'shows: entry 1 of FILE dropped: "act" must be text',
    'shows: entry 2 of FILE dropped: "venue" must be text',
    'shows: entry 3 of FILE dropped: "doors" must be text',
    'shows: entry 4 of FILE dropped: "support" must be text',
    'shows: entry 5 of FILE dropped: "break" must be text',
    'shows: entry 6 of FILE dropped: "headline" must be text',
    'shows: entry 7 of FILE dropped: "end" must be text',
  ]);
  assert.equal(said.at(-1), 'shows: 1 from ' + file);
  assert.deepEqual(loadShows(file).map((s) => s.id), ['kept-venue'], 'the quiet reader drops the same entries');
});

test('a set list or a list of quiet corners that is not a list of text is dropped and named', () => {
  const file = fileWith('wrong-list.json', [
    { ...show('first-venue'), setlist: 'Locked Out of Heaven' },
    { ...show('second-venue'), setlist: ['Treasure', { title: 'Grenade' }] },
    { ...show('third-venue'), spots: [1, 2, 3] },
    { ...show('fourth-venue'), spots: { bar: 'by the bar' } },
    { ...show('kept-venue'), setlist: ['Treasure', 'Grenade'], spots: ['by the bar'] },
  ]);
  const { shows, said } = choose(file);
  assert.deepEqual(shows.map((s) => s.id), ['kept-venue']);
  assert.deepEqual(said.slice(0, 4).map((l) => l.replace(file, 'FILE')), [
    'shows: entry 1 of FILE dropped: "setlist" must be a list of text',
    'shows: entry 2 of FILE dropped: "setlist" must be a list of text',
    'shows: entry 3 of FILE dropped: "spots" must be a list of text',
    'shows: entry 4 of FILE dropped: "spots" must be a list of text',
  ]);
});

test('an entry with only an id, or with null fields, stands: the app has a default for each', () => {
  const file = fileWith('sparse.json', [{ id: 'only-an-id' }, { id: 'nulls', act: null, venue: null, doors: null, setlist: null, spots: null }, { id: 'empty-lists', setlist: [], spots: [] }]);
  const { shows, said } = choose(file);
  assert.deepEqual(shows.map((s) => s.id), ['only-an-id', 'nulls', 'empty-lists']);
  assert.deepEqual(said, ['shows: 3 from ' + file]);
});

test('every show that ships with the relay is the right kind in every field', () => {
  const raw = JSON.parse(readFileSync(bundled, 'utf8'));
  assert.equal(shipped.length, raw.length, 'none of the shipped shows is dropped');
});
