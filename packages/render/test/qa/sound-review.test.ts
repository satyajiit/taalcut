// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1-R4, the sound checks after review: soundOnCuts judges only the cut each effect was placed for (a shimmer's
 * 4 s tail no longer claims the next three cuts), and hears a transition cut an effect was placed for; a hearing
 * follows the QA run's cancellation, and one started early that no run takes is stopped; an auto fix re-reports
 * the three sound checks from one new hearing; a hearing without its model parts still judges sync and audit.
 */
import {
  ok,
  RationalTime,
  type CutSyncReport,
  type HearRenderInput,
  type RenderListening,
  type SoundCritique,
  type SoundListener,
} from '@taalcut/core';
import type { MediaContext } from '@taalcut/media';
import { describe, expect, it } from 'vitest';
import type { ExportInputs } from '../../src/engine/export-inputs';
import { listeningFact } from '../../src/engine/stages/qa-facts';
import type { Signing } from '../../src/engine/stages/signing';
import { soundOnCutsCheck } from '../../src/qa/checks/sound-on-cuts';
import { rerunChecks, runQaWithFixes } from '../../src/qa/fix-loop';
import { QA_MODULES } from '../../src/qa/modules';
import type { SoundListeningFact } from '../../src/qa/modules/facts';
import { hearingOf, soundCuts } from '../../src/qa/modules/sound-listening';
import { autoFix, checkResult } from '../../src/qa/result';
import { runQa } from '../../src/qa/run-qa';
import { mergeRerun, verdictOf } from '../../src/qa/verdict';
import { clock, qaPlan, report, runInput } from './support';

const RATE = { num: 30, den: 1 };
const ms = (s: number) => RationalTime.fromSeconds(s, { num: 1000, den: 1 });
const IDS = ['soundOnCuts', 'soundClean', 'soundCritique'] as const;
const wanted = new Set(IDS);
const CUTS = [30, 60, 90, 120].map((frame, i) => ({
  frame,
  from: `clip${i}`,
  to: `clip${i + 1}`,
  beat: null,
}));
const plan = qaPlan({ durationFrames: 240, cuts: CUTS });
const module = QA_MODULES.find((m) => m.ids.includes('soundOnCuts'))!;

/** Each heard cut's status, in the order the listener was given them (missing: ok). */
function sync(statuses: readonly ('ok' | 'none' | 'off')[]): CutSyncReport {
  return {
    items: statuses.map((status, cutIndex) => ({
      cutIndex,
      at: ms(cutIndex),
      status,
      offsetMs: status === 'ok' ? 1 : status === 'off' ? 120 : null,
    })),
    cutsWithoutHit: statuses.flatMap((status, i) => (status === 'ok' ? [] : [i])),
    okShare: 0,
    nearShare: 0,
    chanceShare: 0,
    medianOffsetMs: 1,
    toleranceMs: 33.3,
  };
}

