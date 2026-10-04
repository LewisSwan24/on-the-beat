// ON THE BEAT — the night's file on disk
// (docs/superpowers/specs/2026-09-29-restart-persistence-design.md §2, §5).
//
// One file and nothing else: read it, write it whole, remove it. A write goes
// to `<path>.tmp` first, readable by its owner only, is fsynced, and is renamed
// over the file, so a write cut short leaves the last whole file. It knows
// nothing of rooms.

import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** The night's file at `path`: `read()` is its text or null, `write(text)` replaces it whole, `remove()` deletes it. */
export function openNight(path) {
  const tmp = path + '.tmp';
  return {
    path,
    read() {
      try {
        return readFileSync(path, 'utf8');
      } catch (e) {
        if (e.code === 'ENOENT') return null;
        throw e;
      }
    },
    write(text) {
      const fd = openSync(tmp, 'w', 0o600);
      try {
        writeFileSync(fd, text);
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      renameSync(tmp, path);
    },
    remove() {
      rmSync(path, { force: true });
      rmSync(tmp, { force: true });
    },
  };
}

/**
 * Tonight's clips beside the night's file: one file a clip, named by its ref, readable by its owner only. A write
 * goes to `<ref>.part` and is renamed whole, off the event loop, so a clip cut short by a stop is never read as one;
 * whatever a stop leaves half done, `names()` and `removeName()` let the next start clear. Null when the folder cannot be
 * made. It knows nothing of rooms.
 */
export function openClips(dir) {
  // Beside the night's file, never above it: a folder that is not there is not made here, and the clips stay in memory.
  try {
    mkdirSync(dir, { mode: 0o700 });
  } catch (e) {
    if (e.code !== 'EEXIST') return null;
  }
  try {
    if (!statSync(dir).isDirectory()) return null;   // a file in the folder's place
  } catch {
    return null;
  }
  const at = (ref) => join(dir, ref);
  // A clip dropped while it is still being written is removed once the write is done, not before it lands.
  const writing = new Map();   // ref -> the write, until it settles
  return {
    dir,
    write(ref, buf) {
      const done = writeFile(at(ref) + '.part', buf, { mode: 0o600 })
        .then(() => rename(at(ref) + '.part', at(ref)))
        .catch(() => rm(at(ref) + '.part', { force: true }).catch(() => {}))
        .finally(() => { if (writing.get(ref) === done) writing.delete(ref); });
      writing.set(ref, done);
    },
    read(ref) {
      try {
        return readFileSync(at(ref));
      } catch (e) {
        if (e.code === 'ENOENT') return null;
        throw e;
      }
    },
    remove(ref) {
      (writing.get(ref) ?? Promise.resolve())
        .then(() => Promise.all([rm(at(ref), { force: true }), rm(at(ref) + '.part', { force: true })]))
        .catch(() => {});
    },
    /** Every write begun so far, settled: for a stop, and for tests. */
    settled: () => Promise.all([...writing.values()]),
    /** Every name in the folder, whole clips and parts alike. */
    names: () => readdirSync(dir),
    removeName: (name) => rmSync(join(dir, name), { force: true }),
  };
}
