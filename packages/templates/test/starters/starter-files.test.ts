// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The committed starters are exactly what `starters:build` writes (P3-B3, P3-L2), files and the module that
 * bundles them: a format or hub-conversion change that would alter a starter fails here until it is rebuilt.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { bundledStartersModule, starterFiles } from '../../scripts/starter-files';
import { BUNDLED_STARTERS } from '../../src/starters/bundled-documents';

const ROOT = fileURLToPath(new URL('../../starters/', import.meta.url));
const MODULE = fileURLToPath(new URL('../../src/starters/bundled-documents.ts', import.meta.url));

describe('bundled starter files', () => {
  it('match a fresh build byte for byte, and two builds match each other', () => {
    const built = starterFiles();
    expect(starterFiles()).toEqual(built);
    expect(readdirSync(ROOT).sort()).toEqual([...built.keys()].sort());
    for (const [file, text] of built) expect(readFileSync(`${ROOT}${file}`, 'utf8'), file).toBe(text);
  });

  it('are all in the code bundle, as the files hold them', () => {
    expect(readFileSync(MODULE, 'utf8')).toBe(bundledStartersModule([...starterFiles().keys()]));
    for (const [file, text] of starterFiles()) {
      if (file === 'manifest.json') continue;
      expect(BUNDLED_STARTERS.get(file), file).toEqual(JSON.parse(text));
    }
  });
});
