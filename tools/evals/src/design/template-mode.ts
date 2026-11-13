// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `eval:design --template` (HFW1 tpl): the template Designer on the made-up reels (template-cases.ts). With real
 * frames, each reel is drawn by render's engine over a made-up footage still (FFmpeg's test pattern) and the
 * designs are drawn and measured the same way; with stand-in frames nothing is drawn (template-stand-in.ts). The
 * model is the live one given, else the stand-in Designer.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runFfmpeg } from '@taalcut/media';
import type { DesignerModel, DesignPicture } from '@taalcut/render';
import { requireMediaBinaries } from '../media-bin';
import { scrubbedValue } from './design-mode';
import { realFrames } from './frames';
import { templateCases } from './template-cases';
import {
  templateReport,
  templateMarkdown,
  writeTemplateReport,
  type TemplateReport,
} from './template-report';
import { runTemplateCase, type TemplateCaseOutcome } from './template-run';
import { BLANK_PICTURE, standInDraw, templateStandIn } from './template-stand-in';
import { diskWorkspace } from './workspace';
import type { FramesFn } from './world';

export interface TemplateModeOptions {
  readonly root: string;
  readonly out: string;
  readonly cases: readonly string[];
  readonly frames: 'real' | 'stand-in';
  /** The live Designer; null runs the stand-in. */
  readonly live: DesignerModel | null;
  /** The run's label, asked at the end (a live model's malformed calls are counted as it runs). */
  readonly label: () => string;
  /** The live model's id, for the compositions' provenance. */
  readonly designerId?: string;
  /** Whether the live model runs on this Mac. */
  readonly onDevice?: boolean;
  readonly log?: (line: string) => void;
  /** Every line and the report go through it first (a plan's token never reaches them). */
  readonly scrub?: (text: string) => string;
}

/**
 * A made-up footage still on the 1080×1920 canvas: FFmpeg's moving test pattern, one frame, filling it, or for a
 * reel of another shape filling its top `height` px (the rest black).
 */
async function footageStill(root: string, height = 1920): Promise<DesignPicture> {
  const media = { binaries: await requireMediaBinaries() };
  await mkdir(join(root, 'footage'), { recursive: true });
  const file = join(root, 'footage', `still-${height}.jpg`);
  const made = await runFfmpeg(media, [
    '-y',
    '-f',
    'lavfi',
    '-i',
    `testsrc2=s=1080x${height}:r=30:d=1`,
    ...(height < 1920 ? ['-vf', 'pad=1080:1920:0:0:black'] : []),
    '-frames:v',
    '1',
    '-q:v',
    '4',
    file,
  ]);
  if (!made.ok) throw new Error(`The footage still was not made: ${made.error.detail ?? made.error.code}`);
  return { data: (await readFile(file)).toString('base64'), mimeType: 'image/jpeg' };
}

/** A drawn 9:16 still cut to its top `height` px of 1920 (a 16:9 reel's frame), with FFmpeg. */
function cropper(root: string) {
  let made = 0;
  return async (picture: DesignPicture, height: number): Promise<DesignPicture> => {
    const media = { binaries: await requireMediaBinaries() };
    const dir = join(root, 'crops');
    await mkdir(dir, { recursive: true });
    const from = join(dir, `${made}-in.jpg`);
    const to = join(dir, `${made++}-out.jpg`);
    await writeFile(from, Buffer.from(picture.data, 'base64'));
    const cut = await runFfmpeg(media, [
      '-y',
      '-i',
      from,
      '-vf',
      `crop=iw:trunc(ih*${height}/1920/2)*2:0:0`,
      '-q:v',
      '3',
      to,
    ]);
    if (!cut.ok) throw new Error(`The reel frame was not cut: ${cut.error.detail ?? cut.error.code}`);
    return { data: (await readFile(to)).toString('base64'), mimeType: 'image/jpeg' };
  };
}

export async function templateMode(options: TemplateModeOptions): Promise<TemplateReport> {
  const scrub = options.scrub ?? ((text: string) => text);
  const write = options.log ?? ((line: string) => console.log(line));
  const log = (line: string) => write(scrub(line));
  const cases = templateCases(options.cases);
  const real = options.frames === 'real';
  const frames: FramesFn = real
    ? (await realFrames(options.root)).frames
    : standInDraw(diskWorkspace(options.root).store, cases);
  const footage = (entry: (typeof cases)[number]) =>
    real ? footageStill(options.root, entry.reelHeight) : Promise.resolve(BLANK_PICTURE);
  const crop = real ? cropper(options.root) : undefined;
  const outcomes: TemplateCaseOutcome[] = [];
  for (const entry of cases) {
    const outcome = await runTemplateCase(entry, {
      root: options.root,
      frames,
      footage: await footage(entry),
      ...(crop ? { crop } : {}),
      model: (overlays) => options.live ?? templateStandIn(overlays),
      out: options.out,
      ...(options.designerId ? { designerId: options.designerId, onDevice: options.onDevice ?? false } : {}),
    });
    outcomes.push(outcome);
    log(
      `${outcome.pass ? 'pass' : 'FAIL'} ${outcome.id} (${outcome.minutes} min)${outcome.why ? `: ${outcome.why}` : ''}`,
    );
    for (const brief of outcome.briefs) log(`  ${brief.role}: ${brief.calls.join(' ')}`);
  }
  const report = scrubbedValue(templateReport(options.label(), outcomes), scrub);
  await writeTemplateReport(report, options.out);
  log(templateMarkdown(report));
  return report;
}
