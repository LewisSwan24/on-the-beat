// ON THE BEAT — the capacity probe's flags it must refuse before it begins a stage (scripts/load.mjs): a clip the relay would
// not keep, a gap that cannot be drawn from, and the cgroup options that need WSL and a size. Each is a usage error and
// starts nothing, so none of these touches a relay, the network or WSL.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../scripts/load.mjs', import.meta.url));

/** Runs the rig with `args` and says how it ended; for a flag it must refuse before any stage begins. */
async function refused(args, env = {}) {
  const child = spawn(process.execPath, [script, ...args], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } });
  let out = '';
  let err = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { err += d; });
  const code = await new Promise((done) => child.on('close', done));
  return { code, out, err };
}

for (const [what, args] of [
  ['a clip bigger than the relay keeps', ['--clip-kb', '1101']], ['a negative clip size', ['--clip-kb', '-5']], ['a clip size that is not a number', ['--clip-kb', 'big']],
  ['a fractional clip size', ['--clip-kb', '37.5']], ['a gap that is not whole milliseconds', ['--clip-kb', '30', '--clip-min', '1500.5']],
  ['a gap under a second', ['--clip-kb', '30', '--clip-min', '500']], ['a longest gap that is not longer than the shortest', ['--clip-kb', '30', '--clip-min', '2000', '--clip-max', '2000']],
]) {
  test('the rig stops before a stage for ' + what, async () => {
    const { code, err, out } = await refused(['--phones', '4', ...args]);
    assert.equal(code, 2, 'a usage error');
    assert.match(err, /--clip-kb takes whole kilobytes from 0 \(no clips\) to 1100/);
    assert.ok(!out.includes('stage 1'), 'no stage was begun');
  });
}

for (const [what, args, say] of [
  ['a size that is not one', ['--cgroup-mem', 'plenty'], /--cgroup-mem takes a size such as 207M or 1G/],
  ['a size too small to start node in', ['--cgroup-mem', '8M'], /--cgroup-mem takes a size/],
  ['a cpu share it does not know', ['--cgroup-mem', '207M', '--cgroup-cpu', 'half'], /--cgroup-cpu takes baseline .* or free/],
  ['a cpu share with no memory beside it', ['--cgroup-cpu', 'free'], /--cgroup-mem takes a size.*the other cgroup flags need it/],
  ['a distro with no memory beside it', ['--wsl-distro', 'Ubuntu'], /--cgroup-mem takes a size.*the other cgroup flags need it/],
]) {
  test('the rig stops before a stage for ' + what, async () => {
    const { code, err, out } = await refused(['--phones', '4', ...args]);
    assert.equal(code, 2, 'a usage error');
    assert.match(err, say);
    assert.ok(!out.includes('stage 1'), 'no stage was begun');
  });
}
