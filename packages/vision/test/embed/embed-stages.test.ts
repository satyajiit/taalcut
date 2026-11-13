// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The split of search vectors (IX-E1, IX-O5): `vision.embed` (frames, after
 * `vision.analyse`), `vision.embedOcr` (on-screen text, after `vision.ocr`) and
 * `vision.embedText` (transcript, after `audio.transcript`), `vision.describe`
 * after the analysis alone. Jobs are built from asset views as the library's
 * pipeline builds them.
 */
import { FrameRate, newId, RationalTime, type AssetIndexView, type ShotId } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { VISION_CONFIG, type Tier } from '../../src/config';
import { cutPairFrames, EMBED_STAGE_VERSION, framesForShot } from '../../src/jobs/embed-stages';
import { createVisionIndexStages } from '../../src/jobs/stages';

const rate = FrameRate.of(30);

function view(overrides: Partial<AssetIndexView> = {}): AssetIndexView {
  const shot = (start: number, frames: number, bestFrame: number, texts: string[]) => ({
    shotId: newId<'Shot'>() as ShotId,
    range: { start: RationalTime.of(start, rate), duration: RationalTime.of(frames, rate) },
    analysis: { bestFrame, onScreenText: texts.map((text) => ({ text })) } as never,
  });
  return {
    assetId: newId<'Asset'>(),
    generation: 1,
    kind: 'video',
    path: '/clip.mov',
    contentHash: 'ab'.repeat(32),
    sizeBytes: 1,
    sourceId: newId<'Source'>(),
    capturedAt: null,
    facts: null,
    derived: [],
    shots: [shot(0, 300, 40, ['SALE', '  ']), shot(300, 90, 10, [])],
    transcript: {
      language: 'en',
      segments: [{ text: 'hello there' }, { text: ' ' }, { text: 'see you' }],
    } as never,
    outputs: {},
    ...overrides,
  };
}

function stages(tier: () => Tier = () => 'recommended') {
  const list = createVisionIndexStages({
    get tier() {
      return tier();
    },
    ocrLanguages: () => ['en'],
    placement: () => 'local',
  });
  const byName = (name: string) => list.find((stage) => stage.stage === name)!;
  return { list, byName };
}

function jobOf(stage: ReturnType<ReturnType<typeof stages>['byName']>, asset: AssetIndexView) {
  const job = stage.job(asset);
  if ('skip' in job) throw new Error(`skipped: ${job.skip}`);
  return { kind: job.kind.kind, input: job.kind.input.parse(job.input) as Record<string, unknown> };
}