function listening(fields: Partial<RenderListening> = {}): RenderListening {
  return {
    measures: {
      duration: ms(8),
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
    cutSync: sync(['ok', 'ok', 'ok', 'ok']),
    audit: { ok: true, findings: [] },
    critique: null,
    realness: null,
    model: null,
    ...fields,
  };
}

function hearing(heard: RenderListening) {
  const asked: HearRenderInput[] = [];
  const listener: SoundListener = { hearRender: async (input) => (asked.push(input), ok(heard)) };
  return { asked, listener };
}

const fact = (listener: SoundListener, extra: Partial<SoundListeningFact> = {}): SoundListeningFact => ({
  listener,
  profile: 'launch',
  effects: [],
  ...extra,
});

describe('soundOnCuts judges the cut each effect was placed for (Q2)', () => {
  it('one shimmer on the 1 s cut, its tail over the cuts at 2, 3 and 4 s, judges the 1 s cut only', async () => {
    const shimmer = { start: 28, end: 28 + 129 };
    const { cuts, planned } = soundCuts(plan, { effects: [shimmer] });
    expect(cuts.map((cut) => cut.frame)).toEqual([30, 60, 90, 120]);
    expect([...planned]).toEqual([0]);
    // The reviewer's repro: it landed on its cut, the others are dry on purpose. 25 % (a fail) before.
    const result = soundOnCutsCheck({ cutSync: sync(['ok', 'none', 'none', 'none']), cuts, planned });
    expect(result).toMatchObject({ status: 'pass', measured: { value: 100, unit: 'percent' } });
    const { listener } = hearing(listening({ cutSync: sync(['ok', 'none', 'none', 'none']) }));
    const results = await module.run(
      {
        run: runInput('/work/r.mp4', plan),
        facts: { listening: fact(listener, { effects: [shimmer] }) },
        probed: null,
      },
      wanted,
    );
    expect(results[0]?.status).toBe('pass');
  });

  it('each effect claims its own cut: the first it covers, or the one its recorded anchor lands on', () => {
    const two = soundCuts(plan, {
      effects: [
        { start: 28, end: 87 },
        { start: 88, end: 200 },
      ],
    });
    expect([...two.planned]).toEqual([0, 2]);
    // A recorded anchor wins over coverage, within a frame; one off every cut claims none.
    expect([...soundCuts(plan, { effects: [{ start: 20, end: 140, anchor: 61 }] }).planned]).toEqual([1]);
    expect([...soundCuts(plan, { effects: [{ start: 20, end: 140, anchor: 75 }] }).planned]).toEqual([]);
    expect([...soundCuts(plan, { effects: [{ start: 125, end: 200 }] }).planned]).toEqual([]);
  });

  it('hears a transition cut an effect was placed for, and judges it, but not one without', async () => {
    const twoHard = qaPlan({ durationFrames: 240, cuts: [CUTS[0]!, CUTS[2]!] });
    const transitionCuts = [
      { frame: 60, to: 'whip-in' },
      { frame: 120, to: 'dissolve-in' },
    ];
    const whoosh = { start: 52, end: 70 };
    const { cuts, planned } = soundCuts(twoHard, { effects: [whoosh], transitionCuts });
    expect(cuts).toEqual([
      { frame: 30, to: 'clip1' },
      { frame: 60, to: 'whip-in' },
      { frame: 90, to: 'clip3' },
    ]);
    expect([...planned]).toEqual([1]);
    const { asked, listener } = hearing(listening({ cutSync: sync(['ok', 'off', 'ok']) }));
    const results = await module.run(
      {
        run: runInput('/work/r.mp4', twoHard),
        facts: { listening: fact(listener, { effects: [whoosh], transitionCuts }) },
        probed: null,
      },
      wanted,
    );
    expect(asked[0]?.cuts).toEqual([30, 60, 90].map((frame) => RationalTime.of(frame, RATE)));
    expect(results[0]).toMatchObject({ status: 'fail', measured: { value: 0 } });
    expect(results[0]?.findings).toEqual([
      {
        frames: { start: 60, end: 61 },
        target: { kind: 'clip', id: 'whip-in' },
        measured: { value: 120, unit: 'ms' },
      },
    ]);
  });
});

describe('the export’s facts (qa-facts)', () => {
  const sfxItem = (id: string, syncPoint: RationalTime | null) => ({ type: 'clip', id, syncPoint });
  const audioClip = (id: string, start: number, end: number) => ({
    id,
    track: 'A3',
    span: { start, end },
    sourceIn: ms(0),
    speed: null,
  });
  const inputs = {
    timeline: {
      tracks: [
        {
          kind: 'audio',
          id: 'A3',
          role: 'sfx',
          enabled: true,
          items: [sfxItem('fx1', null), sfxItem('fx2', ms(1.333)), sfxItem('fx3', null)],
        },
      ],
    },
    plan: {
      rate: RATE,
      audio: [audioClip('fx1', 28, 50), audioClip('fx2', 80, 200), audioClip('fx3', 52, 70)],
      transitions: [{ cut: 60, to: 'whip-in' }],
    },
    qaPlan: qaPlan({ durationFrames: 240, cuts: [CUTS[0]!, CUTS[2]!, CUTS[3]!] }),
  } as unknown as ExportInputs;
  const base = { inputs, framing: null, voiceOverMusic: null, signing: {} as Signing };

  it('names each effect’s anchor when its clip records one, the transition cuts, and starts the hearing', () => {
    const { asked, listener } = hearing(listening());
    const facts = listeningFact({ ...base, listener, file: '/work/r.mp4' })!;
    expect(facts.effects).toEqual([
      { start: 28, end: 50 },
      { start: 80, end: 200, anchor: 120 },
      { start: 52, end: 70 },
    ]);
    expect(facts.transitionCuts).toEqual([{ frame: 60, to: 'whip-in' }]);
    // fx1 on 30, fx3 on the whip at 60, fx2 on 120 (its anchor), not 90 (the first cut it covers).
    expect(asked[0]?.cuts.map((cut) => cut.value)).toEqual([30, 60, 90, 120]);
    expect([...soundCuts(inputs.qaPlan, facts).planned]).toEqual([0, 1, 3]);
  });

  it('stops a hearing no QA run took (Q6), not one a run took, and follows the export’s cancel', async () => {
    const { asked, listener } = hearing(listening());
    const dropped = listeningFact({ ...base, listener, file: '/work/r.mp4' })!;
    dropped.dropPrefetch?.();
    expect(asked[0]?.signal?.aborted).toBe(true);
    expect(dropped.prefetched?.('/work/r.mp4')).toBeUndefined();

    const taken = listeningFact({ ...base, listener, file: '/work/r.mp4' })!;
    expect(await taken.prefetched?.('/work/r.mp4')).toMatchObject({ ok: true });
    taken.dropPrefetch?.();
    expect(asked[1]?.signal?.aborted).toBe(false);

    const exportAbort = new AbortController();
    listeningFact({ ...base, listener, file: '/work/r.mp4', signal: exportAbort.signal });
    exportAbort.abort();
    expect(asked[2]?.signal?.aborted).toBe(true);
  });
});

describe('cancellation (Q6)', () => {
  it('runQa hands its signal to a fresh hearing and drops the prefetch as it returns', async () => {
    const { asked, listener } = hearing(listening());
    let drops = 0;
    const listen = fact(listener, { prefetched: () => undefined, dropPrefetch: () => void (drops += 1) });
    const signal = new AbortController().signal;
    const qa = await runQa(runInput('/work/r.mp4', plan, { only: IDS, facts: { listening: listen } }), {
      media: {} as MediaContext,
      clock,
      signal,
    });
    expect(asked).toHaveLength(1);
    expect(asked[0]?.signal).toBe(signal);
    expect(drops).toBe(1);
    // One hearing answers all three.
    expect(qa.ok && qa.value.checks.map((check) => check.id)).toEqual([...IDS]);
    expect(hearingOf(plan, listen, '/work/r.mp4', signal).signal).toBe(signal);
  });
});

describe('an auto fix re-reports the three sound checks from one new hearing (Q7)', () => {
  const heard = [
    checkResult('soundOnCuts', 'pass', {}, 0),
    checkResult('soundClean', 'fail', { fixes: [autoFix('renormaliseAudio')] }, 0),
    checkResult('soundCritique', 'warn', { fixes: [autoFix('renormaliseAudio')] }, 0),
  ];

  it('a sound check heard again brings the other two; a sound fix for another check hears again', () => {
    expect(rerunChecks(['soundClean'], report(heard), true)).toEqual([
      'soundClean',
      'soundOnCuts',
      'soundCritique',
    ]);
    expect(rerunChecks(['loudness'], report(heard), true)).toEqual(['loudness', ...IDS]);
    // A remux leaves the sound as it was; a render the listener never heard has nothing to re-report.
    expect(rerunChecks(['container'], report(heard), false)).toEqual(['container']);
    const unheard = IDS.map((id) => checkResult(id, 'skipped', {}, 0));
    expect(rerunChecks(['loudness'], report(unheard), true)).toEqual(['loudness']);
  });

  it('soundClean’s renormalise re-runs soundCritique too, so its loudness rows describe the new mix', async () => {
    const calls: (readonly string[] | undefined)[] = [];
    const result = await runQaWithFixes({
      runQa: async (only, previous) => {
        calls.push(only);
        if (!only || !previous) return ok(report(heard));
        const rerun = only.map((id) => checkResult(id, 'pass', {}, 0));
        const checks = mergeRerun(previous.checks, rerun);
        return ok({ ...previous, checks, verdict: verdictOf(checks, previous.overrides) });
      },
      applyAuto: async () => ok(undefined),
    });
    expect(calls[1]).toEqual(['soundClean', 'soundOnCuts', 'soundCritique']);
    const statuses = result.ok ? result.value.checks.map((check) => [check.id, check.status]) : [];
    expect(statuses).toEqual([
      ['soundOnCuts', 'pass'],
      ['soundClean', 'fixed'],
      ['soundCritique', 'pass'],
    ]);
  });
});

describe('a hearing without its model parts (EAR1-R1: a model that failed leaves them null)', () => {
  const partial: SoundCritique = {
    profile: 'launch',
    verdict: 'close',
    score: 0.8,
    partial: true,
    metrics: [
      { id: 'lufsI', weight: 3, value: -14, range: { min: -16, max: -9 }, status: 'ok' },
      { id: 'pReal', weight: 3, value: null, range: { min: 0.77, max: null }, status: 'na' },
    ],
    fixes: [],
  };

  it('still judges the cut sync and the audit, and skips or scores the critique on what it has', async () => {
    const run = runInput('/work/r.mp4', plan);
    const effects = [{ start: 28, end: 40 }];
    const none = hearing(listening({ critique: null, realness: null, model: null }));
    const bare = await module.run(
      { run, facts: { listening: fact(none.listener, { effects }) }, probed: null },
      wanted,
    );
    expect(bare.map((r) => r.status)).toEqual(['pass', 'pass', 'skipped']);
    expect(verdictOf(bare, [])).toBe('passed');
    const some = hearing(listening({ critique: partial, realness: null, model: null }));
    const scored = await module.run(
      { run, facts: { listening: fact(some.listener, { effects }) }, probed: null },
      wanted,
    );
    expect(scored.map((r) => r.status)).toEqual(['pass', 'pass', 'pass']);
    const worse = hearing(
      listening({ critique: { ...partial, verdict: 'not_launch_grade' }, realness: null }),
    );
    const warned = await module.run(
      { run, facts: { listening: fact(worse.listener, { effects }) }, probed: null },
      wanted,
    );
    expect(warned.map((r) => r.status)).toEqual(['pass', 'pass', 'warn']);
  });
});
