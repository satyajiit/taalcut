// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Synthetic reels from the golden set's three synthetic labels
 * (tools/evals/golden/sample): one lavfi source per shot, cut at the
 * labelled frames at the labelled rate, a 10-frame crossfade centred on each
 * labelled dissolve, so a found cut can be scored against the label.
 * Media's `buildSyntheticReel` has no dissolves or 29.97 rates, so the
 * golden reels keep this builder.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runFfmpeg, type MediaContext } from '@taalcut/media';
import { softwareH264FixtureFlags } from '@taalcut/media/test-support';

export interface GoldenLabel {
  readonly reelId: string;
  readonly frameRate: { readonly numerator: number; readonly denominator: number };
  readonly source: { readonly durationFrames: number };
  readonly cuts: readonly number[];
  readonly transitions: readonly { readonly atFrame: number; readonly kind: string }[];
  readonly overlays: readonly {
    readonly text: string;
    readonly startFrame: number;
    readonly endFrame: number;
    readonly position: {
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
    };
  }[];
}

const GOLDEN = fileURLToPath(new URL('../../../../tools/evals/golden/sample/', import.meta.url));
export const GOLDEN_IDS = ['sample-en-30', 'sample-hi-2997', 'sample-es-25'] as const;

export function goldenLabel(id: string): GoldenLabel {
  return JSON.parse(readFileSync(`${GOLDEN}${id}.json`, 'utf8')) as GoldenLabel;
}

/** One distinct look per shot; cycled. */
const SOURCES = [
  'testsrc2',
  'smptebars',
  'mandelbrot',
  'gradients=c0=0xff8c1a:c1=0xc2185b:speed=0',
  'cellauto',
  'rgbtestsrc',
  'yuvtestsrc',
  'gradients=c0=0x0d47a1:c1=0x00bcd4:speed=0',
  'sierpinski',
  'smptehdbars',
  'testsrc2,hue=h=150',
];

export const DISSOLVE_FRAMES = 10;

export function dissolvesOf(label: GoldenLabel): number[] {
  return label.transitions.filter((t) => t.kind === 'dissolve').map((t) => t.atFrame);
}

export interface ReelBuild {
  readonly width: number;
  readonly height: number;
  /** Per shot, a filter appended to its source (e.g. an overlay of a text PNG). */
  readonly extraInputs?: readonly string[];
  /** Applied to the finished reel, inputs [v] and [1:v]…; must output [out]. */
  readonly finish?: string;
}

/** Writes an H.264 MP4 whose cuts and dissolves sit exactly on the label's frames. */
export async function makeGoldenReel(
  ctx: MediaContext,
  out: string,
  label: GoldenLabel,
  build: ReelBuild = { width: 360, height: 640 },
): Promise<void> {
  const rate = `${label.frameRate.numerator}/${label.frameRate.denominator}`;
  const fps = label.frameRate.numerator / label.frameRate.denominator;
  const tb = `${label.frameRate.denominator}/${label.frameRate.numerator}`;
  const dissolves = new Set(dissolvesOf(label));
  const bounds = [0, ...label.cuts, label.source.durationFrames];
  const half = DISSOLVE_FRAMES / 2;
  const inputs: string[] = [];
  const chains: string[] = [];
  for (let i = 0; i + 1 < bounds.length; i++) {
    const from = bounds[i] as number;
    const to = bounds[i + 1] as number;
    // A dissolve needs half its length of each shot on the far side of the cut.
    const lead = dissolves.has(from) ? half : 0;
    const tail = dissolves.has(to) ? half : 0;
    const [source, ...filters] = (SOURCES[i % SOURCES.length] as string).split(',');
    const base = (source as string).includes('=') ? `${source}:` : `${source}=`;
    inputs.push('-f', 'lavfi', '-i', `${base}size=${build.width}x${build.height}:rate=${rate}`);
    const extra = filters.length > 0 ? `,${filters.join(',')}` : '';
    chains.push(
      `[${i}:v]trim=end_frame=${to - from + lead + tail},setpts=PTS-STARTPTS,settb=${tb},format=yuv420p${extra}[s${i}]`,
    );
  }
  let last = 's0';
  for (let i = 1; i + 1 < bounds.length; i++) {
    const cut = bounds[i] as number;
    const label_ = `j${i}`;
    if (dissolves.has(cut)) {
      chains.push(
        `[${last}][s${i}]xfade=transition=fade:duration=${DISSOLVE_FRAMES / fps}:offset=${(cut - half) / fps},settb=${tb}[${label_}]`,
      );
    } else {
      chains.push(`[${last}][s${i}]concat=n=2:v=1:a=0,settb=${tb}[${label_}]`);
    }
    last = label_;
  }
  const extraInputs = build.extraInputs ?? [];
  const shots = bounds.length - 1;
  extraInputs.forEach((file) => inputs.push('-loop', '1', '-i', file));
  if (build.finish) {
    chains.push(
      build.finish
        .replaceAll('[v]', `[${last}]`)
        .replace(/\[x(\d+)\]/g, (_, n) => `[${shots + Number(n)}:v]`),
    );
    last = 'out';
  }
  // Software only: parallel hardware encodes from several test runs have panicked the video encoder.
  const made = await runFfmpeg(ctx, [
    '-y',
    ...inputs,
    '-filter_complex',
    chains.join(';'),
    '-map',
    `[${last}]`,
    '-frames:v',
    String(label.source.durationFrames),
    '-r',
    rate,
    ...softwareH264FixtureFlags(),
    '-b:v',
    '4M',
    '-pix_fmt',
    'yuv420p',
    out,
  ]);
  if (!made.ok) throw new Error(`makeGoldenReel failed: ${made.error.code} ${made.error.detail ?? ''}`);
}
