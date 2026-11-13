// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { existsSync, readdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  CI_PATHS,
  EVERY_SUITE,
  featuresOf,
  globMatches,
  LISTEN_SUITE_IDS,
  main,
  selectListenSuites,
  selectSuites,
  SUITE_IDS,
} from '../src/ci/select-suites';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** A `prefix/**` or plain glob names a path that exists; a `prefix*` glob, at least one entry of its folder. */
function globExists(glob: string): boolean {
  if (glob.endsWith('*') && !glob.endsWith('/**')) {
    const stem = basename(glob.slice(0, -1));
    return readdirSync(join(root, dirname(glob))).some((name) => name.startsWith(stem));
  }
  return existsSync(join(root, glob.endsWith('/**') ? glob.slice(0, -3) : glob));
}

describe('ci path globs', () => {
  it('points every glob at a directory or file that exists, so a rename cannot switch a suite off', () => {
    const globs = [
      ...Object.values(CI_PATHS.suites).flat(),
      ...Object.values(CI_PATHS.listening).flat(),
      ...EVERY_SUITE,
    ];
    for (const glob of globs) expect(globExists(glob), glob).toBe(true);
  });

  it('covers the code each adapter calls, not only the feature directory', () => {
    expect(selectSuites(['packages/timeline/src/model/sequence.ts'])).toEqual([
      'variants',
      'interchange',
      'cleanup',
    ]);
    expect(selectSuites(['packages/audio/src/timeline/span.ts'])).toEqual(['voice']);
    expect(selectSuites(['packages/agent/src/run-log.ts'])).toEqual(['router']);
    expect(selectSuites(['packages/core/src/timeline/schema.ts'])).toEqual([...SUITE_IDS]);
  });

  it('points P3-V2, P3-V3, P3-B6, P3-B11, P3-V5, P3-V9 and the EAR1 features at their suites', () => {
    expect(CI_PATHS.features).toEqual({
      'P3-V2': 'reframe',
      'P3-V3': 'variants',
      'P3-B6': 'voice',
      'P3-B11': 'router',
      'P3-V5': 'interchange',
      'P3-V9': 'cleanup',
      'EAR1-B2': 'listen-pick',
      'EAR1-F5': 'listen-parity',
      'EAR1-F6': 'listen-parity',
      'EAR1-A1': 'listen-parity',
      'EAR1-C1': 'listen-breakdown-hits',
      'EAR1-B3': 'listen-mood',
    });
    expect(featuresOf('listen-parity')).toEqual(['EAR1-F5', 'EAR1-F6', 'EAR1-A1']);
  });

  it('selects reframe, variants, every suite, or nothing', () => {
    expect(selectSuites(['packages/render/src/reframe/x.ts'])).toEqual(['reframe']);
    expect(selectSuites(['packages/timeline/src/variants/'])).toEqual(['variants', 'interchange', 'cleanup']);
    expect(selectSuites(['tools/evals/src/x.ts'])).toEqual([...SUITE_IDS]);
    expect(selectSuites(['apps/renderer/src/x.ts'])).toEqual([]);
  });

  it('selects the listening suites from their own paths, never in the PR loop (EAR1-I3)', () => {
    expect(selectListenSuites(['packages/audio/src/sfx/bank-source.ts'])).toEqual(['listen-pick']);
    expect(selectListenSuites(['packages/audio/src/sfx/kits/presets.ts'])).toEqual(['listen-pick']);
    expect(selectListenSuites(['packages/templates/src/breakdown/listening-stage.ts'])).toEqual([
      'listen-breakdown-hits',
    ]);
    expect(selectListenSuites(['tools/earshot-parity/fixtures/manifest.json'])).toEqual([
      'listen-parity',
      'listen-breakdown-hits',
    ]);
    expect(selectListenSuites(['third_party/earshot/data/vocab.json'])).toEqual([
      'listen-pick',
      'listen-parity',
      'listen-mood',
    ]);
    expect(selectListenSuites(['packages/audio/src/listen/dsp/key.ts'])).toEqual([...LISTEN_SUITE_IDS]);
    expect(selectListenSuites(['packages/core/src/audio/listening.ts'])).toEqual([...LISTEN_SUITE_IDS]);
    expect(selectListenSuites(['packages/audio/src/sfx/hit-plan.ts'])).toEqual([]);
    expect(selectSuites(['packages/audio/src/listen/dsp/key.ts'])).toEqual([]);
  });

  it('matches a `prefix*` glob on the names in its folder', () => {
    expect(globMatches('packages/audio/src/sfx/bank-*', 'packages/audio/src/sfx/bank-plan.ts')).toBe(true);
    expect(globMatches('packages/audio/src/sfx/bank-*', 'packages/audio/src/sfx/hit-plan.ts')).toBe(false);
    expect(globMatches('packages/audio/src/listen/**', 'packages/audio/src/listen')).toBe(true);
    expect(globMatches('packages/audio/src/listen/**', 'packages/audio/src/listener.ts')).toBe(false);
  });

  it('has a bar for every listening suite, read by the suites themselves', () => {
    expect(Object.keys(CI_PATHS.thresholds)).toEqual([...LISTEN_SUITE_IDS]);
    expect(CI_PATHS.thresholds['listen-pick']).toEqual({ top5FamilyRate: 0.85 });
    expect(CI_PATHS.thresholds['listen-breakdown-hits']).toEqual({ cutSyncAgreement: 0.9, filmsAtBar: 3 });
    expect(CI_PATHS.thresholds['listen-parity']).toMatchObject({
      tagZMaxDelta: 0.05,
      onsetMatchRate: 0.98,
      syncStatusAgreement: 1,
      bpmWithin1Rate: 0.9,
      keyAgreement: 0.85,
      realnessMaxDelta: 0.02,
      fp16TagZMaxDelta: 0.15,
      int8TagZMaxDelta: 0.3,
    });
  });

  it('prints one suite id per line and rejects a bad revision', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    expect(main(['packages/render/src/reframe/x.ts'])).toBe(0);
    expect(log.mock.calls.map((call) => call[0])).toEqual(['reframe']);
    log.mockClear();
    expect(main(['apps/renderer/src/x.ts'])).toBe(0);
    expect(log).not.toHaveBeenCalled();
    expect(main(['--listening', 'packages/templates/src/breakdown/listening-slots.ts'])).toBe(0);
    expect(log.mock.calls.map((call) => call[0])).toEqual(['listen-breakdown-hits']);
    log.mockRestore();
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(main(['--base', 'not-a-sha', '--head', 'abcd'])).toBe(1);
    error.mockRestore();
  });
});
