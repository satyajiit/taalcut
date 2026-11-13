// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  createContainer,
  newId,
  ok,
  RationalTime,
  SoundListenerToken,
  type JobKind,
  type JobRunner,
  type JobRunOptions,
} from '@taalcut/core';
import { EMPTY_ANALYSIS, soundAnalysisSchema } from '@taalcut/audio';
import { expect, it } from 'vitest';
import { registerSoundListener, renderListener } from '../src/utility/roots/render-listener';

// Sound decoding and QA run against real media in render-listener.test.ts. This verifies the process boundary
// without requiring a codec or spending the unit-test deadline on an unrelated encode and hearing.
it('registers a listener that sends one analysis job per hearing, as the export’s child', async () => {
  const analysis = soundAnalysisSchema.parse({
    ...EMPTY_ANALYSIS,
    measures: {
      duration: RationalTime.of(180, { num: 30, den: 1 }),
      lufs: -14,
      truePeakDbtp: -1,
      peakDbfs: -2,
      lraLu: 2,
      crestLu: 1,
      noiseFloorDbfs: -60,
      nearSilent: false,
      bandwidthHz: 16_000,
      brightnessHz: 2000,
      bands: null,
      sideToMidDb: -9,
    },
    audit: { ok: true, findings: [] },
  });
  const calls: { kind: string; input: unknown; options: JobRunOptions }[] = [];
  const runner: Pick<JobRunner, 'run'> = {
    async run<I, O>(kind: JobKind<I, O>, input: I, options: JobRunOptions = {}) {
      calls.push({ kind: kind.kind, input: kind.input.parse(input), options });
      return ok(kind.output.parse(analysis));
    },
  };
  const container = createContainer();
  try {
    registerSoundListener(container, undefined);
    expect(container.has(SoundListenerToken)).toBe(false);
    registerSoundListener(container, runner);
    const { listener } = renderListener(container);
    if (!listener) throw new Error('no listener');
    const parentJobId = newId<'Job'>();
    const file = '/render/output.mp4';
    const heard = await listener.hearRender({ file, cuts: [], profile: 'launch', parentJobId });
    expect(heard).toMatchObject({ ok: true, value: { measures: analysis.measures, audit: analysis.audit } });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      kind: 'audio.listen.analyse',
      input: { path: file, cuts: [], critique: { profile: 'launch' }, install: false, optionalModels: true },
      options: { parentJobId },
    });
  } finally {
    await container.dispose();
  }
});
