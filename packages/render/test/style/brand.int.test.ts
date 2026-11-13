// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A brand kit in the render (P3-V10, SPEC P3.5 "Done when"): a timeline with a Style (logo, logo watermark,
 * intro clip, outro card, colours, fonts) exported through the real pipeline. The logo's pixels sit at its
 * corner inside the safe rect (colour oracle), the watermark is blended at its opacity, the first frames are
 * the intro clip and the last the outro card; on path b the music starts after the intro and stops before the
 * outro. Path a leaves the intro out with brandAssets' info note, a deleted outro asset is skipped with a
 * brandAssets warning, and the same Style read back gives the same composition (it survives reopening).
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  err,
  FrameRate,
  newId,
  NotFoundError,
  ok,
  RationalTime,
  styleSchema,
  timelineSchema,
  type AssetId,
  type MusicChoice,
  type Rect,
  type Style,
  type StyleId,
  type Timeline,
} from '@taalcut/core';
import { runProcess, type MediaContext } from '@taalcut/media';
import { compileComposition } from '../../src/compile/composition';
import { presetFor } from '../../src/presets/presets.v1';
import { styleExport } from '../../src/style/export-style';
import { createStyleSource, type StyleSource } from '../../src/style/resolve-style';
import { cornerRect } from '../../src/style/brand-layout';
import { testEngine } from '../support/engine';
import {
  colourClip,
  ffmpeg,
  findTestMedia,
  mediaContext,
  patchColour,
  probeJson,
  tempDir,
} from '../support/media';
import { findTestShell } from '../support/shell';
import { makeTimeline } from '../support/timeline';
import { checkStatus, exportToEnd, failing, queueRender } from '../support/export-record';
import { FIXTURE_H264 } from '../support/host-video';

const media = await findTestMedia('brand kit');
const shell = findTestShell('brand kit');
const skip = !media.binaries || !shell.path;
const RATE = FrameRate.of(30);
const DEVICE = presetFor('device');
/** The timeline's own picture (its clip) and the bumpers' colours. */
const BLUE = [32, 64, 128] as const;
const MAGENTA = [255, 0, 255] as const;
const SECONDARY = '#20a060';
const GREEN_LOGO = { width: 200, height: 100 } as const;

const centreOf = (rect: Rect) => ({
  x: Math.round(rect.x + rect.width / 2) - 4,
  y: Math.round(rect.y + rect.height / 2) - 4,
});
const close = (measured: readonly number[], expected: readonly number[], tolerance = 24) =>
  measured.every((value, index) => Math.abs(value - (expected[index] ?? 0)) <= tolerance);

/** RMS level, dBFS, of the delivered sound between two times (mono, 48 kHz floats). */
async function levelDb(ctx: MediaContext, path: string, from: number, to: number): Promise<number> {
  const result = await runProcess(
    ctx.binaries.ffmpeg,
    ['-v', 'error', '-i', path, '-vn', '-ac', '1', '-ar', '48000', '-f', 'f32le', '-'],
    { timeoutMs: 60_000, maxStdoutBytes: 64 * 1024 * 1024 },
  );
  if (!result.ok) throw new Error(`audio decode failed: ${result.error.code}`);
  const bytes = result.value.stdout;
  const samples = new Float32Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.length / 4));
  const start = Math.floor(from * 48_000);
  const end = Math.min(samples.length, Math.floor(to * 48_000));
  let sum = 0;
  for (let index = start; index < end; index++) sum += (samples[index] ?? 0) ** 2;
  const rms = Math.sqrt(sum / Math.max(1, end - start));
  return rms > 0 ? 20 * Math.log10(rms) : -200;
}

/** The delivered file's video frame count. */
async function frameCount(ctx: MediaContext, path: string): Promise<number> {
  const probe = (await probeJson(ctx, path, 'stream=codec_type,nb_read_packets')) as {
    streams: { codec_type: string; nb_read_packets: string }[];
  };
  return Number(probe.streams.find((stream) => stream.codec_type === 'video')?.nb_read_packets ?? 0);
}

interface Kit {
  readonly style: Style;
  readonly source: StyleSource;
}

