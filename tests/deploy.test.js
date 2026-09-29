// ON THE BEAT — what Fly is told (docs/superpowers/specs/2026-09-29-restart-persistence-design.md §5, §6): the
// night's file on the one volume, no snapshots, and an image that gives the volume to `node` before it runs the
// relay as `node`. Nothing else can see these: a mistake here fails quietly on the machine.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const fly = readFileSync(new URL('../fly.toml', import.meta.url), 'utf8');
const docker = readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8');

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

test('the image hands /data to node, then runs the relay as node', () => {
  const last = docker.split(/^FROM /m).at(-1);
  assert.doesNotMatch(last, /^USER /m, 'it starts as root, only to give /data over');
  assert.match(last, /^RUN setpriv --reuid=node --regid=node --init-groups id -un \| grep -qx node$/m, 'the build proves setpriv');
  assert.match(last, /^CMD \["sh", "-c", "chown node:node \/data 2>\/dev\/null; exec setpriv --reuid=node --regid=node --init-groups node relay\/server\.js"\]$/m);
});
