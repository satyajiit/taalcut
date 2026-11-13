// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * UX2: media.filmstrip on real files, as the library's pipeline runs it. A clip goes through media.normalise and
 * media.proxy (the service, into a real cache), then the filmstrip stage builds its job from what those stored, the
 * service makes the sprite and the stage hands back the file to store. Every frame of the fixture is a white bar on
 * black that has grown across the width by its frame number (an edge survives the proxy's encode where a faint grey
 * step would not), so a cell of the sprite says which moment it shows: each is the frame at its time, or the proxy
 * keyframe at most half a second before it (IX2-T3). A clip small and plain enough to be its own proxy reads its
 * original's exact frames instead.
 */
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  filmstripSchema,
  ok,
  RationalTime,
  newId,
  unwrap,
  type AssetIndexView,
  type Filmstrip,
  type IndexStageDefinition,
  type IndexStageJob,
} from '@taalcut/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createDerivedCache,
  createMediaIndexStages,
  createMediaService,
  mediaMakeFilmstripJob,
  mediaMakeProxyJob,
  mediaNormaliseJob,
  runProcess,
  type MediaContext,
  type MediaService,
  type ResolvedFfmpeg,
} from '@taalcut/media';
import { findTestBinaries } from '../helpers/binaries';
import { h264Encoder, renderClip } from '../helpers/clip';
import { greyClipArgs } from '../helpers/keyframe-clips';

const found = await findTestBinaries('filmstrip stage');

const FPS = 30;
/** Frame N of `frames`: white where x is under N / frames of the width, black after. */
const bar = (frames: number) => `if(lt(X,W*N/${frames}),235,16)`;

const stages = createMediaIndexStages();
const stage = (name: string) => stages.find((s) => s.stage === name) as IndexStageDefinition;

/** FFmpeg, which the suite skips without. */
function binaries(): ResolvedFfmpeg {
  if (!found.binaries) throw new Error('no FFmpeg');
  return found.binaries;
}
const context = (): MediaContext => ({ binaries: binaries() });

interface Run {
  readonly input: unknown;
  readonly filmstrip: Filmstrip;
  readonly source: string;
  readonly derived: unknown;
}

/** The job a stage builds, failing the test when it skips. */
function jobOf(name: string, asset: AssetIndexView): IndexStageJob {
  const job = stage(name).job(asset);
  if ('skip' in job) throw new Error(`${name} skipped: ${job.skip}`);
  return job;
}