/** A Style the way the templates lane stores it: parsed from its JSON, so a stored one reads back the same. */
function brandStyle(input: {
  readonly id: StyleId;
  readonly logo: string;
  readonly intro: AssetId;
  readonly outro: { kind: 'card' } | { kind: 'clip'; assetId: AssetId };
  readonly secondary?: string;
}): Style {
  return styleSchema.parse({
    schemaVersion: 1,
    id: input.id,
    revision: 1,
    name: 'Brand kit',
    kind: 'brandKit',
    colours: {
      primary: '#c02040',
      secondary: input.secondary ?? SECONDARY,
      accent: '#ffcc00',
      text: '#ffffff',
      background: '#101010',
    },
    fonts: { heading: { family: 'notoSans', weight: 700 }, body: { family: 'notoSans', weight: 400 } },
    captions: null,
    textStyles: {},
    logo: {
      asset: input.logo,
      mediaType: 'image/png',
      width: GREEN_LOGO.width,
      height: GREEN_LOGO.height,
      placement: 'topRight',
      scale: 0.2,
      opacity: 1,
      showOn: 'always',
    },
    watermark: { kind: 'logo', placement: 'bottomLeft', opacity: 0.5 },
    intro: { kind: 'clip', assetId: input.intro, range: null },
    outro:
      input.outro.kind === 'card'
        ? {
            kind: 'card',
            text: 'Thanks for watching',
            duration: RationalTime.of(1, FrameRate.of(1)),
            background: 'secondary',
          }
        : { kind: 'clip', assetId: input.outro.assetId, range: null },
    grade: null,
    fontMatch: null,
    madeFrom: null,
    createdAt: 0,
    updatedAt: 0,
  });
}

/** core's StyleStore reads behind render's StyleSource, over one stored Style and the logo file. */
function kitOf(style: Style, logoPath: string, logoSha: string): Kit {
  const stored = JSON.stringify(style);
  return {
    style,
    source: createStyleSource({
      styles: {
        // Each read parses the stored JSON again, as a reopened project would.
        get: async (styleId) =>
          styleId === style.id
            ? ok(styleSchema.parse(JSON.parse(stored)))
            : err(NotFoundError({ entity: 'style', id: styleId })),
        assetPath: async (sha256) =>
          sha256 === logoSha ? ok(logoPath) : err(NotFoundError({ entity: 'styleAsset', id: sha256 })),
      },
    }),
  };
}

function styledTimeline(clip: AssetId, frames: number, styleId: StyleId, music: MusicChoice): Timeline {
  const timeline = makeTimeline({
    rate: RATE,
    items: [{ frames, assetId: clip, sourceStart: 0, mediaFrames: 150, mediaRate: RATE, muted: true }],
    music,
  });
  return timelineSchema.parse({ ...timeline, styleId });
}

