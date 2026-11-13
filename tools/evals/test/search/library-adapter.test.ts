// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The library.search adapter on the synthetic fixture with a stand-in for
 * EmbeddingGemma 2 and no OCR: every clip is indexed through vision's stages,
 * hits come back as manifest paths with frame ranges, filters reach the SQL.
 * Decoding is the app's: the decode switch unset, the analysis pass and the
 * frame reads go through the mac helper where it is built (IX2-F14, IX3-R2).
 * The live numbers (real model, Apple Vision) come from `predict:search`.
 * A library where a stage failed answers nothing and no prediction is written
 * (IX2-F1).
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipelineTimings } from '@taalcut/library';
import { createSidecarResolver, type SidecarResolver } from '@taalcut/media';
import { testFfmpegFor } from '@taalcut/media/test-support';
import type { EmbeddingModelLoader } from '@taalcut/vision';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { libraryFilters, librarySearchSystem, type LibrarySearchSession } from '../../src/adapters/search';
import { bundledFfmpeg } from '../../src/ffmpeg-bin';
import {
  SEARCH_FIXTURE_LIBRARY,
  syntheticSearchQueries,
  writeSearchFixtures,
} from '../../src/search/fixtures';
import { predictSearch } from '../../src/search/run';

const bins = bundledFfmpeg();
// The run's FFmpeg, checked once before any file started (media's test-support-ffmpeg.ts): the sessions index
// with it instead of checking again.
const { binaries } = testFfmpegFor(inject('testFfmpeg'), 'library search adapter');

/** Words hash into a bag of words, frames into their mean colour: deterministic, no weights. */
const standIn: EmbeddingModelLoader = async (_dir, device) => {
  const vector = (seed: (v: Float32Array) => void) => {
    const v = new Float32Array(768);
    seed(v);
    v[0] = 0.01;
    return v;
  };
  return {
    device,
    embedTexts: async (texts) =>
      texts.map((text) =>
        vector((v) => {
          for (const word of text.toLowerCase().split(/\W+/).filter(Boolean)) {
            let h = 2166136261;
            for (const ch of word) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
            v[8 + (Math.abs(h) % 700)]! += 1;
          }
        }),
      ),
    embedImages: async (images) =>
      images.map((image) =>
        vector((v) => {
          let sum = 0;
          for (const byte of image.rgb) sum += byte;
          v[1] = sum / image.rgb.length / 255 + 0.01;
        }),
      ),
    dispose: async () => {},
  };
};

describe('librarySearchSystem', () => {
  it('maps the eval filters onto the library’s', () => {
    expect(libraryFilters(undefined)).toBeUndefined();
    expect(
      libraryFilters({
        orientation: 'portrait',
        minQuality: 0.5,
        capturedAfter: '2026-01-15',
        capturedBefore: '2026-01-16',
      }),
    ).toEqual({
      orientations: ['portrait'],
      minQuality: 0.5,
      capturedFrom: Date.UTC(2026, 0, 15),
      capturedTo: Date.UTC(2026, 0, 16) - 1,
    });
  });
});

