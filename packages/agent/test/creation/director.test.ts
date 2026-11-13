// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { err, ok, ValidationError } from '@taalcut/core';
import { describe, expect, it, vi } from 'vitest';
import { CreationOutputInvalid, validCreationScene } from '../../src/creation';
import { creationFixture } from './fixture';
import { conformCreationVoice } from '../../src/creation/voice-timing';

describe('creation director', () => {
  it('researches a script and styleframe, then waits for the exact draft approval', async () => {
    const f = creationFixture();
    const director = f.director();
    expect((await director.prepare(f.projectId)).ok).toBe(true);
    expect(f.get().status).toBe('awaiting-approval');
    expect(f.get().draft?.visualPreviewAssetId).toBe(f.assetId);
    expect(f.get().draft?.beats.reduce((sum, beat) => sum + beat.duration.value, 0)).toBe(300);
    expect(f.get().draft?.beats.every((beat) => beat.narration === '')).toBe(true);
    expect((await director.produce(f.projectId)).ok).toBe(false);
    expect(f.deps.publish).not.toHaveBeenCalled();
    f.approve();
    const produced = await director.produce(f.projectId);
    expect(produced.ok, JSON.stringify(produced)).toBe(true);
    expect(f.get().status).toBe('ready');
    expect(f.get().timelineId).toBe(f.timelineId);
    expect(f.deps.voice).not.toHaveBeenCalled();
    expect(f.deps.publish).toHaveBeenCalledOnce();
    expect(f.get().budget.reservedMicros).toBe(0);
    expect(f.get().budget.spentMicros).toBe(f.calls.length * 50);
  });

  it('admits at most five specialists plus the coordinator and reuses completed work after restart', async () => {
    const f = creationFixture({ beats: 8, voice: true });
    await f.director().prepare(f.projectId);
    f.approve();
    const resumed = await f.director().resume(f.projectId);
    expect(resumed.ok, JSON.stringify(resumed)).toBe(true);
    expect(f.peak()).toBeLessThanOrEqual(5);
    expect(f.peak()).toBeGreaterThan(1);
    expect(f.deps.voice).toHaveBeenCalledOnce();
    const count = f.calls.length;
    await f.director().resume(f.projectId);
    expect(f.calls).toHaveLength(count);
    expect(f.deps.publish).toHaveBeenCalledOnce();
  });

  it('retains a generated script when preview fails and resumes without paying for it again', async () => {
    const f = creationFixture({ failPreview: true });
    expect((await f.director().prepare(f.projectId)).ok).toBe(false);
    expect(f.get().draft).not.toBeNull();
    vi.mocked(f.deps.preview).mockResolvedValue(ok(f.assetId));
    const resumed = await f.director().resume(f.projectId);
    expect(resumed.ok, JSON.stringify(resumed)).toBe(true);
    expect(f.calls.filter((call) => call.role === 'writer')).toHaveLength(1);
  });

  it('repairs styleframe and production compiler errors within the bounded design rounds', async () => {
    const f = creationFixture();
    const invalid = ValidationError({ field: 'authoredProgram' }, { detail: 'Unsupported font-family' });
    vi.mocked(f.deps.preview).mockResolvedValueOnce(err(invalid));
    expect((await f.director().prepare(f.projectId)).ok).toBe(true);
    expect(f.deps.preview).toHaveBeenCalledTimes(2);
    f.approve();
    vi.mocked(f.deps.publish).mockResolvedValueOnce(err(invalid));
    expect((await f.director().produce(f.projectId)).ok).toBe(true);
    expect(f.deps.publish).toHaveBeenCalledTimes(2);
    expect(f.calls.some((call) => call.prompt.includes('Unsupported font-family'))).toBe(true);
    expect(f.get().budget.reservedMicros).toBe(0);
  });

  it('reserves the aggregate cap before model calls and exposes malformed output as a failure', async () => {
    const f = creationFixture({ cap: 0 });
    const result = await f.director().prepare(f.projectId);
    expect(result.ok).toBe(false);
    expect(f.calls).toHaveLength(0);
    expect(f.get().error?.code).toBe('agent.creation_budget_exceeded');
    const other = creationFixture();
    vi.mocked(other.deps.model.complete).mockResolvedValue(
      ok({ text: 'not JSON', usageMicros: 50, tokens: 1 }),
    );
    expect((await other.director().prepare(other.projectId)).ok).toBe(false);
    expect(other.get().budget.spentMicros).toBe(50);
    expect(other.get().budget.reservedMicros).toBe(0);
  });

  it('never publishes a revised draft and resumes cancelled work only on an explicit call', async () => {
    const f = creationFixture();
    const director = f.director();
    await director.prepare(f.projectId);
    f.approve();
    const previous = f.deps.model.complete;
    vi.mocked(f.deps.model.complete).mockImplementationOnce(async () => {
      f.set({ ...f.get(), draft: { ...f.get().draft!, revision: 999 }, revision: f.get().revision + 1 });
      return err(CreationOutputInvalid());
    });
    expect((await director.produce(f.projectId)).ok).toBe(false);
    expect(f.deps.publish).not.toHaveBeenCalled();
    expect(previous).toBeDefined();
    await director.cancel(f.projectId);
    expect(f.get().status).toBe('cancelled');
    const other = creationFixture();
    await other.director().cancel(other.projectId);
    expect((await other.director().resume(other.projectId)).ok).toBe(true);
    expect(other.get().status).toBe('awaiting-approval');
  });

  it('requires source and visual review and rejects nondeterministic scenes', async () => {
    const f = creationFixture();
    await f.director().prepare(f.projectId);
    f.approve();
    vi.mocked(f.deps.review).mockResolvedValue(ok({ passed: false, notes: ['Text clips outside canvas'] }));
    expect((await f.director().produce(f.projectId)).ok).toBe(false);
    expect(f.get().status).toBe('failed');
    expect(f.deps.review).toHaveBeenCalledTimes(2);
    expect(f.deps.finalize).not.toHaveBeenCalled();
    expect(
      validCreationScene({ html: '<div id="x">X</div>', css: '', animation: 'fetch("https://bad")' }),
    ).toBe(false);
    expect(validCreationScene({ html: '<canvas id="x"></canvas>', css: '', animation: '' })).toBe(false);
  });

  it('holds interrupted charges until an explicit retry and retains the conservative cost', async () => {
    const f = creationFixture();
    f.set({ ...f.get(), budget: { ...f.get().budget, reservedMicros: 100 } });
    expect((await f.director().resume(f.projectId)).ok).toBe(false);
    expect(f.get().error?.code).toBe('agent.creation_interrupted_charge');
    expect(f.calls).toHaveLength(0);
    expect(f.get().budget.reservedMicros).toBe(100);
    expect((await f.director().retry(f.projectId)).ok).toBe(true);
    expect(f.get().budget.spentMicros).toBe(100 + f.calls.length * 50);
    expect(f.get().budget.reservedMicros).toBe(0);
  });

  it('retains the reservation when a paid provider fails before reporting usage', async () => {
    const f = creationFixture();
    vi.mocked(f.deps.model.complete).mockResolvedValueOnce(err(CreationOutputInvalid()));
    expect((await f.director().prepare(f.projectId)).ok).toBe(false);
    expect(f.get().budget.reservedMicros).toBe(100);
    expect((await f.director().resume(f.projectId)).ok).toBe(false);
    expect(f.get().error?.code).toBe('agent.creation_interrupted_charge');
    expect((await f.director().retry(f.projectId)).ok).toBe(true);
    expect(f.get().budget.spentMicros).toBe(100 + f.calls.length * 50);
  });

  it('generates visual motion against continuous narration boundaries, then performs paid visual review and exports', async () => {
    const f = creationFixture({ voice: true, beats: 4 });
    await f.director().prepare(f.projectId);
    f.approve();
    const speech = {
      usageMicros: 50,
      assetIds: [f.assetId],
      lines: [
        { beatId: 'beat-0', assetId: f.assetId, sourceStartMs: 0, durationMs: 1200 },
        { beatId: 'beat-1', assetId: f.assetId, sourceStartMs: 1200, durationMs: 1300 },
        { beatId: 'beat-2', assetId: f.assetId, sourceStartMs: 2500, durationMs: 1000 },
        { beatId: 'beat-3', assetId: f.assetId, sourceStartMs: 3500, durationMs: 2000 },
      ],
    };
    vi.mocked(f.deps.voice).mockResolvedValue(ok(speech));
    vi.mocked(f.deps.review).mockResolvedValue(
      ok({ passed: true, notes: [], frameAssetIds: Array.from({ length: 25 }, () => f.assetId) }),
    );
    const conformed = conformCreationVoice(f.get().draft!, speech);
    expect(conformed.beats.map((beat) => beat.duration.value)).toEqual([36, 39, 30, 105]);
    expect((await f.director().produce(f.projectId)).ok).toBe(true);
    const production = vi.mocked(f.deps.publish).mock.calls[0]![0];
    expect(production.draft.beats.map((beat) => beat.duration.value)).toEqual([36, 39, 30, 105]);
    expect(production.masterScenes).toHaveLength(2);
    expect(production.masterScenes?.every((scene) => scene.beatId === 'master')).toBe(true);
    expect(f.calls.some((call) => call.role === 'reviewer' && call.imageAssetIds?.includes(f.assetId))).toBe(
      true,
    );
    expect(
      f.calls
        .filter((call) => call.role === 'reviewer' && call.imageAssetIds?.length)
        .map((call) => call.imageAssetIds?.length),
    ).toEqual([12, 12, 1]);
    expect(f.deps.finalize).toHaveBeenCalledOnce();
  });
});