describe.skipIf(skip)('brand kit in the render (P3-V10)', { timeout: 900_000 }, () => {
  let ctx: MediaContext;
  let work: Awaited<ReturnType<typeof tempDir>>;
  const clip = newId<'Asset'>();
  const intro = newId<'Asset'>();
  const song = newId<'Asset'>();
  let logoPath: string;
  let logoSha: string;
  let files: Map<AssetId, string>;

  beforeAll(async () => {
    ctx = mediaContext(media.binaries!);
    work = await tempDir('brand');
    logoPath = join(work.dir, 'logo.png');
    await ffmpeg(ctx, [
      '-f',
      'lavfi',
      '-i',
      `color=c=0x00ff00:s=${GREEN_LOGO.width}x${GREEN_LOGO.height}`,
      '-frames:v',
      '1',
      logoPath,
    ]);
    logoSha = createHash('sha256')
      .update(await readFile(logoPath))
      .digest('hex');
    await colourClip(ctx, join(work.dir, 'clip.mp4'), { colour: '0x204080', frames: 150, rate: '30' });
    // The intro clip has no sound of its own: the music must not start under it.
    await ffmpeg(ctx, [
      '-f',
      'lavfi',
      '-i',
      'color=c=0xff00ff:s=1080x1920:r=30',
      '-frames:v',
      '30',
      '-c:v',
      FIXTURE_H264,
      '-b:v',
      '6M',
      '-pix_fmt',
      'yuv420p',
      join(work.dir, 'intro.mp4'),
    ]);
    await ffmpeg(ctx, [
      '-f',
      'lavfi',
      '-i',
      'sine=f=440:r=48000:d=8',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      join(work.dir, 'song.m4a'),
    ]);
    files = new Map([
      [clip, join(work.dir, 'clip.mp4')],
      [intro, join(work.dir, 'intro.mp4')],
      [song, join(work.dir, 'song.m4a')],
    ]);
  });
  afterAll(() => work?.dispose());

  function engineWith(name: string, kit: Kit) {
    const engine = testEngine(join(work.dir, name), ctx, shell.path!, { styles: kit.source });
    for (const [assetId, path] of files) engine.assets.set(assetId, path);
    return engine;
  }

  it('draws the logo, the watermark, the intro clip and the outro card; path b music sits between them', async () => {
    const style = brandStyle({ id: newId<'Style'>(), logo: logoSha, intro, outro: { kind: 'card' } });
    const engine = engineWith('full', kitOf(style, logoPath, logoSha));
    const music: MusicChoice = {
      path: 'ownTrack',
      assetId: song,
      offset: RationalTime.zero(RATE),
      gainDb: 0,
    };
    const timeline = styledTimeline(clip, 60, style.id, music);
    const stored = await exportToEnd(engine, await queueRender(engine, timeline));
    // Solid-colour clips are static: frozenFrames warns about the footage's own stillness, never fails the render.
    const frozen = stored.qaReport?.checks.find((check) => check.id === 'frozenFrames');
    console.warn(
      `[brand] frozenFrames ${frozen?.status} ${JSON.stringify(frozen?.findings)} ${JSON.stringify(frozen?.fixes)}`,
    );
    expect(failing(stored)).toEqual([]);
    expect(stored.status).toBe('ready');
    expect(checkStatus(stored, 'brandAssets')).toBe('pass');
    const file = stored.filePath!;
    expect(await frameCount(ctx, file)).toBe(120);

    // Intro clip (frames 0–29), the timeline (30–89), the outro card (90–119).
    const at = { x: 536, y: 956, size: 8 };
    expect(close(await patchColour(ctx, file, 10, at), MAGENTA)).toBe(true);
    expect(close(await patchColour(ctx, file, 60, at), BLUE)).toBe(true);
    const card = await patchColour(ctx, file, 110, { x: 536, y: 400, size: 8 });
    expect(close(card, [0x20, 0xa0, 0x60])).toBe(true);

    // The logo: opaque green at the safe rect's top right, a fifth of the canvas wide; it never leaves the safe rect.
    const width = Math.round(0.2 * DEVICE.width);
    const logoRect = cornerRect('topRight', width, Math.round(width / 2), DEVICE.safe);
    const logo = await patchColour(ctx, file, 60, { ...centreOf(logoRect), size: 8 });
    console.warn(`[brand] logo ${logo.join(',')} at ${JSON.stringify(logoRect)}`);
    expect(close(logo, [0, 255, 0])).toBe(true);
    expect(logoRect.x + logoRect.width).toBeLessThanOrEqual(DEVICE.safe.x + DEVICE.safe.width);
    expect(logoRect.y).toBeGreaterThanOrEqual(DEVICE.safe.y);
    // Just outside its corner, the timeline's own picture.
    const beside = await patchColour(ctx, file, 60, { x: logoRect.x - 24, y: logoRect.y + 20, size: 8 });
    expect(close(beside, BLUE)).toBe(true);
    // The watermark: the logo at half opacity over the clip, bottom left.
    const markWidth = Math.round(0.1 * DEVICE.width);
    const markRect = cornerRect('bottomLeft', markWidth, Math.round(markWidth / 2), DEVICE.safe);
    const mark = await patchColour(ctx, file, 60, { ...centreOf(markRect), size: 6 });
    console.warn(`[brand] watermark ${mark.join(',')}`);
    expect(close(mark, [16, 160, 64], 30)).toBe(true);

    // Path b: silence under the intro and the outro, the song between them.
    const introDb = await levelDb(ctx, file, 0.1, 0.9);
    const songDb = await levelDb(ctx, file, 1.2, 2.8);
    const outroDb = await levelDb(ctx, file, 3.1, 3.9);
    console.warn(
      `[brand] intro ${introDb.toFixed(1)} dB, song ${songDb.toFixed(1)} dB, outro ${outroDb.toFixed(1)} dB`,
    );
    expect(introDb).toBeLessThan(-60);
    expect(songDb).toBeGreaterThan(-30);
    expect(outroDb).toBeLessThan(-60);
  });

  it('leaves the intro out on path a, and says so', async () => {
    const style = brandStyle({ id: newId<'Style'>(), logo: logoSha, intro, outro: { kind: 'card' } });
    const engine = engineWith('path-a', kitOf(style, logoPath, logoSha));
    const timeline = styledTimeline(clip, 30, style.id, { path: 'platformSound' });
    const stored = await exportToEnd(engine, await queueRender(engine, timeline));
    expect(failing(stored)).toEqual([]);
    expect(stored.status).toBe('ready');
    const brand = stored.qaReport?.checks.find((check) => check.id === 'brandAssets');
    expect(brand?.status).toBe('pass');
    expect(brand?.findings.map((finding) => finding.target?.id)).toEqual(['introLeftOut']);
    // The platform's sound starts at the timeline's first frame: so does the picture, then the outro card.
    expect(await frameCount(ctx, stored.filePath!)).toBe(60);
    const at = { x: 536, y: 400, size: 8 };
    expect(close(await patchColour(ctx, stored.filePath!, 2, at), BLUE)).toBe(true);
    expect(close(await patchColour(ctx, stored.filePath!, 50, at), [0x20, 0xa0, 0x60])).toBe(true);
  });

  it('skips a deleted outro clip with a brandAssets warning, and still delivers', async () => {
    const gone = newId<'Asset'>();
    const style = brandStyle({
      id: newId<'Style'>(),
      logo: logoSha,
      intro,
      outro: { kind: 'clip', assetId: gone },
    });
    const engine = engineWith('deleted', kitOf(style, logoPath, logoSha));
    const timeline = styledTimeline(clip, 30, style.id, { path: 'platformSound' });
    const stored = await exportToEnd(engine, await queueRender(engine, timeline));
    expect(failing(stored)).toEqual([]);
    expect(stored.status).toBe('ready');
    expect(stored.qaReport?.verdict).toBe('passedWithWarnings');
    const brand = stored.qaReport?.checks.find((check) => check.id === 'brandAssets');
    expect(brand?.status).toBe('warn');
    expect(brand?.findings.map((finding) => finding.target?.id)).toEqual(['outroMissing']);
    // Path a, intro left out, outro skipped: only the timeline is rendered.
    expect(await frameCount(ctx, stored.filePath!)).toBe(30);
  });

  it('draws a reopened Style exactly as before, and a changed one differently', async () => {
    const style = brandStyle({ id: newId<'Style'>(), logo: logoSha, intro, outro: { kind: 'card' } });
    const music: MusicChoice = {
      path: 'ownTrack',
      assetId: song,
      offset: RationalTime.zero(RATE),
      gainDb: 0,
    };
    const timeline = styledTimeline(clip, 60, style.id, music);
    const engine = engineWith('hash', kitOf(style, logoPath, logoSha));
    const hashOf = async (source: StyleSource) => {
      const styled = await styleExport(
        { styles: source, assets: engine.deps.assets, media: ctx },
        timeline,
        true,
      );
      if (!styled.ok) throw new Error(styled.error.code);
      expect(styled.value.style).not.toBeNull();
      const compiled = compileComposition(styled.value.timeline, {
        variant: 'export',
        preset: DEVICE,
        burnCaptions: false,
        media: (visual) => ({
          file: files.get(visual.assetId) ?? '',
          key: visual.assetId,
          mediaStart: visual.sourceIn,
          ext: 'mp4',
        }),
        style: styled.value.style,
        bumpers: styled.value.bumpers,
        brandAssets: (sha256) => styled.value.brandAssets.get(sha256),
      });
      if (!compiled.ok) throw new Error(compiled.error.code);
      return compiled.value.compositionHash;
    };
    const first = await hashOf(kitOf(style, logoPath, logoSha).source);
    // Reopened: the same Style read back from its stored JSON.
    const reopened = styleSchema.parse(JSON.parse(JSON.stringify(style)));
    expect(await hashOf(kitOf(reopened, logoPath, logoSha).source)).toBe(first);
    // The outro card's colour edited: a new composition (a changed brand kit is a new render).
    const edited = brandStyle({
      id: style.id,
      logo: logoSha,
      intro,
      outro: { kind: 'card' },
      secondary: '#a02060',
    });
    expect(await hashOf(kitOf(edited, logoPath, logoSha).source)).not.toBe(first);
  });
});
