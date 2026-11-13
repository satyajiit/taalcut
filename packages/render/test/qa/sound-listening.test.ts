// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1-A2's sound checks on what a SoundListener heard (a fake listener here; apps/desktop's render-listener test
 * runs audio's real analysis on planted, shifted and clicking mixes): soundOnCuts judges the cuts with a planned
 * effect, soundClean counts the audit's clicks, clipping and DC outside the effects, and soundCritique only ever
 * warns. One hearing serves the three, as the export's child job.
 */
import {
  err,
  newId,
  ok,
  qaCheckResultSchema,
  RationalTime,
  type CutSyncReport,
  type HearRenderInput,
  type RenderListening,
  type SoundCritique,
  type SoundListener,
} from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { soundCleanCheck } from '../../src/qa/checks/sound-clean';
import { soundCritiqueCheck } from '../../src/qa/checks/sound-critique';
import { soundOnCutsCheck } from '../../src/qa/checks/sound-on-cuts';
import { QA_MODULES } from '../../src/qa/modules';
import type { SoundListeningFact } from '../../src/qa/modules/facts';
import { checkMeta } from '../../src/qa/result';
import { qaPlan, runInput } from './support';

const ms = (s: number) => RationalTime.fromSeconds(s, { num: 1000, den: 1 });
const CUTS = [30, 60, 90, 120].map((frame, i) => ({
  frame,
  from: `clip${i}`,
  to: `clip${i + 1}`,
  beat: null,
}));

function sync(status: 'ok' | 'off', offsetMs: number): CutSyncReport {
  return {
    items: CUTS.map((cut, cutIndex) => ({
      cutIndex,
      at: ms(cut.frame / 30),
      status,
      offsetMs,
    })),
    cutsWithoutHit: status === 'off' ? [0, 1, 2, 3] : [],
    okShare: status === 'ok' ? 1 : 0,
    nearShare: status === 'ok' ? 1 : 0,
    chanceShare: 0.1,
    medianOffsetMs: Math.abs(offsetMs),
    toleranceMs: 33.3,
  };
}

const CRITIQUE: SoundCritique = {
  profile: 'launch',
  verdict: 'needs_work',
  score: 0.62,
  partial: true,
  metrics: [
    { id: 'lufsI', weight: 3, value: -21.4, range: { min: -16, max: -9 }, status: 'low' },
    { id: 'pReal', weight: 3, value: null, range: { min: 0.77, max: null }, status: 'na' },
  ],
  fixes: [
    {
      metricId: 'lufsI',
      messageKey: 'audio.critique.fix.lufsLow',
      params: { lufs: -21.4, gainDb: 7.4, targetLufs: -14 },
    },
    {
      metricId: 'maxGapS',
      messageKey: 'audio.critique.fix.silentGap',
      params: { start: 5.5, end: 8 },
      at: ms(5.5),
    },
  ],
};

function listening(overrides: Partial<RenderListening> = {}): RenderListening {
  return {
    measures: {
      duration: ms(5),
      lufs: -14,
      truePeakDbtp: -1.2,
      peakDbfs: -1.5,
      lraLu: null,
      crestLu: null,
      noiseFloorDbfs: -60,
      nearSilent: false,
      bandwidthHz: 16_000,
      brightnessHz: 2000,
      bands: null,
      sideToMidDb: null,
    },
    events: [],
    cutSync: sync('ok', 2),
    audit: { ok: true, findings: [] },
    critique: null,
    realness: null,
    model: null,
    ...overrides,
  };
}

