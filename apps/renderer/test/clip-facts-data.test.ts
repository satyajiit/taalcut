// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// What the clip page's facts column decides before it picks words: the frame rate, the camera's name, where it was
// filmed, what can be heard, and how far Taalcut has got (the status line's phase, counts and the step running).
import type { AssetDetail } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import {
  analysisOf,
  cameraName,
  coordinatesOf,
  framesPerSecond,
  pending,
  skipReason,
  soundOf,
} from '../src/features/library/clip/clip-facts-data';
import { CLIP_FIXTURE } from '../src/features/library/clip/clip-fixture';

const facts = CLIP_FIXTURE.facts;
if (!facts) throw new Error('the fixture has facts');

const detail = (patch: Partial<AssetDetail>, asset: Partial<AssetDetail['asset']> = {}): AssetDetail => ({
  ...CLIP_FIXTURE,
  ...patch,
  asset: { ...CLIP_FIXTURE.asset, ...asset },
});

describe('clip facts', () => {
  it('gives the frame rate to two decimals', () => {
    expect(framesPerSecond({ num: 30_000, den: 1001 })).toBe(29.97);
    expect(framesPerSecond({ num: 25, den: 1 })).toBe(25);
  });

  it('names the camera once, maker first unless the model already says it', () => {
    expect(cameraName({ make: 'Apple', model: 'iPhone 16 Pro' })).toBe('Apple iPhone 16 Pro');
    expect(cameraName({ make: 'DJI', model: 'DJI Mini 4 Pro' })).toBe('DJI Mini 4 Pro');
    expect(cameraName({ make: 'GoPro' })).toBe('GoPro');
    expect(cameraName(undefined)).toBeNull();
  });

  it('gives where it was filmed as degrees and a side', () => {
    expect(coordinatesOf({ latitude: -33.86, longitude: 151.21 })).toEqual({
      latitude: 33.86,
      longitude: 151.21,
      north: false,
      east: true,
    });
    expect(coordinatesOf(undefined)).toBeNull();
  });

  it('hears speech, sound without it, or nothing, and doesn’t guess before listening', () => {
    expect(soundOf(detail({}, { language: 'es' }))).toBe('speech');
    expect(soundOf(detail({}, { language: null }))).toBe('sound');
    expect(soundOf(detail({ facts: { ...facts, hasAudio: false } }, { language: null }))).toBe('silent');
    expect(soundOf(detail({ facts: null }, { language: null }))).toBe('unknown');
    const listening = detail(
      { stages: [{ stage: 'audio.transcript', state: 'waiting' }] },
      { language: null },
    );
    expect(soundOf(listening)).toBe('unknown');
    expect(pending(listening, 'audio.')).toBe(true);
  });

  it('says why a part is empty when its stage was skipped', () => {
    const skipped = detail({
      stages: [{ stage: 'vision.shots', state: 'skipped', reasonKey: 'indexing.skip.noShots' }],
    });
    expect(skipReason(skipped, 'vision.shots')).toBe('indexing.skip.noShots');
    expect(skipReason(CLIP_FIXTURE, 'vision.shots')).toBeNull();
  });
});

describe('how far Taalcut has got', () => {
  it('is complete when every step is done or skipped', () => {
    const analysis = analysisOf(
      detail({
        stages: [
          { stage: 'library.hash', state: 'done' },
          { stage: 'audio.transcript', state: 'skipped' },
        ],
      }),
    );
    expect(analysis).toMatchObject({ phase: 'complete', settled: 2, total: 2, now: null, failed: null });
  });

  it('is running with the step it is on, and says whether search finds it already', () => {
    const analysis = analysisOf(
      detail(
        {
          stages: [
            { stage: 'library.hash', state: 'done' },
            { stage: 'vision.describe', state: 'running' },
            { stage: 'vision.dedupe', state: 'queued' },
          ],
        },
        { index: { state: 'indexing', done: 1, total: 3, searchableAt: 5 } },
      ),
    );
    expect(analysis).toMatchObject({ phase: 'running', settled: 1, total: 3, searchable: true });
    expect(analysis.now?.stage).toBe('vision.describe');
  });

  it('waits, with the library’s reason, when nothing runs and steps are left', () => {
    const analysis = analysisOf(
      detail({
        stages: [
          { stage: 'library.hash', state: 'done' },
          { stage: 'media.normalise', state: 'waiting', reasonKey: 'library.stage.originalOffline' },
        ],
      }),
    );
    expect(analysis).toMatchObject({ phase: 'waiting', waitingFor: 'library.stage.originalOffline' });
  });

  it('waits for models when nothing runs and a step is held for one, not as if it were working (UX2)', () => {
    const analysis = analysisOf(
      detail({
        stages: [
          { stage: 'library.hash', state: 'done' },
          { stage: 'audio.language', state: 'waiting', reasonKey: 'library.stage.modelMissing' },
          { stage: 'audio.transcript', state: 'waiting' },
        ],
      }),
    );
    expect(analysis).toMatchObject({ phase: 'waitingForModels', settled: 1, total: 3, waitingFor: null });
    expect(analysis.models).toMatchObject({ speech: true, search: false });
  });

  it('waits for the on-screen text model when reading the text on screen is held (UX3-IDX)', () => {
    const analysis = analysisOf(
      detail({
        stages: [
          { stage: 'library.hash', state: 'done' },
          { stage: 'vision.ocr', state: 'waiting', reasonKey: 'library.stage.modelMissing' },
          { stage: 'vision.embedOcr', state: 'waiting' },
        ],
      }),
    );
    expect(analysis.phase).toBe('waitingForModels');
    expect(analysis.models).toMatchObject({ speech: false, text: true, search: false });
  });

  it('has failed when a step did, naming it', () => {
    const error = { code: 'media.unreadable', messageKey: 'errors.media.unreadable', retryable: false };
    const analysis = analysisOf(detail({ stages: [{ stage: 'media.normalise', state: 'failed', error }] }));
    expect(analysis.phase).toBe('failed');
    expect(analysis.failed?.stage).toBe('media.normalise');
  });

  it('falls back on the summary when the library sent no stage rows', () => {
    expect(
      analysisOf(detail({ stages: [] }, { index: { state: 'indexing', done: 4, total: 12 } })),
    ).toMatchObject({
      phase: 'running',
      settled: 4,
      total: 12,
    });
    expect(analysisOf(detail({ stages: [] }, { index: { state: 'failed', done: 3, total: 12 } })).phase).toBe(
      'failed',
    );
  });
});
