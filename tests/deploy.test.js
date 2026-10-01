// ON THE BEAT — what Fly is told (docs/superpowers/specs/2026-09-29-restart-persistence-design.md §5, §6): the
// night's file on the one volume, no snapshots, and an image that gives the volume to `node` before it runs the
// relay as `node`, and an image build that has every file the build reads. Nothing else can see these: a mistake
// here fails quietly on the machine.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const fly = readFileSync(new URL('../fly.toml', import.meta.url), 'utf8');
const docker = readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8');
const dockerignore = readFileSync(new URL('../.dockerignore', import.meta.url), 'utf8');
const viteConfig = readFileSync(new URL('../vite.config.js', import.meta.url), 'utf8');

test('fly.toml keeps the night on a volume at /data, with no snapshots', () => {
  assert.match(fly, /^\s*NIGHT_FILE = "\/data\/night\.json"$/m);
  const mounts = fly.split(/^\[mounts\]$/m)[1]?.split(/^\[/m)[0] ?? '';
  assert.match(mounts, /^\s*source = "night"$/m);
  assert.match(mounts, /^\s*destination = "\/data"$/m);
  assert.match(mounts, /^\s*scheduled_snapshots = false$/m, 'nothing of a night kept past it on Fly');
});

test('fly.toml keeps the push keys on the volume too, so a deploy keeps every device\'s notifications on', () => {
  assert.match(fly, /^\s*PUSH_KEYS_FILE = "\/data\/push-keys\.json"$/m);
});

test('fly.toml reads tonight\'s shows from the volume, so they change with a restart and not a deploy', () => {
  assert.match(fly, /^\s*SHOWS = "\/data\/shows\.json"$/m);
});

test('fly.toml holds the phone app at the framing rule until an iPhone has tried its full policy', () => {
  // The switch that lets a deploy go out without the app's policy (relay/server.js, APP_CSP). Turning the policy on is
  // this line removed or set to "full", and this test changed with it, after the iPhone try (README, "What is not done").
  assert.match(fly, /^\s*APP_CSP = "framing-only"$/m);
});

/** The first path segment of every file in this repository that `source` imports by a relative path. */
const reaches = (source) => [...new Set([...source.matchAll(/\bfrom\s+['"]\.{1,2}\/([^/'"]+)/g)].map((m) => m[1]))];

/** What of that the image build would not have: not let through by .dockerignore, or not copied into the build stage. */
function unsent(source) {
  const build = docker.split(/^FROM /m)[1];
  const escaped = (name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return reaches(source).filter((name) => !new RegExp('^!' + escaped(name) + '$', 'm').test(dockerignore)
    || !new RegExp('^COPY ' + escaped(name) + ' ', 'm').test(build));
}

test('the image build has every file of this repository that vite.config.js reads', () => {
  // vite.config.js runs in the build stage, which is sent and copies only what the two lists below name: a config that
  // imported ./scripts/... would fail the build on Fly, and nothing here would have said so.
  assert.deepEqual(unsent(viteConfig), []);
  assert.deepEqual(unsent("import { x } from './scripts/fonts.mjs';"), ['scripts'], 'a folder the build is not given is named');
  assert.deepEqual(unsent("import a from './app/x.js'; import b from './vite.config.js'; import c from '../relay/y.js';"), [], 'the ones it is given are not');
});

test('the image hands /data to node, then runs the relay as node', () => {
  const last = docker.split(/^FROM /m).at(-1);
  assert.doesNotMatch(last, /^USER /m, 'it starts as root, only to give /data over');
  assert.match(last, /^RUN setpriv --reuid=node --regid=node --init-groups id -un \| grep -qx node$/m, 'the build proves setpriv');
  assert.match(last, /^CMD \["sh", "-c", "chown node:node \/data 2>\/dev\/null; exec setpriv --reuid=node --regid=node --init-groups node relay\/server\.js"\]$/m);
});