describe.skipIf(!found.binaries)('the filmstrip stage', { timeout: 240_000 }, () => {
  let dir: string;
  let media: MediaService;
  let cacheRoot: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'taalcut-filmstrip-stage-'));
    cacheRoot = join(dir, 'cache');
    const resolved = binaries();
    media = createMediaService({
      resolver: { resolve: async () => ok(resolved) },
      cache: createDerivedCache({ root: cacheRoot, capBytes: 2_000_000_000 }),
    });
  });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  function view(path: string, contentHash: string, sizeBytes: number, outputs: Record<string, unknown>) {
    const asset: AssetIndexView = {
      assetId: newId<'Asset'>(),
      generation: 1,
      kind: 'video',
      path,
      contentHash,
      sizeBytes,
      sourceId: newId<'Source'>(),
      capturedAt: null,
      facts: null,
      derived: [],
      shots: [],
      transcript: null,
      outputs,
    };
    return asset;
  }

  /** normalise, proxy and filmstrip in pipeline order, each job built by its stage from what the last stored. */
  async function index(path: string, contentHash: string): Promise<Run> {
    const { size } = await stat(path);
    const outputs: Record<string, unknown> = {};
    const asset = () => view(path, contentHash, size, outputs);
    const keep = (name: string, value: unknown) => (outputs[name] = JSON.parse(JSON.stringify(value)));
    const normalise = jobOf('media.normalise', asset());
    keep('media.normalise', unwrap(await media.normalise(mediaNormaliseJob.input.parse(normalise.input))));
    const proxy = jobOf('media.proxy', asset());
    keep('media.proxy', unwrap(await media.makeProxy(mediaMakeProxyJob.input.parse(proxy.input))));
    const strip = jobOf('media.filmstrip', asset());
    const made = unwrap(await media.makeFilmstrip(mediaMakeFilmstripJob.input.parse(strip.input)));
    keep('media.filmstrip', made);
    const stored = stage('media.filmstrip').result(outputs['media.filmstrip'], asset());
    return {
      input: strip.input,
      filmstrip: filmstripSchema.parse(made.filmstrip),
      source: made.source,
      derived: stored.ok ? stored.value.derived : stored.error,
    };
  }

  /** How far each cell's bar reaches, as a fraction of the cell's width (its middle rows: JPEG blocks bleed). */
  async function barReach(strip: Filmstrip): Promise<number[]> {
    const gray = await runProcess(binaries().ffmpeg, [
      ...['-v', 'error', '-i', join(cacheRoot, strip.file.key), '-f', 'rawvideo', '-pix_fmt', 'gray', '-'],
    ]);
    if (!gray.ok) throw new Error(gray.error.code);
    const pixels = gray.value.stdout;
    const width = strip.columns * strip.tileWidth;
    expect(pixels.length).toBe(width * strip.rows * strip.tileHeight);
    return strip.times.map((_, cell) => {
      const left = (cell % strip.columns) * strip.tileWidth;
      const top = Math.floor(cell / strip.columns) * strip.tileHeight + Math.floor(strip.tileHeight / 4);
      const rows = Math.floor(strip.tileHeight / 2);
      let lit = 0;
      for (let x = left; x < left + strip.tileWidth; x++) {
        let sum = 0;
        for (let y = top; y < top + rows; y++) sum += pixels[y * width + x] ?? 0;
        if (sum / rows > 128) lit++;
      }
      return lit / strip.tileWidth;
    });
  }

  it('makes a 9:16 clip’s sprite from its proxy: 61 frames 192 px high, from the first frame to the last', async () => {
    const h264 = await h264Encoder(context());
    if (!h264) throw new Error('no H.264 encoder');
    // Matroska isn't a container the viewer plays as is, so media.proxy makes a copy.
    const path = join(dir, 'portrait.mkv');
    const args = greyClipArgs({
      size: '360x640',
      fps: FPS,
      seconds: 32,
      gop: 30,
      level: bar(960),
      encoder: h264,
    });
    expect(await renderClip(context(), path, args)).toBe(true);
    const run = await index(path, 'a1'.repeat(32));

    expect(run.input).toHaveProperty('proxyKey');
    expect(run.source).toBe('keyframes');
    const strip = run.filmstrip;
    expect(strip.file.key).toBe(`filmstrips/a1/${'a1'.repeat(32)}.v2.jpg`);
    expect(run.derived).toEqual([strip.file]);
    expect([strip.times.length, strip.columns, strip.rows]).toEqual([61, 8, 8]);
    expect([strip.tileWidth, strip.tileHeight]).toEqual([108, 192]);
    expect([strip.file.width, strip.file.height]).toEqual([8 * 108, 8 * 192]);
    const body = await readFile(join(cacheRoot, strip.file.key));
    expect([body[0], body[1]]).toEqual([0xff, 0xd8]);
    expect(strip.file.bytes).toBe(body.length);

    const seconds = strip.times.map((time) => RationalTime.toSeconds(time));
    expect(seconds[0]).toBe(0);
    expect(seconds.at(-1)).toBeCloseTo(959 / FPS, 2);
    const gaps = seconds.slice(1).map((s, i) => s - (seconds[i] ?? 0));
    for (const gap of gaps) expect(gap).toBeCloseTo(959 / 60 / FPS, 1);

    const slack = 2.5 / strip.tileWidth;
    const reaches = await barReach(strip);
    // From an empty frame to a full one: the last cell is the clip's last frame, not a blank.
    expect([reaches[0], reaches.at(-1)]).toEqual([0, expect.closeTo(1, 1)]);
    reaches.forEach((reach, cell) => {
      const frame = Math.round((seconds[cell] ?? 0) * FPS);
      // The proxy keyframe at or before the frame: up to half a second (15 frames) earlier.
      expect(reach, `cell ${cell}`).toBeLessThanOrEqual(frame / 960 + slack);
      expect(reach, `cell ${cell}`).toBeGreaterThanOrEqual(Math.max(0, frame - 15) / 960 - slack);
    });
  });

  it('reads the exact frames of a clip that is its own proxy', async () => {
    const h264 = await h264Encoder(context());
    if (!h264) throw new Error('no H.264 encoder');
    const path = join(dir, 'square.mp4');
    const args = greyClipArgs({
      size: '320x320',
      fps: FPS,
      seconds: 4,
      gop: 30,
      level: bar(120),
      encoder: h264,
    });
    expect(await renderClip(context(), path, args)).toBe(true);
    const run = await index(path, 'b2'.repeat(32));

    expect(run.input).not.toHaveProperty('proxyKey');
    expect(run.source).toBe('exact');
    const strip = run.filmstrip;
    expect([strip.times.length, strip.tileWidth, strip.tileHeight]).toEqual([35, 192, 192]);
    const slack = 2.5 / strip.tileWidth;
    (await barReach(strip)).forEach((reach, cell) => {
      const time = strip.times[cell];
      const frame = time ? Math.round(RationalTime.toSeconds(time) * FPS) : -1;
      expect(Math.abs(reach - frame / 120), `cell ${cell}`).toBeLessThanOrEqual(slack);
    });
  });
});
