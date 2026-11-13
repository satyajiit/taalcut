// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Gate 8 (P2-M5): captions render in English, Hindi, Spanish and Portuguese
 * (and Hinglish) inside every preset's safe zone. Each language's golden
 * string becomes cues (buildCaptionCues with the real harfbuzz measurer and
 * the matched style), is burned through the real picture path, and then:
 *
 * - Chrome's own layout of every cue (the DOM probe, on the same composition
 *   with a still in place of the video, since the shell has no H.264
 *   decoder) lies inside every preset's safe rect, with its fonts loaded and
 *   the line count harfbuzz predicted;
 * - no code point is missing from the font stack;
 * - each cue's region of a frame decoded from the rendered MP4 matches its
 *   golden crop with SSIM ≥ 0.98.
 *
 * Goldens are written only with TAALCUT_UPDATE_GOLDENS=1; a missing golden
 * fails. They await the PO's approval (goldens.json, approvedBy).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FrameRate, RationalTime, type CaptionTrack, type ExportPreset, type Rect } from '@taalcut/core';
import { runProcess, type MediaContext } from '@taalcut/media';
import { createCompositionFonts } from '../../src/captions/fonts';
import { captionGlyphIssues } from '../../src/captions/glyphs';
import { layoutCue } from '../../src/captions/layout';
import type { DetailedTextMeasurer } from '../../src/captions/measure';
import type { CompileOptions } from '../../src/compile/composition';
import { renderVideo } from '../../src/engine/render-video';
import { HEADLESS_SHELL } from '../../src/engine/headless-shell';
import { captionStyleForCanvas } from '../../src/plan/canvas';
import { EXPORT_PRESETS, isPortraitPreset } from '../../src/presets/presets.v1';
import { FONTS_DIR, GOLDEN, testMeasurer } from '../support/fonts';
import { GOLDEN_DIR, UPDATE_GOLDENS } from '../support/golden';
import { ffmpeg, findTestMedia, mediaContext, tempDir } from '../support/media';
import { findTestShell } from '../support/shell';
import { makeTimeline } from '../support/timeline';
import { goldenCaptionTrack, probeCaptionCues } from './caption-probe';
import { captionGeometryGroups, LEGACY_CAPTION_PRESET } from './caption-presets';
import { FIXTURE_H264 } from '../support/host-video';

const media = await findTestMedia('caption languages');
const shell = findTestShell('caption languages');
const skip = !media.binaries || !shell.path;

const LANGUAGES = [
  { key: 'en', language: 'en', text: GOLDEN.en },
  { key: 'hi', language: 'hi', text: GOLDEN.hi },
  { key: 'es', language: 'es', text: GOLDEN.es },
  { key: 'pt', language: 'pt-BR', text: GOLDEN.pt },
  { key: 'hinglish', language: 'hi', text: GOLDEN.hinglish },
] as const;

const RATE = FrameRate.of(30);
const WORD_FRAMES = 12;
const SSIM_MIN = 0.98;
/**
 * The goldens of the platform that rendered them: glyphs rasterise differently on Linux (FreeType) than on a Mac
 * (CoreText), about 0.95 SSIM apart for the same cue (LNX1-RND), so Linux keeps its own set beside the Mac's.
 */
const CAPTION_GOLDENS = join(
  GOLDEN_DIR,
  'captions',
  ...(process.platform === 'darwin' ? [] : [process.platform]),
);
const GOLDENS_FILE = join(CAPTION_GOLDENS, 'goldens.json');

interface CueGolden {
  readonly text: string;
  readonly frame: number;
  readonly rect: Rect;
  readonly file: string;
}

interface CaptionGolden {
  readonly language: string;
  readonly font: string;
  /** One crop per cue, so every golden string (conjuncts, reph, nukta, every vowel sign) is on file. */
  readonly cues: readonly CueGolden[];
}

interface GoldensFile {
  readonly description: string;
  readonly approvedBy: string | null;
  readonly approvedOn: string | null;
  readonly shell: string;
  readonly ssimMin: number;
  readonly languages: Record<string, CaptionGolden>;
}

function readGoldens(): GoldensFile | null {
  return existsSync(GOLDENS_FILE) ? (JSON.parse(readFileSync(GOLDENS_FILE, 'utf8')) as GoldensFile) : null;
}

/** The golden string as one caption track: a word every WORD_FRAMES, grouped by the real cue builder. */
const captionTrack = (language: string, text: string, measurer: DetailedTextMeasurer) =>
  goldenCaptionTrack(
    language,
    text,
    measurer,
    { rate: RATE, wordFrames: WORD_FRAMES },
    undefined,
    LEGACY_CAPTION_PRESET,
  );

