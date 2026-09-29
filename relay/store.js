// ON THE BEAT — the night's file on disk
// (docs/superpowers/specs/2026-09-29-restart-persistence-design.md §2, §5).
//
// One file and nothing else: read it, write it whole, remove it. A write goes
// to `<path>.tmp` first, readable by its owner only, is fsynced, and is renamed
// over the file, so a write cut short leaves the last whole file. It knows
// nothing of rooms.

import { closeSync, fsyncSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';

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