describe('sound checks', () => {
  it('are audio checks the person may override, run by one module', () => {
    for (const id of ['soundOnCuts', 'soundClean', 'soundCritique'] as const) {
      expect(checkMeta(id)).toMatchObject({ group: 'audio', preflight: false, overridable: true });
      expect(QA_MODULES.filter((m) => m.ids.includes(id))).toHaveLength(1);
    }
  });

  it('soundOnCuts passes planted hits and fails the same hits 120 ms late, naming each cut and its offset', () => {
    const planned = new Set([0, 1, 2, 3]);
    expect(soundOnCutsCheck({ cutSync: sync('ok', 2), cuts: CUTS, planned }).status).toBe('pass');
    const late = soundOnCutsCheck({ cutSync: sync('off', 120), cuts: CUTS, planned });
    expect(late).toMatchObject({
      status: 'fail',
      measured: { value: 0, unit: 'percent' },
      overridable: true,
    });
    expect(late.findings).toEqual(
      CUTS.map((cut) => ({
        frames: { start: cut.frame, end: cut.frame + 1 },
        target: { kind: 'clip', id: cut.to },
        measured: { value: 120, unit: 'ms' },
      })),
    );
    expect(late.fixes).toEqual([
      { kind: 'agent', instructionKey: 'qa.fixes.resyncHits', params: { cuts: 4 } },
    ]);
    // Cuts without a planned effect are not judged.
    expect(soundOnCutsCheck({ cutSync: sync('off', 120), cuts: CUTS, planned: new Set() }).status).toBe(
      'skipped',
    );
  });

  it('soundClean fails a click outside the effects, with its time in ms, and lets an effect’s own click be', () => {
    const audit = {
      ok: false,
      findings: [
        { kind: 'click' as const, severity: 'warning' as const, at: ms(1.234), detail: 'click' },
        { kind: 'click' as const, severity: 'warning' as const, at: ms(2.01), detail: 'click' },
        { kind: 'edge' as const, severity: 'warning' as const, detail: 'edge' },
        { kind: 'truncated_tail' as const, severity: 'warning' as const, detail: 'tail' },
      ],
    };
    const result = soundCleanCheck({ audit, effects: [{ start: 58, end: 64 }], fps: 30 });
    expect(result).toMatchObject({ status: 'fail', measured: { value: 1, unit: 'count' } });
    expect(result.findings).toEqual([
      {
        frames: { start: 37, end: 38 },
        target: { kind: 'audio', id: 'click' },
        measured: { value: 1234, unit: 'ms' },
      },
    ]);
    expect(result.fixes).toEqual([
      { kind: 'agent', instructionKey: 'qa.fixes.findClick', params: { atMs: 1234 } },
    ]);
    const clipped = soundCleanCheck({
      audit: { ok: false, findings: [{ kind: 'clipping', severity: 'warning', detail: 'overs' }] },
      effects: [],
      fps: 30,
    });
    expect(clipped.fixes).toEqual([{ kind: 'auto', action: 'renormaliseAudio' }]);
  });

  it('soundCritique warns and never fails, mapping loudness to renormalise and the rest to the Reviewer', () => {
    const result = soundCritiqueCheck({ critique: CRITIQUE, fps: 30 });
    expect(result).toMatchObject({
      status: 'warn',
      measured: { value: 62, unit: 'percent' },
      overridable: true,
    });
    expect(result.fixes).toEqual([
      { kind: 'auto', action: 'renormaliseAudio' },
      { kind: 'agent', instructionKey: 'audio.critique.fix.silentGap', params: { start: 5.5, end: 8 } },
    ]);
    expect(result.findings).toContainEqual({
      frames: { start: 165, end: 166 },
      target: { kind: 'audio', id: 'maxGapS' },
      measured: { value: 5500, unit: 'ms' },
    });
    for (const verdict of ['launch_grade', 'close', 'needs_work', 'not_launch_grade'] as const) {
      expect(soundCritiqueCheck({ critique: { ...CRITIQUE, verdict }, fps: 30 }).status).not.toBe('fail');
    }
    expect(soundCritiqueCheck({ critique: { ...CRITIQUE, verdict: 'close' }, fps: 30 }).status).toBe('pass');
    expect(soundCritiqueCheck({ critique: null, fps: 30 }).status).toBe('skipped');
    expect(qaCheckResultSchema.safeParse(result).success).toBe(true);
  });
});

