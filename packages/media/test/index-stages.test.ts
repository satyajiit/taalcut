// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Media's index stages: the jobs they build from the library's view and what they hand back to store. */
import {
  derivedFileRefSchema,
  newId,
  type AssetIndexView,
  type DerivedFileRef,
  type IndexStageDefinition,
} from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createMediaIndexStages, MEDIA_SKIP, PHOTO_SHOT, storedPlan } from '@taalcut/media';
import { videoPlan } from './helpers/video-plan';

const HASH = 'cd'.repeat(32);

function ref(kind: DerivedFileRef['kind'], dir: string, ext: 'jpg' | 'json' | 'mp4' | 'bin'): DerivedFileRef {
  const mime =
    ext === 'jpg'
      ? 'image/jpeg'
      : ext === 'json'
        ? 'application/json'
        : ext === 'mp4'
          ? 'video/mp4'
          : 'application/octet-stream';
  return derivedFileRefSchema.parse({
    kind,
    key: `${dir}/cd/${HASH}.v1.${ext}`,
    bytes: 10,
    mimeType: mime,
    recipe: 1,
  });
}

function view(outputs: Record<string, unknown> = {}): AssetIndexView {
  return {
    assetId: newId<'Asset'>(),
    generation: 1,
    kind: 'video',
    path: '/footage/clip.mov',
    contentHash: HASH,
    sizeBytes: 1_000_000,
    sourceId: newId<'Source'>(),
    capturedAt: null,
    facts: null,
    derived: [],
    shots: [],
    transcript: null,
    outputs,
  };
}

const stages = createMediaIndexStages();
const byName = (name: string) => stages.find((stage) => stage.stage === name) as IndexStageDefinition;