describe('vision index stages after the split', () => {
  it('runs frame vectors after the analysis, transcript vectors after the transcript, descriptions after the analysis, with text and transcript when they can come', () => {
    const { list, byName } = stages();
    expect(list.map((s) => s.stage)).toEqual([
      'vision.shots',
      'vision.analyse',
      'vision.ocr',
      'vision.embedOcr',
      'vision.embed',
      'vision.embedText',
      'vision.contactSheet',
      'vision.describe',
    ]);
    // The frame vectors wait for neither text: on-screen text has its own vectors (IX-O5).
    expect(byName('vision.embed').needs).toEqual(['vision.analyse']);
    expect(byName('vision.embed').needs).not.toContain('vision.ocr');
    expect(byName('vision.embedOcr').needs).toEqual(['vision.ocr']);
    expect(byName('vision.embedText').needs).toEqual(['audio.transcript']);
    // Descriptions read what is said and shown around each shot, never waiting on a model that is missing (LRN1-CTX).
    expect(byName('vision.describe').needs).toEqual(['vision.analyse']);
    // ...and where the clip was filmed, once it is named (LIB1-PLACE).
    expect(byName('vision.describe').optionalReads).toEqual([
      'vision.ocr',
      'audio.transcript',
      'library.place',
    ]);
    // Its own version (the embed config's), on top of what the coupling to the config's and the detector's added
    // when dependent invalidation replaced it (IX3-I3): new shots or best frames re-run it through its reads.
    expect(EMBED_STAGE_VERSION).toBe(VISION_CONFIG.embed.version + 2);
    expect(byName('vision.embed').reads).toEqual(['vision.shots', 'vision.analyse', 'media.normalise']);
    expect(byName('vision.embedText').reads).toEqual(['audio.transcript']);
    expect(byName('vision.embedOcr').reads).toEqual(['vision.ocr']);
    expect(byName('vision.embed').version).toBeGreaterThan(VISION_CONFIG.version);
    expect(byName('vision.embed').appliesTo).toEqual(['video', 'image', 'live_photo']);
    expect(byName('vision.embedText').appliesTo).toEqual(['video', 'audio', 'live_photo']);
    expect(byName('vision.embedOcr').appliesTo).toEqual(['video', 'image', 'live_photo']);
    // Search reads all three: they count toward searchable and run at normal priority (round IX, design C).
    for (const name of ['vision.embed', 'vision.embedOcr', 'vision.embedText']) {
      expect([byName(name).milestone, byName(name).priority]).toEqual(['searchable', 'normal']);
    }
  });

  it('embeds frames only, never text, and replaces only frame vectors', () => {
    const asset = view();
    const job = jobOf(stages().byName('vision.embed'), asset);
    expect(job.kind).toBe('vision.embedAsset');
    const [first, second] = asset.shots;
    expect(job.input['frames']).toEqual([
      { shotId: first!.shotId, frames: framesForShot(first!.range, 40, 'recommended') },
      { shotId: second!.shotId, frames: framesForShot(second!.range, 10, 'recommended') },
    ]);
    expect(job.input['texts']).toEqual([]);
    expect(job.input['replaces']).toEqual(['frame']);
  });

  it('embeds the on-screen text alone and replaces only on-screen text vectors', () => {
    const asset = view();
    const job = jobOf(stages().byName('vision.embedOcr'), asset);
    expect(job.kind).toBe('vision.embedTexts');
    // Blank tracks are left out; the item ids are the ones search credits to their shot.
    expect(job.input['texts']).toEqual([
      { itemId: `ocr:${asset.shots[0]!.shotId}:0`, kind: 'ocr', text: 'SALE' },
    ]);
    expect(job.input['replaces']).toEqual(['ocr']);
    expect(job.input).not.toHaveProperty('frames');
  });

  it('embeds the transcript alone and replaces only transcript vectors', () => {
    const asset = view();
    const job = jobOf(stages().byName('vision.embedText'), asset);
    expect(job.kind).toBe('vision.embedTexts');
    expect(job.input['texts']).toEqual([
      { itemId: `transcript:${asset.assetId}:0`, kind: 'transcript', text: 'hello there' },
      { itemId: `transcript:${asset.assetId}:2`, kind: 'transcript', text: 'see you' },
    ]);
    expect(job.input['replaces']).toEqual(['transcript']);
    expect(job.input).not.toHaveProperty('frames');
  });

  it('skips with a reason when there is nothing to embed', () => {
    const { byName } = stages();
    // No analysis left: the frame vectors an earlier run wrote go with the skip (IX3-I3).
    expect(byName('vision.embed').job(view({ shots: [] }))).toEqual({
      skip: 'indexing.skip.notAnalysed',
      clears: ['frame'],
    });
    // An audio file's row from before the split is reset by the version bump and has nothing left to do.
    expect(byName('vision.embed').job(view({ kind: 'audio', shots: [] }))).toEqual({
      skip: 'indexing.skip.noVideo',
    });
    // A clip that turned silent loses the transcript vectors an earlier run wrote (IX3-I3).
    expect(byName('vision.embedText').job(view({ transcript: null }))).toEqual({
      skip: 'indexing.skip.silent',
      clears: ['transcript'],
    });
    // Analysed shots that show no text (blank tracks count as none).
    const textless = view({
      shots: view().shots.map((shot) =>
        shot.analysis
          ? {
              ...shot,
              analysis: {
                ...shot.analysis,
                onScreenText: shot.analysis.onScreenText.map((t) => ({ ...t, text: ' ' })),
              },
            }
          : shot,
      ),
    });
    expect(byName('vision.embedOcr').job(textless)).toEqual({
      skip: 'indexing.skip.noText',
      clears: ['ocr'],
    });
  });

  it('reads the tier per job, so a tier probed later counts', () => {
    let tier: Tier = 'minimum';
    const embed = stages(() => tier).byName('vision.embed');
    const asset = view();
    const count = () =>
      (jobOf(embed, asset).input['frames'] as { frames: number[] }[]).reduce(
        (n, s) => n + s.frames.length,
        0,
      );
    expect(count()).toBe(2);
    tier = 'high';
    expect(count()).toBeGreaterThan(2);
  });

  it('moves frames onto the ones shot detection already embedded, so each is embedded once', () => {
    const range = { start: RationalTime.of(0, rate), duration: RationalTime.of(300, rate) };
    // 10 s on Recommended: the best frame and two extras, at 150 and 250 on their own.
    expect(framesForShot(range, 40, 'recommended')).toEqual([40, 150, 250]);
    // The pair frame two before the next cut (297) is within half a spacing of 250; 1 is too far from 150.
    expect(framesForShot(range, 40, 'recommended', [1, 297, 420])).toEqual([40, 150, 297]);
    // The best frame moves at most one frame.
    expect(framesForShot(range, 40, 'recommended', [41])[0]).toBe(41);
    expect(framesForShot(range, 40, 'recommended', [43])[0]).toBe(40);

    const asset = view({
      outputs: {
        'vision.shots': {
          frameRate: { num: 30, den: 1 },
          frameCount: 390,
          shots: [],
          cuts: [
            { frame: 300, score: 20, distance: 0.3, method: 'both' },
            { frame: 200, score: 14, method: 'scdet' },
          ],
        },
      },
    });
    expect(cutPairFrames(asset)).toEqual([298, 301]);
    expect(cutPairFrames(view({ outputs: { 'vision.shots': { nonsense: true } } }))).toEqual([]);
    const job = jobOf(stages().byName('vision.embed'), asset);
    const frames = job.input['frames'] as { frames: number[] }[];
    expect(frames[0]!.frames).toEqual(framesForShot(asset.shots[0]!.range, 40, 'recommended', [298, 301]));
    expect(frames[0]!.frames).toContain(298);
  });
});
