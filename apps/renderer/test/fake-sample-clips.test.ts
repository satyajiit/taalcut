// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The fake's sample clips (UX2) are their files: each detail parses as core's, its shots and sound match the
 * sample media, and its playback loads the file the dev and preview servers serve.
 */
import { assetDetailSchema, type AssetDetail } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createFakeBackend } from '../src/backend/fake/fake-backend';
import { createFakeMedia } from '../src/backend/fake/fake-media';
import { SAMPLE_MEDIA } from '../src/backend/fake/library/sample-media.gen';
import { SAMPLE } from '../e2e/clip-samples';

async function detailOf(assetId: string): Promise<AssetDetail> {
  const { client } = createFakeBackend({ phase2: { library: { tickMs: 0 } } });
  const detail = await client.library.asset({ assetId: assetId as AssetDetail['asset']['id'] });
  expect(assetDetailSchema.safeParse(detail).error?.issues ?? []).toEqual([]);
  return detail;
}

describe('the fake’s sample clips', () => {
  it('play their proxy file, cut where the file cuts, with its sound', async () => {
    const detail = await detailOf(SAMPLE.portrait);
    const media = createFakeMedia();
    expect(detail.playback?.source).toBe('proxy');
    expect(detail.playback && media.playback(detail.asset.id, detail.playback)).toBe('/fake-media/portrait.mp4');
    expect(detail.shots.map((shot) => shot.range.start.value)).toEqual(SAMPLE_MEDIA.portrait.shots.map(([at]) => at));
    expect(detail.shots[0]?.thumbnail && media.derived(detail.shots[0].thumbnail)).toBe('/fake-media/portrait-1.jpg');
    expect(detail.waveform?.peaks.length).toBe(SAMPLE_MEDIA.portrait.peaks.length);
    expect(detail.facts).toMatchObject({ videoCodec: 'hevc', audioCodec: 'aac', bitDepth: 10, hdr: 'hlg' });
    expect(detail.transcript?.lines).toHaveLength(3);
  });

  it('wait for models the way the PO’s two phone clips did: eight steps done (the filmstrip too), seven waiting', async () => {
    const detail = await detailOf(SAMPLE.waitingForModels);
    const waiting = detail.stages.filter((stage) => stage.state === 'waiting');
    expect(detail.stages.filter((stage) => stage.state === 'done')).toHaveLength(8);
    expect(waiting).toHaveLength(7);
    expect(waiting.filter((stage) => stage.reasonKey === 'library.stage.modelMissing')).toHaveLength(5);
    expect(detail.playback?.source).toBe('proxy');
    expect(detail.transcript).toBeNull();
  });

  it('have no playback while the copy is being made, and none of the sound before its previews', async () => {
    const detail = await detailOf(SAMPLE.preparing);
    expect(detail.playback).toBeNull();
    expect(detail.waveform).toBeNull();
    expect(detail.filmstrip).toBeNull();
    expect(detail.stages.find((stage) => stage.stage === 'media.proxy')?.state).toBe('running');
    expect(detail.stages.find((stage) => stage.stage === 'media.filmstrip')?.state).toBe('waiting');
  });

  it('draw their filmstrip from the sprite media.filmstrip made, frame by frame (round 2)', async () => {
    const detail = await detailOf(SAMPLE.portrait);
    const { strip } = SAMPLE_MEDIA.portrait;
    expect(detail.filmstrip && createFakeMedia().derived(detail.filmstrip.file)).toBe('/fake-media/portrait-strip.jpg');
    expect(detail.filmstrip).toMatchObject({ columns: strip.columns, rows: strip.rows, tileHeight: strip.tileHeight });
    expect(detail.filmstrip?.times.map((time) => time.value)).toEqual(strip.frames);
  });

  it('have no filmstrip while it is being made, or when making it failed (with the cause)', async () => {
    const making = await detailOf(SAMPLE.makingFilmstrip);
    expect(making.filmstrip).toBeNull();
    expect(making.playback?.source).toBe('proxy');
    expect(making.stages.find((stage) => stage.stage === 'media.filmstrip')?.state).toBe('running');
    expect(making.asset.index.state).toBe('indexing');
    const failed = await detailOf(SAMPLE.filmstripFailed);
    expect(failed.filmstrip).toBeNull();
    expect(failed.stages.find((stage) => stage.stage === 'media.filmstrip')).toMatchObject({
      state: 'failed',
      error: { messageKey: 'errors.media.decode_failed' },
    });
    expect(failed.asset.index.state).toBe('failed');
  });

  it('play an original that is its own proxy from the original’s address', async () => {
    const detail = await detailOf(SAMPLE.ownProxy);
    expect(detail.playback).toMatchObject({ source: 'original', width: 720, height: 1280 });
    expect(detail.playback && createFakeMedia().playback(detail.asset.id, detail.playback)).toBe(
      '/fake-media/rotated.mp4',
    );
  });

  it('say a clip without sound has none, and mark the beats of one with music', async () => {
    const silent = await detailOf(SAMPLE.silent);
    expect(silent.facts?.hasAudio).toBe(false);
    expect(silent.waveform).toBeNull();
    expect(silent.stages.filter((stage) => stage.reasonKey === 'indexing.skip.noAudio').length).toBeGreaterThan(0);
    const aerial = await detailOf(SAMPLE.landscape);
    expect(aerial.beats?.bpm).toBe(120);
    expect(aerial.asset.orientation).toBe('landscape');
  });
});