/** A frame of a video, cropped to `rect`, halved and grey, as PNG (the caption goldens' form). */
async function captionCrop(
  ctx: MediaContext,
  video: string,
  frame: number,
  rect: Rect,
  out: string,
): Promise<void> {
  await ffmpeg(ctx, [
    '-i',
    video,
    '-vf',
    `select=eq(n\\,${frame}),crop=${rect.width}:${rect.height}:${rect.x}:${rect.y},scale=iw/2:ih/2:flags=area,format=gray`,
    '-frames:v',
    '1',
    '-update',
    '1',
    out,
  ]);
}

/** SSIM (All) between two images of the same size. */
async function ssim(ctx: MediaContext, a: string, b: string): Promise<number> {
  const result = await runProcess(
    ctx.binaries.ffmpeg,
    ['-hide_banner', '-nostats', '-i', a, '-i', b, '-lavfi', 'ssim', '-f', 'null', '-'],
    {
      timeoutMs: 60_000,
    },
  );
  if (!result.ok) throw new Error(`ssim failed: ${result.error.code} ${result.error.detail ?? ''}`);
  const match = /All:([0-9.]+)/.exec(result.value.stderrTail);
  if (!match) throw new Error(`ssim printed no score: ${result.value.stderrTail.slice(-300)}`);
  return Number(match[1]);
}

/** The smallest rect holding every box, grown by `pad` and clamped to the canvas, on even pixels. */
function unionRect(boxes: readonly Rect[], pad: number, canvas = { width: 1080, height: 1920 }): Rect {
  const x0 = Math.max(0, Math.min(...boxes.map((b) => b.x)) - pad);
  const y0 = Math.max(0, Math.min(...boxes.map((b) => b.y)) - pad);
  const x1 = Math.min(canvas.width, Math.max(...boxes.map((b) => b.x + b.width)) + pad);
  const y1 = Math.min(canvas.height, Math.max(...boxes.map((b) => b.y + b.height)) + pad);
  const even = (v: number) => Math.floor(v / 2) * 2;
  return { x: even(x0), y: even(y0), width: even(x1 - even(x0)), height: even(y1 - even(y0)) };
}

/** Whether `box` lies inside `rect`. */
const insideRect = (box: Rect, rect: Rect) =>
  box.x >= rect.x &&
  box.y >= rect.y &&
  box.x + box.width <= rect.x + rect.width &&
  box.y + box.height <= rect.y + rect.height;

const middleOf = (cue: CaptionTrack['cues'][number]) =>
  RationalTime.toFrames(cue.range.start, RATE) +
  Math.floor(RationalTime.toFrames(cue.range.duration, RATE) / 2);

