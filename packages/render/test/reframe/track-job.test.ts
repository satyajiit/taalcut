// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { describe, expect, it } from 'vitest';
import { newId, ok, SUBJECT_TRACK_JOB_KIND, type AsyncResult, type JobContext } from '@taalcut/core';
import { createSubjectTrackStore, type DerivedJsonFiles } from '../../src/reframe/subject-store';
import type { SubjectTracker } from '../../src/reframe/subject-tracker';
import { trackSubjectsJob, trackSubjectsRegistration } from '../../src/reframe/track-job';
import { sampleAt, trackOf } from './support';

const HASH = 'd'.repeat(64);
const HELPER_PID = 4545;

function context(): JobContext {
  return {
    jobId: newId<'Job'>(),
    projectId: null,
    attempt: 1,
    signal: new AbortController().signal,
    progress: () => undefined,
  };
}

function setup(letGo: 'at-reply' | 'later' | 'throws' = 'at-reply') {
  const files = new Map<string, string>();
  const io: DerivedJsonFiles = {
    read: (key) => Promise.resolve(files.get(key) ?? null),
    write: (key, body) => {
      files.set(key, body);
      return Promise.resolve(ok(undefined));
    },
  };
  const store = createSubjectTrackStore({ files: io, contentHashOf: () => Promise.resolve(ok(HASH)) });
  const assetId = newId<'Asset'>();
  const track = { ...trackOf([sampleAt(0)], 4, assetId), contentHash: HASH };
  const calls: string[] = [];
  const pending: (() => void)[] = [];
  const tracker: SubjectTracker = {
    track: (
      input,
    ): AsyncResult<{ track: typeof track; cpu: readonly ('faces' | 'humans' | 'saliency' | 'track')[] }> => {
      calls.push(input.path);
      input.onSend?.(HELPER_PID);
      if (letGo === 'throws') return Promise.reject(new Error('tracker broke'));
      if (letGo === 'at-reply') input.onLetGo?.();
      else if (input.onLetGo) pending.push(input.onLetGo);
      return Promise.resolve(ok({ track, cpu: ['saliency'] }));
    },
  };
  const events: string[] = [];
  const registration = trackSubjectsRegistration({
    tracker,
    store,
    asset: () => Promise.resolve(ok({ path: '/library/a.mov', contentHash: HASH })),
    lease: () => {
      events.push('lease');
      return Promise.resolve(
        ok({
          adopt: (pid: number) => void events.push(`adopt ${pid}`),
          release: () => Promise.resolve(void events.push('release')),
        }),
      );
    },
    onCpu: (parts) => events.push(`cpu:${parts.join(',')}`),
  });
  return { registration, track, calls, events, files, pending };
}

describe('render.trackSubjects job', () => {
  it('is a high-priority GPU job keyed by the asset and range', () => {
    expect(trackSubjectsJob.kind).toBe(SUBJECT_TRACK_JOB_KIND);
    expect(trackSubjectsJob.resource).toBe('gpu');
    expect(trackSubjectsJob.priority).toBe('high');
  });

  it('tracks under a hardware session lease, stores the track and reports CPU requests', async () => {
    const { registration, track, calls, events, files } = setup();
    const result = await registration.handler({ assetId: track.assetId, range: track.range }, context());
    expect(result.ok).toBe(true);
    expect(calls).toEqual(['/library/a.mov']);
    expect(events).toEqual(['lease', `adopt ${HELPER_PID}`, 'release', 'cpu:saliency']);
    // The track, and FRM1's index of the ranges tracked for the asset.
    expect([...files.keys()].filter((key) => !key.includes('.ranges.'))).toHaveLength(1);
  });

  it('keeps the session until the helper lets go of the request, not until the call returns (IX3-F5, H6)', async () => {
    const { registration, track, events, pending } = setup('later');
    const result = await registration.handler({ assetId: track.assetId, range: track.range }, context());
    expect(result.ok).toBe(true);
    expect(events).toEqual(['lease', `adopt ${HELPER_PID}`, 'cpu:saliency']);
    expect(pending).toHaveLength(1);
    pending[0]!();
    pending[0]!();
    await Promise.resolve();
    expect(events).toEqual(['lease', `adopt ${HELPER_PID}`, 'cpu:saliency', 'release']);
  });

  it('gives the session back when the tracker throws', async () => {
    const { registration, track, events } = setup('throws');
    await expect(
      registration.handler({ assetId: track.assetId, range: track.range }, context()),
    ).rejects.toThrow('tracker broke');
    await Promise.resolve();
    expect(events).toEqual(['lease', `adopt ${HELPER_PID}`, 'release']);
  });

  it('answers from the cache without tracking again', async () => {
    const { registration, track, calls } = setup();
    await registration.handler({ assetId: track.assetId, range: track.range }, context());
    const again = await registration.handler({ assetId: track.assetId, range: track.range }, context());
    expect(again.ok).toBe(true);
    expect(calls).toHaveLength(1);
  });
});
