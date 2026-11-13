// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Clips at the edges, for the clip page's states, kept out of the generated 5,000 so the grid, search and their
 * counts stay as they are: reachable by id only (the clip page's end-to-end checks and screenshots): a 1.2 s clip
 * with no sound, in which the library found no shots, so every later stage was skipped with its reason; and an
 * ordinary clip whose first read times out, as a busy catalogue's can, so the page's error and its Try again run.
 */
import { TimeoutError, type AssetDetail, type TaalcutError } from '@taalcut/core';
import { DEFAULT_ASSET_COUNT, FIXTURE_NOW, fakeAsset, KIND, type FakeAsset, type FakeSource } from './assets';
import { fakeUlid, sceneHash } from './seed';
import { FAKE_STAGES } from './stages';

const DAY = 86_400_000;
const RATE = { num: 30, den: 1 } as const;

/** Their numbers for fakeUlid(KIND.asset, n): far past any generated clip. */
export const TINY_SILENT_CLIP = 90_001;
export const FLAKY_CLIP = 90_002;

/** The stages done before the library found nothing to look at: copied, prepared, a thumbnail made. */
const PREPARED = 3;

export function edgeClips(sources: readonly FakeSource[]): FakeAsset[] {
  const phone = sources[0];
  if (!phone) return [];
  const hash = sceneHash(4, TINY_SILENT_CLIP, 1);
  return [
    {
      summary: {
        id: fakeUlid<'Asset'>(KIND.asset, TINY_SILENT_CLIP),
        kind: 'video',
        name: 'IMG_9001.MOV',
        capturedAt: FIXTURE_NOW - 3 * DAY,
        addedAt: FIXTURE_NOW - 3 * DAY + 60_000,
        duration: { value: 36, rate: RATE },
        width: 1080,
        height: 1920,
        orientation: 'portrait',
        availability: 'online',
        sourceIds: [phone.id],
        description: null,
        quality: null,
        shotCount: 0,
        language: null,
        index: {
          state: 'done',
          done: FAKE_STAGES.length,
          total: FAKE_STAGES.length,
          searchableAt: FIXTURE_NOW - 3 * DAY + 120_000,
        },
        thumbnail: {
          kind: 'thumbnail',
          key: `thumbnails/${hash.slice(0, 2)}/${hash}.v1.jpg`,
          bytes: 14_000,
          mimeType: 'image/jpeg',
          width: 180,
          height: 320,
          recipe: 1,
        },
        reencode: 'unlikely',
        trashed: false,
        provenance: { kind: 'captured' },
      },
      extras: { n: TINY_SILENT_CLIP, scene: 4, speech: null, frameRate: RATE },
    },
    flaky(sources),
  ];
}

/** An ordinary clip (the generator's 1,264th, under its own id) for the read that fails once. */
function flaky(sources: readonly FakeSource[]): FakeAsset {
  const base = fakeAsset(1264, DEFAULT_ASSET_COUNT, sources);
  return {
    summary: { ...base.summary, id: fakeUlid<'Asset'>(KIND.asset, FLAKY_CLIP) },
    extras: { ...base.extras, n: FLAKY_CLIP },
  };
}

/** The first read of the flaky clip times out; later reads answer. One per fake library. */
export function edgeFailures(): (id: string) => TaalcutError | null {
  let failed = false;
  return (id) => {
    if (failed || id !== fakeUlid<'Asset'>(KIND.asset, FLAKY_CLIP)) return null;
    failed = true;
    return TimeoutError({ ms: 30_000 });
  };
}

/** Why each later stage was skipped for a clip with no shots and no sound (the library's reason keys). */
function skipped(stage: string): AssetDetail['stages'][number] {
  const reasonKey =
    stage === 'vision.shots'
      ? 'indexing.skip.noShots'
      : stage.startsWith('audio.') || stage === 'vision.embedText'
        ? 'indexing.skip.noAudio'
        : 'indexing.skip.notAnalysed';
  return { stage, state: 'skipped', reasonKey };
}

/**
 * The generated detail, told the truth about an edge clip: no sound, and each later stage it got through skipped
 * with its reason (while it is analysed again, the stages still to come wait as any clip's do).
 */
export function edgeDetail(detail: AssetDetail): AssetDetail {
  if (detail.asset.id !== fakeUlid<'Asset'>(KIND.asset, TINY_SILENT_CLIP)) return detail;
  return {
    ...detail,
    facts: detail.facts ? { ...detail.facts, hasAudio: false } : null,
    stages: detail.stages.map((row, index) =>
      index < PREPARED || row.state !== 'done' ? row : { ...skipped(row.stage), ...milestoneOf(row) },
    ),
  };
}

/** The finish line a stage row names, kept as it was. */
const milestoneOf = (row: AssetDetail['stages'][number]) =>
  row.milestone ? { milestone: row.milestone } : {};
