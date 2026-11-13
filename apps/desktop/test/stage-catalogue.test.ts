// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Every progress stage key a package's job can send (`jobs.stage.*`) and
 * every indexing reason (`indexing.skip.*`, `library.stage.*`) has words in
 * the renderer's catalogue, so no job shows a bare key or "Working" where it
 * could say what it does. The keys are read from the packages' sources, so a
 * new stage without words fails here.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const repo = join(import.meta.dirname, '..', '..', '..');
const KEY = /'((?:jobs\.stage|indexing\.skip|library\.stage)\.[a-zA-Z.]+)'/g;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return name.endsWith('.ts') ? [path] : [];
  });
}

function keysInPackages(): Set<string> {
  const keys = new Set<string>();
  for (const pkg of readdirSync(join(repo, 'packages'))) {
    const src = join(repo, 'packages', pkg, 'src');
    try {
      statSync(src);
    } catch {
      continue;
    }
    for (const file of sources(src))
      for (const [, key] of readFileSync(file, 'utf8').matchAll(KEY)) keys.add(key!);
  }
  return keys;
}

/** msgid → msgstr of the English catalogue. */
function catalogue(): Map<string, string> {
  const po = readFileSync(join(repo, 'apps', 'renderer', 'src', 'locales', 'en', 'messages.po'), 'utf8');
  const entries = new Map<string, string>();
  for (const [, id, text] of po.matchAll(/^msgid "(.*)"\nmsgstr "(.*)"$/gm)) entries.set(id!, text!);
  return entries;
}

// It reads every package's sources from disk, which takes several seconds on a busy Mac (the on-access scanner):
// a minute, not vitest's 5 s default.
describe('job stage and indexing reason words', { timeout: 60_000 }, () => {
  it('exist in the renderer catalogue for every key the packages send', () => {
    const keys = keysInPackages();
    // The pipeline's own reasons and the ones the stages give are among them.
    expect([...keys]).toEqual(
      expect.arrayContaining([
        'indexing.skip.noShots',
        'library.stage.originalOffline',
        'jobs.stage.transcribing',
      ]),
    );
    const words = catalogue();
    const missing = [...keys].filter((key) => !words.get(key));
    expect(missing).toEqual([]);
  });

  it('cover the audio reasons the indexing stages give', () => {
    const words = catalogue();
    for (const key of ['indexing.skip.noAudio', 'indexing.skip.silent', 'indexing.skip.noVideo'])
      expect(words.get(key), key).toBeTruthy();
  });
});
