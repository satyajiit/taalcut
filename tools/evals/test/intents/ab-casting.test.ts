// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The LRN1-CTX intent A/B on the casting suite: the synthetic casting library cast twice by the real timeline
 * engine, once with the four-slot template's intents as an Analyst with context writes them and once as one
 * frame alone shows them. Synthetic: it shows the harness and the direction, never gate criterion 2.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { RationalTime } from '@taalcut/core';
import { testFfmpegFor } from '@taalcut/media/test-support';
import { timelineCastingSystem } from '../../src/adapters/casting';
import { DEFAULT_CASTING_WEIGHTS } from '../../src/adapters/synthetic-casting';
import {
  CASTING_FIXTURE_LIBRARY,
  syntheticCastingCase,
  writeCastingFixtures,
} from '../../src/casting/fixtures';
import { loadCastingLibrary, type LoadedLibrary } from '../../src/casting/library';
import { loadCastingCases } from '../../src/casting/schema';
import { loadArm, type Arm } from '../../src/intents/ab-arms';
import { armCases, renderAbCastingMarkdown, runAbCasting, withIntentsOf } from '../../src/intents/ab-casting';
import { abFixtures, syntheticArms } from '../../src/intents/ab-fixtures';
import { STARTS_PROCESSES } from '../starts-processes';

const { binaries } = testFfmpegFor(inject('testFfmpeg'), 'intent A/B casting');
const dir = mkdtempSync(join(tmpdir(), 'taalcut-intents-ab-cast-'));
let written: { libraryDir: string; labelsDir: string };
let library: LoadedLibrary;

beforeAll(async () => {
  if (!binaries) return;
  written = await writeCastingFixtures(dir, binaries.ffmpeg);
  library = await loadCastingLibrary(written.libraryDir, binaries);
}, STARTS_PROCESSES.timeout);
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const fixtureArms = () => {
  const arms = syntheticArms();
  return {
    with: new Map(Object.entries(arms.with)),
    without: new Map(Object.entries(arms.without)),
  };
};

describe('swapping intents into a case template', () => {
  it("keeps the case's slots and takes each paired slot's intent", () => {
    const { with: own, without } = syntheticArms();
    const swapped = withIntentsOf(own['four-slot'], without['four-slot']);
    expect(swapped?.slots.map((slot) => slot.id)).toEqual(own['four-slot'].slots.map((slot) => slot.id));
    expect(swapped?.slots.map((slot) => RationalTime.toFrames(slot.duration))).toEqual([15, 15, 12, 10]);
    expect(swapped?.slots.map((slot) => slot.intent.text)).toEqual(
      without['four-slot'].slots.map((slot) => slot.intent.text),
    );
  });

  it('gives null when a slot pairs with nothing', () => {
    const { with: arms } = syntheticArms();
    expect(withIntentsOf(arms['four-slot'], arms['talking-tips'])).toBeNull();
  });

  it('skips a story-order case and a reel an arm lacks', () => {
    const brief = {
      ...syntheticCastingCase(),
      caseId: 'brief',
      template: { brief: { text: 'a day at the beach', formatId: 'vlog' as const, targetSeconds: 6 } },
    };
    const arms = fixtureArms();
    arms.without.delete('four-slot');
    const result = armCases({
      cases: [brief, syntheticCastingCase()],
      libraries: { [CASTING_FIXTURE_LIBRARY]: join(dir, 'unused') },
      arms,
      outDir: join(dir, 'skips'),
    });
    expect(result.cases).toEqual({ with: [], without: [] });
    expect(result.skipped.map((item) => item.reason)).toEqual([
      'a story-order case (brief): no Analyst intents',
      'no four-slot.json in the without arm',
    ]);
  });
});

describe.skipIf(!binaries)('casting with and without context-aware intents', () => {
  it('casts both arms with the same engine and scores them as synthetic', async () => {
    if (!binaries) throw new Error('intent A/B casting: no FFmpeg');
    const armsDir = abFixtures(join(dir, 'arms'));
    const outDir = join(dir, 'ab');
    const report = await runAbCasting(
      timelineCastingSystem({ libraries: {}, binaries, profiled: [library] }),
      {
        cases: loadCastingCases(written.labelsDir),
        libraries: { [CASTING_FIXTURE_LIBRARY]: written.libraryDir },
        arms: { with: loadArm(armsDir.with), without: loadArm(armsDir.without) },
        outDir,
      },
      DEFAULT_CASTING_WEIGHTS,
    );
    const pick = (arm: Arm) => report.reports[arm].scores.pickAcceptance;
    // The with-context intents name what each shot is of; the frame-only ones fit the distractors as well.
    expect(pick('with')).toBe(1);
    expect(pick('without')).toBeLessThan(pick('with'));
    expect(report.envelope).toMatchObject({
      suite: 'intents-ab-casting',
      synthetic: true,
      claimed: false,
      gate: { id: 'LRN1-CTX', pass: true },
    });
    expect(report.skipped).toEqual([]);
    const markdown = renderAbCastingMarkdown(report);
    expect(markdown).toContain('Synthetic: yes. These numbers are not a gate result.');
    expect(markdown).toContain('| with context | 1.000 |');
  });
});
