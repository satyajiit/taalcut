// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A library embedded at 280 image tokens (stage version 2) after the move to 140 (IX2-E1): the bump to stage version 3
 * re-runs `vision.embed`, which replaces each frame vector with one of a 140-token frame under the same id; the
 * transcript, on-screen text and description vectors keep theirs (their stages keep their versions, and their texts
 * embed the same way on any budget). Search finds the asset before and after. Real FFmpeg, the fake model.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDirectJobRunner, EMBEDDING_ITEM_KINDS } from '@taalcut/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { VISION_CONFIG } from '../../src/config';
import { createEmbedder } from '../../src/embed/embedder';
import { DEFAULT_EMBEDDING_PROFILE } from '../../src/embed/profile';
import { EMBEDDING_SPACE, type ImageTokenBudget } from '../../src/embed/space';
import { createEmbedStages, EMBED_STAGE_VERSION } from '../../src/jobs/embed-stages';
import { visionEmbedAssetJob } from '../../src/jobs/index-kinds';
import { createVisionJobs } from '../../src/jobs/vision-jobs';
import { fakeLoader } from '../helpers/fake-model';
import { makeReel, testMedia } from '../helpers/reel';
import { memoryVectorIndex, topHit } from '../helpers/vector-index';

const { ctx, skip } = await testMedia('budget library');

describe.skipIf(!ctx)(`frame vectors from before the 140-token budget ${skip}`, () => {
  let dir = '';
  let path = '';
  const index = memoryVectorIndex(EMBEDDING_SPACE.indexName, 768);

  function embedderAt(imageTokens: ImageTokenBudget) {
    const loader = fakeLoader();
    const embedder = createEmbedder({
      modelDir: '/m',
      loader,
      profile: { ...DEFAULT_EMBEDDING_PROFILE, imageTokens },
    });
    const jobs = createDirectJobRunner(
      createVisionJobs({ media: ctx!, tier: 'recommended', tempDir: dir, embedder, index }),
    );
    const sizes = () => loader.calls.filter((c) => c.kind === 'images').flatMap((c) => c.inputs);
    return { embedder, jobs, sizes };
  }

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'taalcut-budget-'));
    path = join(dir, 'clip.mp4');
    await makeReel(
      ctx!,
      path,
      [
        { source: 'color=c=red', frames: 20 },
        { source: 'color=c=blue', frames: 20 },
      ],
      { width: 320, height: 180, rate: '25' },
    );
  }, 120_000);
  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('bumps only vision.embed, which re-embeds frames at 140 tokens and leaves the text vectors', async () => {
    // Stage version 4: 2 was the 280-token frames (IX-E1), 3 the 140-token frames, and the shot detector's
    // version adds 1 to every shot-keyed stage (IX2-C5); the text stages keep version 1.
    expect(VISION_CONFIG.embed.version).toBe(2);
    expect(EMBED_STAGE_VERSION).toBe(4);
    const stages = createEmbedStages({ tier: 'recommended' });
    const versionOf = (name: string) => stages.find((s) => s.stage === name)?.version;
    expect([versionOf('vision.embed'), versionOf('vision.embedText')]).toEqual([4, 1]);

    // The library before: frames at 280 tokens (1056×576 for 16:9) and every text kind.
    const before = embedderAt(280);
    const first = await before.jobs.run(visionEmbedAssetJob, {
      assetId: 'a1',
      sourceId: 's1',
      path,
      frames: [
        { shotId: 'shotA', frames: [2, 10] },
        { shotId: 'shotB', frames: [30] },
      ],
      texts: [
        { itemId: 'transcript:a1:0', kind: 'transcript', text: 'hello there friends' },
        { itemId: 'ocr:shotA:0', kind: 'ocr', text: 'SALE' },
        { itemId: 'description:shotA', kind: 'description', text: 'a red wall' },
      ],
      replaces: [...EMBEDDING_ITEM_KINDS],
    });
    expect(first.ok && first.value).toMatchObject({ frames: 3, texts: 3, removed: 0 });
    expect(before.sizes()).toEqual(['1056x576', '1056x576', '1056x576']);
    const ids = [...index.rows.keys()].sort();
    const texts = new Map(
      ids.filter((id) => !id.startsWith('frame:')).map((id) => [id, index.rows.get(id)?.vector]),
    );
    const frame280 = index.rows.get('frame:shotA:0')?.vector;

    // The re-run at stage version 3, on this Mac's 140-token profile: frame vectors only, as the stage asks.
    const after = embedderAt(140);
    const rerun = await after.jobs.run(visionEmbedAssetJob, {
      assetId: 'a1',
      sourceId: 's1',
      path,
      frames: [
        { shotId: 'shotA', frames: [2, 10] },
        { shotId: 'shotB', frames: [30] },
      ],
      texts: [],
      replaces: ['frame'],
    });
    expect(rerun.ok && rerun.value).toMatchObject({ frames: 3, texts: 0, removed: 0 });
    expect(after.sizes()).toEqual(['768x384', '768x384', '768x384']);
    // The same ids; new frame vectors; the text vectors untouched.
    expect([...index.rows.keys()].sort()).toEqual(ids);
    expect(index.rows.get('frame:shotA:0')?.vector).not.toBe(frame280);
    for (const [id, vector] of texts) expect(index.rows.get(id)?.vector).toBe(vector);
    expect(await topHit(after.embedder, index, 'hello there friends', 'a1')).toBe('transcript:a1:0');
    expect(await topHit(after.embedder, index, 'a red wall', 'a1')).toBe('description:shotA');
    await before.embedder.close();
    await after.embedder.close();
  }, 120_000);
});