describe('the sound module', () => {
  const plan = qaPlan({ durationFrames: 150, cuts: CUTS });
  const module = QA_MODULES.find((m) => m.ids.includes('soundOnCuts'));
  if (!module) throw new Error('no sound module');
  const wanted = new Set(['soundOnCuts', 'soundClean', 'soundCritique'] as const);

  function fact(listener: SoundListener, extra: Partial<SoundListeningFact> = {}): SoundListeningFact {
    return {
      listener,
      profile: 'launch',
      effects: [
        { start: 28, end: 34 },
        { start: 88, end: 95 },
      ],
      ...extra,
    };
  }

  it('hears the render once, as the export’s child, and judges the cuts its effects cover', async () => {
    const asked: HearRenderInput[] = [];
    const listener: SoundListener = {
      async hearRender(input) {
        asked.push(input);
        return ok(listening({ cutSync: sync('off', 120), critique: CRITIQUE }));
      },
    };
    const parentJobId = newId<'Job'>();
    const results = await module.run(
      {
        run: runInput('/work/render.mp4', plan),
        facts: { listening: fact(listener, { parentJobId }) },
        probed: null,
      },
      wanted,
    );
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({
      file: '/work/render.mp4',
      profile: 'launch',
      parentJobId,
      frameRate: { num: 30, den: 1 },
      cuts: CUTS.map((cut) => RationalTime.of(cut.frame, { num: 30, den: 1 })),
    });
    expect(results.map((r) => [r.id, r.status])).toEqual([
      ['soundOnCuts', 'fail'],
      ['soundClean', 'pass'],
      ['soundCritique', 'warn'],
    ]);
    // Only the two cuts an effect covers (frames 30 and 90) are named.
    expect(results[0]?.findings.map((f) => f.frames?.start)).toEqual([30, 90]);
  });

  it('warns that the sound wasn’t heard when the listening fails, and skips without a listener or sound', async () => {
    const failing: SoundListener = {
      hearRender: async () =>
        err({ code: 'audio.listen_failed', messageKey: 'errors.audio.listen_failed', retryable: true }),
    };
    const results = await module.run(
      { run: runInput('/work/render.mp4', plan), facts: { listening: fact(failing) }, probed: null },
      wanted,
    );
    expect(results.map((r) => r.status)).toEqual(['warn', 'warn', 'skipped']);
    const none = await module.run({ run: runInput('/work/r.mp4', plan), facts: {}, probed: null }, wanted);
    expect(none.map((r) => r.status)).toEqual(['skipped', 'skipped', 'skipped']);
    const silent = qaPlan({ cuts: CUTS, audio: { ...plan.audio, silent: true } });
    const quiet = await module.run(
      { run: runInput('/work/r.mp4', silent), facts: { listening: fact(failing) }, probed: null },
      wanted,
    );
    expect(quiet.map((r) => r.status)).toEqual(['skipped', 'skipped', 'skipped']);
  });

  it('uses the hearing started when the file was finished once, then hears the file again', async () => {
    let asked = 0;
    const listener: SoundListener = {
      async hearRender() {
        asked += 1;
        return ok(listening());
      },
    };
    let pending: ReturnType<SoundListener['hearRender']> | undefined = Promise.resolve(
      ok(listening({ cutSync: sync('off', 120) })),
    );
    const prefetched = (file: string) => {
      const taken = file === '/work/render.mp4' ? pending : undefined;
      pending = undefined;
      return taken;
    };
    const input = {
      run: runInput('/work/render.mp4', plan),
      facts: { listening: { ...fact(listener), prefetched } },
      probed: null,
    };
    const first = await module.run(input, wanted);
    expect([asked, first[0]?.status]).toEqual([0, 'fail']);
    const again = await module.run(input, wanted);
    expect([asked, again[0]?.status]).toEqual([1, 'pass']);
  });
});
