// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { CAPTION_PRESETS, type RenderSnapshot, type Timeline } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createFakeBackend } from '../src/backend/fake/fake-backend';
import { GOLDEN_PROJECT, GOLDEN_TIMELINES } from '../src/backend/fake/make/ids';
import { variantDifference } from '../src/features/timeline/variants/variant-difference';
import { newestRender } from '../src/features/timeline/variants/variants-card-data';

async function golden(): Promise<Timeline[]> {
  const { client } = createFakeBackend({ phase2: { library: { tickMs: 0 } }, make: { renderTickMs: 0 } });
  return Promise.all(GOLDEN_TIMELINES.map((timelineId) => client.timelines.get({ timelineId })));
}

describe('what a variant differs in (P3-V3, the editor’s compare view)', () => {
  it('reads the hook, the share of other shots, the music and the caption look from the timelines', async () => {
    const [original, second] = await golden();
    const same = variantDifference(original!, original!);
    expect(same).toMatchObject({ hookChanged: false, picksChanged: 0, music: null, captionPreset: null });

    const difference = variantDifference(original!, second!);
    expect(difference.timelineId).toBe(second!.id);
    expect(difference.picksChanged).toBeGreaterThan(0);
    expect(difference.picksChanged).toBeLessThanOrEqual(1);
    expect(difference.music).toBeNull();

    expect(second!.captions).not.toBeNull();
    const base: Timeline = { ...original!, music: { path: 'platformSound' } };
    const restyled: Timeline = {
      ...second!,
      music: { path: 'platformSound' },
      captions: second!.captions && { ...second!.captions, style: CAPTION_PRESETS.bold },
    };
    expect(variantDifference(base, restyled)).toMatchObject({ music: null, captionPreset: 'bold' });
    const reference = { path: 'referenceAudio', templateId: original!.template!.id, gainDb: 0 } as const;
    expect(variantDifference(base, { ...second!, music: reference }).music).toEqual(reference);
  });

  it('the newest render of a timeline that isn’t deleted', () => {
    const at = (id: string, createdAt: number, deletedAt: number | null = null) =>
      ({
        id,
        timelineId: GOLDEN_TIMELINES[1],
        projectId: GOLDEN_PROJECT,
        createdAt,
        deletedAt,
      }) as RenderSnapshot;
    const renders = [
      at('a', 1),
      at('b', 3, 4),
      at('c', 2),
      { ...at('d', 9), timelineId: GOLDEN_TIMELINES[2]! },
    ];
    expect(newestRender(renders, GOLDEN_TIMELINES[1]!)?.id).toBe('c');
    expect(newestRender(renders, GOLDEN_TIMELINES[0]!)).toBeNull();
  });
});