describe.skipIf(bins === undefined)('librarySearchSystem on the synthetic library', () => {
  let dir: string;
  let session: LibrarySearchSession;
  /** The mac helper as this run finds it: looked up once, for the session and for what the test expects. */
  let helper: Awaited<ReturnType<SidecarResolver['resolve']>>;
  const query = syntheticSearchQueries()[0]!;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'taalcut-search-adapter-'));
    const written = await writeSearchFixtures(join(dir, 'fixtures'), bins!.ffmpeg);
    // The lookup the session would make itself (search/eval-decode.ts), made once. Looked up twice, a build of the
    // helper in between (build.sh replaces dist/taalcut-mac-helper) gave the session no helper and the test one
    // (UX2 round 2: decodeTasks [] against ['pass', 'frames'] while the hosting lane rebuilt it).
    helper = await createSidecarResolver({
      name: 'taalcut-mac-helper',
      development: true,
      pin: '',
      env: process.env,
    }).resolve();
    session = librarySearchSystem({
      libraryDir: written.libraryDir,
      ocr: false,
      loader: standIn,
      modelDir: '/stand-in',
      // The decode switch unset: the app's default (IX2-F14, IX3-R2).
      decode: { env: {}, resolver: { resolve: async () => helper } },
      ...(binaries ? { binaries } : {}),
      log: () => {},
    });
  }, 120_000);

  afterAll(async () => {
    await session?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('indexes every clip through vision’s stages and stores neutral file names', async () => {
    const index = await session.index();
    expect(index.failures).toEqual([]);
    expect(index.pathOf.size).toBe(12);
    const stages = pipelineTimings(index.db, 0).stages.map((s) => [s.stage, s.runs]);
    // Without the mac helper vision.ocr reads nothing, so vision.embedOcr skips (no text) and has no done rows.
    expect(stages).toEqual([
      ['vision.analyse', 12],
      ['vision.embed', 12],
      ['vision.ocr', 12],
      ['vision.shots', 12],
    ]);
    const names = index.db.driver.prepare('SELECT original_filename AS name FROM assets ORDER BY name').all();
    expect(names[0]?.name).toBe('clip-001.mkv');
    expect(index.vectors.count()).toBeGreaterThanOrEqual(12);
    // Decoded as the app decodes: the pass and the frame reads through the mac helper where it is built (IX3-R2).
    expect(index.decodeTasks).toEqual(helper.ok ? ['pass', 'frames'] : []);
  }, 120_000);

  it('answers with manifest paths and frame ranges, and applies filters', async () => {
    const hits = await session.search(query, 5);
    expect(hits.length).toBeGreaterThan(0);
    for (const hit of hits) {
      expect(hit.asset).toMatch(/^clips\/.+\.mkv$/);
      expect(hit.range).toEqual({ startFrame: 0, endFrame: 5 });
    }
    expect(await session.search({ ...query, filters: { orientation: 'portrait' } }, 5)).toEqual([]);
    expect(await session.search({ ...query, filters: { capturedBefore: '2026-01-15' } }, 5)).toEqual([]);
    expect(await session.search({ ...query, filters: { minFrames: 6 } }, 5)).toEqual([]);
    expect((await session.search({ ...query, filters: { capturedAfter: '2026-01-15' } }, 5)).length).toBe(
      hits.length,
    );
    await expect(session.search({ ...query, library: 'another' }, 5)).rejects.toThrow(/asks library another/);
  }, 120_000);
});

describe.skipIf(bins === undefined)('librarySearchSystem when an index stage fails', () => {
  let dir: string;
  let labelsDir: string;
  let session: LibrarySearchSession;
  /** The stand-in, except that frames won't embed: vision.embed fails with a Result, not a throw. */
  const framesFail: EmbeddingModelLoader = async (modelDir, device, options) => ({
    ...(await standIn(modelDir, device, options)),
    embedImages: async () => {
      throw new Error('stand-in: no frame vectors');
    },
  });

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'taalcut-search-failed-'));
    const written = await writeSearchFixtures(join(dir, 'fixtures'), bins!.ffmpeg);
    labelsDir = written.labelsDir;
    // One clip of the fixture library is enough to fail a stage.
    const one = join(dir, 'one');
    mkdirSync(join(one, 'clips'), { recursive: true });
    copyFileSync(join(written.libraryDir, 'clips/en-market.mkv'), join(one, 'clips/en-market.mkv'));
    writeFileSync(
      join(one, 'manifest.json'),
      JSON.stringify({
        library: SEARCH_FIXTURE_LIBRARY,
        synthetic: true,
        clips: [{ asset: 'clips/en-market.mkv' }],
      }),
    );
    session = librarySearchSystem({
      libraryDir: one,
      ocr: false,
      loader: framesFail,
      modelDir: '/stand-in',
      shotModelDir: join(dir, 'no-shot-model'),
      ...(binaries ? { binaries } : {}),
      log: () => {},
    });
  }, 120_000);

  afterAll(async () => {
    await session?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('refuses the library, naming the failed stage, and writes no prediction', async () => {
    await expect(session.index()).rejects.toThrow(
      /failed, so no query is scored: vision\.\w+ clips\/en-market\.mkv: /,
    );
    const out = join(dir, 'predictions');
    await expect(predictSearch(session, labelsDir, out)).rejects.toThrow(/no query is scored/);
    expect(existsSync(out) ? readdirSync(out) : []).toEqual([]);
  }, 120_000);
});
