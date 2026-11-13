// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * NOTICE the same on a Mac and on Linux (LNX1-PKG). `pnpm licenses list` reads only what is installed, and an
 * optional binary for another OS or CPU (@esbuild/darwin-arm64 on Linux, @esbuild/linux-x64 on a Mac, fsevents) is
 * never installed, so each machine would write its own NOTICE. Instead the rows for packages this machine can't
 * install, by the lockfile's `os`, `cpu` and `libc`, are carried over from the NOTICE already there, for as long as
 * the lockfile still has that version. NOTICE is the union of each platform's packages: what ships in the macOS app
 * and in the Linux package. A version bumped on one platform only is written on that platform (CI checks both).
 */
import { compareText } from './format.mjs';

/** `{ os, cpu, libc }` of each `name@version` in the lockfile's packages that names any; the rest run anywhere. */
export function lockfileConstraints(lockText) {
  const constraints = new Map();
  let inPackages = false;
  let current;
  for (const line of lockText.split('\n')) {
    if (/^\S/.test(line)) {
      inPackages = line === 'packages:';
      current = undefined;
      continue;
    }
    if (!inPackages) continue;
    const key = /^ {2}'?([^'\s][^']*?)'?:\s*(\{\})?$/.exec(line);
    if (key) {
      current = key[1];
      continue;
    }
    const field = /^ {4}(os|cpu|libc): \[([^\]]*)\]$/.exec(line);
    if (current && field) {
      const values = field[2].split(',').map((value) => value.trim().replace(/^'|'$/g, ''));
      constraints.set(current, { ...constraints.get(current), [field[1]]: values });
    }
  }
  return constraints;
}

/** pnpm's rule for one field: a `!x` excludes x; otherwise, when any value is listed, the host's must be one. */
function allows(values, host) {
  if (!values || host === undefined) return true;
  if (values.includes(`!${host}`)) return false;
  const wanted = values.filter((value) => !value.startsWith('!'));
  return wanted.length === 0 || wanted.includes(host);
}

/** This machine, as pnpm checks it: libc only on Linux (glibc unless Node says otherwise). */
export function currentHost() {
  const glibc =
    process.platform === 'linux' ? process.report?.getReport?.()?.header?.glibcVersionRuntime : undefined;
  return {
    os: process.platform,
    cpu: process.arch,
    libc: process.platform === 'linux' ? (glibc ? 'glibc' : 'musl') : undefined,
  };
}

export function installableOn(constraint, host) {
  return (
    allows(constraint?.os, host.os) &&
    allows(constraint?.cpu, host.cpu) &&
    allows(constraint?.libc, host.libc)
  );
}

/** The approved rows and the notes of a NOTICE as renderDocument wrote it. */
function previousRows(notice) {
  const lines = notice.split('\n');
  const start = lines.indexOf('Third-party packages');
  if (start < 0) return [];
  const notes = new Map();
  const notesAt = lines.indexOf('Notes', start);
  if (notesAt >= 0)
    for (const line of lines.slice(notesAt + 1)) {
      if (line === '') continue;
      const note = /^(\S+) (\S+): (.*)$/.exec(line);
      if (!note) break;
      notes.set(`${note[1]}@${note[2]}`, note[3]);
    }
  const rows = [];
  // The title, a blank line, the headers and their rule, then one row per line until a blank line.
  for (const line of lines.slice(start + 4)) {
    if (line.trim() === '') break;
    const [name = '', version = '', license = '', homepage = ''] = line.split(/ {2,}/);
    rows.push({ name, version, license, homepage, ok: true, note: notes.get(`${name}@${version}`) ?? '' });
  }
  return rows;
}

/** Rows of `notice` for packages the lockfile has at that version and `host` can't install. */
export function carriedRows(notice, lockText, host = currentHost()) {
  const constraints = lockfileConstraints(lockText);
  return previousRows(notice).filter((row) => {
    const key = `${row.name}@${row.version}`;
    return constraints.has(key) && !installableOn(constraints.get(key), host);
  });
}

/** `rows` with the carried ones this machine didn't list itself, in NOTICE's order. */
export function withCarriedRows(rows, carried) {
  const listed = new Set(rows.map((row) => `${row.name}@${row.version}`));
  const merged = [...rows, ...carried.filter((row) => !listed.has(`${row.name}@${row.version}`))];
  return merged.sort(
    (left, right) =>
      compareText(left.name, right.name) ||
      compareText(left.version, right.version) ||
      compareText(left.license, right.license),
  );
}
