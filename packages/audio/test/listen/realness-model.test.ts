// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The realness model the port reads (src/listen/realness/realness-head.json) is the vendored earshot
 * realness_model.json's heads, fusion, thresholds, prompts and facts, unchanged; and the package loads under tsx
 * (esbuild), which can't take the vendored file's `eval` key as a JSON module.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import head from '../../src/listen/realness/realness-head.json' with { type: 'json' };
import { realnessModel } from '../../src/listen/realness/model';

const vendored = JSON.parse(
  readFileSync(
    createRequire(import.meta.url).resolve('@taalcut-vendor/earshot-data/realness_model.json'),
    'utf8',
  ),
) as Record<string, unknown>;

describe('the realness model', () => {
  it('is the vendored model’s heads, fusion, thresholds, prompts and facts, unchanged', () => {
    for (const [key, value] of Object.entries(head)) expect(value, key).toEqual(vendored[key]);
    expect(Object.keys(head)).toEqual([
      'version',
      'trained',
      'long_s',
      'win_s',
      'silent_db',
      'heads',
      'fusion',
      'thresholds',
      'file_thresholds',
      'prompts',
      'facts',
    ]);
    const m = realnessModel();
    expect([m.thresholds, m.fileThresholds, m.fusion.coef]).toEqual([
      { lo: 0.17, hi: 0.77 },
      { lo: 0.4, hi: 0.77 },
      [1.212409, 0],
    ]);
    expect(m.heads.clap.coef).toHaveLength(512);
  });
});