describe('media index stages', () => {
  const plan = videoPlan();
  const normalised = { plan, facts: plan.facts };

  it('names the library SPEC stages in order, with their needs, priorities and finish lines', () => {
    expect(stages.map((s) => [s.stage, s.needs, s.priority, s.milestone])).toEqual([
      ['media.normalise', ['library.hash'], 'normal', 'searchable'],
      ['media.thumbnail', ['media.normalise'], 'normal', 'searchable'],
      ['media.proxy', ['media.normalise'], 'low', 'complete'],
      ['media.filmstrip', ['media.normalise', 'media.proxy'], 'low', 'complete'],
      ['media.previews', ['media.normalise', 'media.proxy'], 'low', 'complete'],
    ]);
    expect(byName('media.thumbnail').appliesTo).toEqual(['video', 'image', 'live_photo']);
    expect(byName('media.proxy').appliesTo).toEqual(['video', 'live_photo']);
    // A clip's frames and sound: a still has neither (its one frame is its thumbnail).
    expect(byName('media.filmstrip').appliesTo).toEqual(['video', 'live_photo']);
    expect(byName('media.previews').appliesTo).toEqual(['video', 'live_photo']);
  });

  it('says what it reads, and what normalise and the proxy store for their readers (IX3-I2)', () => {
    expect(stages.map((s) => [s.stage, s.reads])).toEqual([
      ['media.normalise', []],
      ['media.thumbnail', ['media.normalise']],
      ['media.proxy', ['media.normalise']],
      ['media.filmstrip', ['media.normalise', 'media.proxy']],
      ['media.previews', ['media.normalise', 'media.proxy']],
    ]);
    const stored = view({ 'media.normalise': normalised });
    expect(byName('media.normalise').stores?.(stored)).toEqual({ plan, facts: null, photo: null });
    expect(byName('media.normalise').stores?.(view())).toEqual({ plan: null, facts: null, photo: null });
    expect(byName('media.proxy').stores?.(view())).toBeNull();
    expect(byName('media.thumbnail').stores).toBeUndefined();
  });

  it('stores the proxy for its readers by key and shape, so a copy made again after eviction reads the same', () => {
    const file = ref('proxy', 'proxies', 'mp4');
    const proxyOutput = (bytes: number) => ({
      'media.proxy': {
        file: { ...file, bytes },
        reusedOriginal: false,
        ratio: 0.1,
        overBudget: false,
        warnings: [],
      },
    });
    const stores = byName('media.proxy').stores;
    expect(stores?.(view(proxyOutput(10)))).toEqual({
      kind: 'proxy',
      key: file.key,
      mimeType: 'video/mp4',
      recipe: 1,
    });
    expect(stores?.(view(proxyOutput(10)))).toEqual(stores?.(view(proxyOutput(12))));
  });

  it('normalises the asset by its hash and stores its facts and still', () => {
    const job = byName('media.normalise').job(view());
    expect(job).toMatchObject({
      kind: { kind: 'media.normalise' },
      input: { path: '/footage/clip.mov', contentHash: HASH, sizeBytes: 1_000_000 },
    });
    expect(byName('media.normalise').result(normalised, view())).toEqual({
      ok: true,
      value: { facts: plan.facts },
    });
    const still = ref('still', 'stills', 'jpg');
    expect(byName('media.normalise').result({ ...normalised, still }, view())).toEqual({
      ok: true,
      value: { facts: plan.facts, derived: [still] },
    });
  });

  it('gives a photo one shot of one frame, so vision analyses it like any shot', () => {
    const photo = { ...plan, kind: 'image' as const };
    expect(byName('media.normalise').result({ plan: photo, facts: plan.facts }, view())).toEqual({
      ok: true,
      value: { facts: plan.facts, shots: [PHOTO_SHOT] },
    });
  });

  it("builds the thumbnail, the filmstrip, previews and the proxy from normalise's stored plan", () => {
    const after = view({ 'media.normalise': JSON.parse(JSON.stringify(normalised)) });
    expect(storedPlan(after)).toMatchObject({ kind: 'video', frames: 60 });
    expect(byName('media.thumbnail').job(after)).toMatchObject({
      kind: { kind: 'media.makeThumbnail' },
      input: { path: '/footage/clip.mov', contentHash: HASH, plan: { kind: 'video' } },
    });
    expect(byName('media.previews').job(after)).toMatchObject({
      kind: { kind: 'media.makePreviews' },
      input: { path: '/footage/clip.mov', contentHash: HASH, plan: { kind: 'video' } },
    });
    expect(byName('media.previews').job(after)).not.toHaveProperty('input.proxyKey');
    expect(byName('media.filmstrip').job(after)).toMatchObject({
      kind: { kind: 'media.makeFilmstrip' },
      input: { path: '/footage/clip.mov', contentHash: HASH, plan: { kind: 'video' } },
    });
    expect(byName('media.proxy').job(after)).toMatchObject({
      kind: { kind: 'media.makeProxy' },
      input: { sizeBytes: 1_000_000, plan: { kind: 'video' } },
    });
  });

  it('reads the proxy for the filmstrip and previews once the proxy stage stored one (IX-D4)', () => {
    const file = ref('proxy', 'proxies', 'mp4');
    const after = view({
      'media.normalise': JSON.parse(JSON.stringify(normalised)),
      'media.proxy': { file, reusedOriginal: false, ratio: 0.1, overBudget: false, warnings: [] },
    });
    expect(byName('media.previews').needs).toEqual(['media.normalise', 'media.proxy']);
    expect(byName('media.previews').job(after)).toMatchObject({ input: { proxyKey: file.key } });
    expect(byName('media.filmstrip').job(after)).toMatchObject({ input: { proxyKey: file.key } });
    expect(byName('media.thumbnail').needs).toEqual(['media.normalise']);
    expect(byName('media.thumbnail').priority).toBe('normal');
  });

  it('skips with a reason when there is no plan to build on', () => {
    expect(byName('media.thumbnail').job(view())).toEqual({ skip: MEDIA_SKIP.noPlan });
    expect(byName('media.previews').job(view())).toEqual({ skip: MEDIA_SKIP.noPlan });
    expect(byName('media.filmstrip').job(view())).toEqual({ skip: MEDIA_SKIP.noPlan });
    expect(byName('media.proxy').job(view())).toEqual({ skip: MEDIA_SKIP.noPlan });
  });

  it('stores every preview file, and a proxy only when one was written', () => {
    const thumbnail = ref('thumbnail', 'thumbnails', 'jpg');
    const sprite = {
      ...ref('filmstrip', 'filmstrips', 'jpg'),
      key: `filmstrips/cd/${HASH}.v2.jpg`,
      recipe: 2,
    };
    const waveform = ref('waveform', 'waveforms', 'bin');
    expect(byName('media.thumbnail').result({ thumbnail }, view())).toEqual({
      ok: true,
      value: { derived: [thumbnail] },
    });
    expect(byName('media.previews').result({ waveform }, view())).toEqual({
      ok: true,
      value: { derived: [waveform] },
    });
    // A clip without sound has no waveform: nothing to store.
    expect(byName('media.previews').result({}, view())).toEqual({ ok: true, value: {} });
    const time = { value: 0, rate: { num: 30, den: 1 } };
    const strip = { file: sprite, columns: 1, rows: 1, tileWidth: 108, tileHeight: 192, times: [time] };
    expect(byName('media.filmstrip').result({ filmstrip: strip, source: 'exact' }, view())).toEqual({
      ok: true,
      value: { derived: [sprite] },
    });
    // The output is the asset detail's filmstrip: a JSON layout file or a grid too small for its frames fails.
    const json = ref('filmstrip', 'filmstrips', 'json');
    expect(() =>
      byName('media.filmstrip').result({ filmstrip: { ...strip, file: json }, source: 'exact' }, view()),
    ).toThrow();
    expect(() =>
      byName('media.filmstrip').result(
        { filmstrip: { ...strip, times: [time, time] }, source: 'exact' },
        view(),
      ),
    ).toThrow();
    const proxy = byName('media.proxy');
    expect(proxy.result({ reusedOriginal: true, ratio: 1, overBudget: false, warnings: [] }, view())).toEqual(
      {
        ok: true,
        value: {},
      },
    );
    const file = ref('proxy', 'proxies', 'mp4');
    expect(
      proxy.result({ file, reusedOriginal: false, ratio: 0.1, overBudget: false, warnings: [] }, view()),
    ).toEqual({
      ok: true,
      value: { derived: [file] },
    });
  });
});
