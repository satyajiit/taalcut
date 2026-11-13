// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Upstream's hash-locked requirement files (bundle/requirements/*.txt, uv's `pip compile --generate-hashes` format),
 * read into entries: pack.mjs checks each hosted source distribution's sha256 is one the lock names for it.
 */

/** PEP 503 normalised name. */
export function normaliseName(name) {
  return name.toLowerCase().replace(/[-_.]+/g, '-');
}

/**
 * The entries of one lock file: { name, version, marker, hashes, text }. `text` is the requirement with its hashes
 * as one line; comments and `# via` lines are dropped. Throws on a pinned line without hashes.
 */
export function parseLock(text) {
  const logical = [];
  let current = '';
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\s+#.*$/, '').trimEnd();
    if (line.trimStart().startsWith('#') || line.trim() === '') {
      if (current) logical.push(current);
      current = '';
      continue;
    }
    current += line.endsWith('\\') ? `${line.slice(0, -1).trim()} ` : line.trim();
    if (!line.endsWith('\\')) {
      logical.push(current);
      current = '';
    }
  }
  if (current) logical.push(current);
  const entries = [];
  for (const entry of logical) {
    const match =
      /^([A-Za-z0-9][A-Za-z0-9._-]*)==([^\s;]+)\s*(?:;\s*([^-][^]*?))?\s*((?:--hash=sha256:[0-9a-f]{64}\s*)*)$/.exec(
        entry.trim(),
      );
    if (!match) throw new Error(`not a pinned, hashed requirement: ${entry.slice(0, 120)}`);
    const [, name, version, marker, hashText] = match;
    const hashes = [...hashText.matchAll(/--hash=sha256:([0-9a-f]{64})/g)].map((m) => m[1]);
    if (hashes.length === 0) throw new Error(`${name}==${version} has no hashes`);
    entries.push({
      name: normaliseName(name),
      version,
      marker: marker?.trim() || undefined,
      hashes,
      text: `${name}==${version}${marker ? ` ; ${marker.trim()}` : ''} ${hashes.map((h) => `--hash=sha256:${h}`).join(' ')}`,
    });
  }
  return entries;
}