describe.skipIf(skip)('captions in four languages (gate 8)', { timeout: 240_000 }, () => {
  let ctx: MediaContext;
  let work: Awaited<ReturnType<typeof tempDir>>;
  let measurer: DetailedTextMeasurer;
  let background: { path: string; size: number; mtimeMs: number };
  let still: string;
  const previous = readGoldens();
  const written: Record<string, CaptionGolden> = {};
  const scores: Record<string, number[]> = {};

  beforeAll(async () => {
    ctx = mediaContext(media.binaries!);
    work = await tempDir('caption-languages');
    measurer = await testMeasurer();
    const path = join(work.dir, 'background.mp4');
    await ffmpeg(ctx, [
      '-f',
      'lavfi',
      '-i',
      'color=c=0x1e4d7a:s=108x192:r=30',
      '-frames:v',
      '300',
      '-c:v',
      FIXTURE_H264,
      '-b:v',
      '4M',
      '-pix_fmt',
      'yuv420p',
      path,
    ]);
    const info = await stat(path);
    background = { path, size: info.size, mtimeMs: info.mtimeMs };
    still = join(work.dir, 'background.jpg');
    await ffmpeg(ctx, ['-f', 'lavfi', '-i', 'color=c=0x1e4d7a:s=1080x1920', '-frames:v', '1', still]);
  });

  afterAll(async () => {
    process.stdout.write(`[caption languages] SSIM ${JSON.stringify(scores)}\n`);
    if (UPDATE_GOLDENS && Object.keys(written).length > 0) {
      const file: GoldensFile = {
        description:
          'Gate 8 caption goldens: each cue of each language, cropped from a rendered frame, halved and grey. ' +
          'Written with TAALCUT_UPDATE_GOLDENS=1; they count as approved only once the PO signs them off.',
        approvedBy: null,
        approvedOn: null,
        shell: `chrome-headless-shell ${HEADLESS_SHELL.version}`,
        ssimMin: SSIM_MIN,
        languages: { ...(previous?.languages ?? {}), ...written },
      };
      writeFileSync(GOLDENS_FILE, `${JSON.stringify(file, null, 2)}\n`);
    }
    await work?.dispose();
  });

  /** Chrome's boxes for every cue, from the composition with a still under the captions. */
  const probeCues = async (
    track: CaptionTrack,
    frames: number,
    options: Pick<CompileOptions, 'fonts' | 'captionLayout'>,
    preset: ExportPreset,
  ) =>
    (
      await probeCaptionCues({
        track,
        frames,
        rate: RATE,
        preset,
        still,
        workDir: work.dir,
        chromePath: shell.path!,
        ctx,
        options,
      })
    ).boxes;

  it.each(LANGUAGES.map((entry) => [entry.key, entry] as const))('%s', async (key, entry) => {
    const { track, frames } = captionTrack(entry.language, entry.text, measurer);
    const fonts = createCompositionFonts(FONTS_DIR, measurer);
    const captionLayout: CompileOptions['captionLayout'] = (text, style, safe, language, height) =>
      layoutCue(text, style, measurer, safe, language, height);

    // No code point the stack can't draw.
    const cueTexts = track.cues.map((cue) => ({ id: cue.id, text: cue.words.map((w) => w.text).join(' ') }));
    expect(captionGlyphIssues(cueTexts, track.style.font)).toEqual([]);

    // Chrome's layout: inside every preset's safe rect, fonts loaded, the lines harfbuzz predicted.
    for (const { drawn, checked } of captionGeometryGroups(EXPORT_PRESETS.filter(isPortraitPreset))) {
      const boxes = await probeCues(track, frames, { fonts, captionLayout }, drawn);
      const style = captionStyleForCanvas(track.style, LEGACY_CAPTION_PRESET, drawn);
      for (const cue of track.cues) {
        const found = boxes.get(cue.id)!;
        const text = cueTexts.find((c) => c.id === cue.id)!.text;
        expect(found, `cue "${text}"`).toHaveLength(1);
        const box = found[0]!;
        expect(box.fontsReady).toBe(true);
        expect(box.lines).toBe(
          layoutCue(text, style, measurer, drawn.safe, entry.language, drawn.height).lines.length,
        );
        for (const preset of checked)
          expect(insideRect(box.box, preset.safe), `${preset.id}: ${JSON.stringify(box.box)}`).toBe(true);
      }
    }

    // Approved typography crops keep their original geometry; current presets were independently probed above.
    const boxes = await probeCues(track, frames, { fonts, captionLayout }, LEGACY_CAPTION_PRESET);
    const rendered = await renderVideo({
      timeline: makeTimeline({
        rate: RATE,
        items: [{ frames, sourceStart: 0, mediaFrames: 300, muted: true }],
        captions: track,
      }),
      preset: LEGACY_CAPTION_PRESET,
      burnCaptions: true,
      source: () => background,
      ctx,
      conformDir: join(work.dir, 'conform'),
      workDir: join(work.dir, key),
      chromePath: shell.path!,
      browserGpu: 'hardware',
      gpuEncode: true,
      workers: 'auto',
      fonts,
      captionLayout,
    });
    if (!rendered.ok) throw new Error(`${rendered.error.code}: ${rendered.error.detail ?? ''}`);
    const stored = previous?.languages[key];
    if (UPDATE_GOLDENS) {
      mkdirSync(CAPTION_GOLDENS, { recursive: true });
      const cues: CueGolden[] = [];
      for (const [index, cue] of track.cues.entries()) {
        const file = `${key}-${index + 1}.png`;
        const rect = unionRect(
          boxes.get(cue.id)!.map((b) => b.box),
          12,
        );
        await captionCrop(ctx, rendered.value.video, middleOf(cue), rect, join(CAPTION_GOLDENS, file));
        cues.push({ text: cueTexts[index]!.text, frame: middleOf(cue), rect, file });
      }
      written[key] = { language: entry.language, font: track.style.font, cues };
      return;
    }
    expect(stored, `golden for ${key} (run with TAALCUT_UPDATE_GOLDENS=1 to make it)`).toBeDefined();
    expect(stored!.cues.map((cue) => cue.text)).toEqual(cueTexts.map((cue) => cue.text));
    scores[key] = [];
    for (const [index, cue] of track.cues.entries()) {
      const golden = stored!.cues[index]!;
      const goldenPath = join(CAPTION_GOLDENS, golden.file);
      expect(existsSync(goldenPath), `${goldenPath} exists`).toBe(true);
      expect(golden.frame).toBe(middleOf(cue));
      // The cue still sits inside its golden's crop.
      for (const b of boxes.get(cue.id)!) expect(insideRect(b.box, golden.rect)).toBe(true);
      const crop = join(work.dir, `${key}-${index + 1}-crop.png`);
      await captionCrop(ctx, rendered.value.video, golden.frame, golden.rect, crop);
      const score = await ssim(ctx, crop, goldenPath);
      scores[key].push(Number(score.toFixed(4)));
      expect(score, `${key} cue ${index + 1}`).toBeGreaterThanOrEqual(SSIM_MIN);
    }
    // The bar is meaningful: the first cue moved 6 px (3 px in the halved crop) falls under it.
    const moved = join(work.dir, `${key}-moved.png`);
    const first = stored!.cues[0]!;
    await captionCrop(ctx, rendered.value.video, first.frame, { ...first.rect, x: first.rect.x + 6 }, moved);
    expect(await ssim(ctx, moved, join(CAPTION_GOLDENS, first.file))).toBeLessThan(SSIM_MIN);
  });
});
