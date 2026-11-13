// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The text stage's verdicts (FIX-SIGN): each reading's pixels measured (text-motion.ts), its record weighed
 * (text-scene.ts), and the overlays the breakdown keeps: the scene's are dropped, the composited kept, the unsure
 * kept with a `textMaybeScene` doubt (its confidence the record's scene probability) and the frame round them saved
 * for the vision model's look after the job (text-check.ts). Every reading's record goes into the draft
 * (`textRegions`), dropped ones included, for the review and for DSG1's reader.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { boxSchema, RationalTime, type ReelSubjects, type TextOverlay } from '@taalcut/core';
import { encodePng } from '@taalcut/vision';
import { z } from 'zod';
import type { StepContext } from './steps';
import { measureTextPixels, type ContextCrop } from './text-motion';
import { factsFor, verdictOf, weighText, type TextEvidence, type TextRegionJudgement } from './text-scene';
import { SCENE_SIGNALS } from './text-signals';

/** Where the frames round unsure readings go, in the experiment. */
export const TEXT_CROPS_DIR = 'text';

const frame = z.int().nonnegative();

/** One reading's record as the draft keeps it. */
export const draftTextRegionSchema = z.object({
  /** The overlay it is, when kept (composited or unsure); null when dropped as the scene's. */
  overlayId: z.string().min(1).max(64).nullable(),
  /** OCR of the reference: untrusted, plain text only. */
  text: z.string().min(1).max(500),
  box: boxSchema,
  start: frame,
  end: frame,
  kind: z.enum(['composited', 'scene', 'unsure']),
  /** Log-odds that it is the scene's, and as a probability. */
  score: z.number(),
  sceneProbability: z.number().min(0).max(1),
  /** Each signal's weighted contribution (text-signals.ts). */
  signals: z.partialRecord(z.enum(SCENE_SIGNALS), z.number()),
  lean: z.enum(['scene', 'composited']).nullable(),
  site: z.int().nonnegative(),
  /** The frame round it, experiment-relative, when it was unsure and the frame could be saved. */
  crop: z.string().min(1).max(512).optional(),
  /** The on-device vision model's answer after the job (text-check.ts). */
  asked: z.enum(['scene', 'composited', 'unsure']).optional(),
});
export type DraftTextRegion = z.output<typeof draftTextRegionSchema>;

/** The words outlined in red, two pixels out, so a model knows which words are asked about. */
function outlined(crop: ContextCrop): Uint8Array {
  const rgb = Uint8Array.from(crop.rgb);
  const { width, height, words } = crop;
  const paint = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const at = (y * width + x) * 3;
    rgb[at] = 255;
    rgb[at + 1] = 32;
    rgb[at + 2] = 32;
  };
  for (let ring = 2; ring <= 3; ring++) {
    for (let x = words.left - ring; x < words.right + ring; x++) {
      paint(x, words.top - ring);
      paint(x, words.bottom - 1 + ring);
    }
    for (let y = words.top - ring; y < words.bottom + ring; y++) {
      paint(words.left - ring, y);
      paint(words.right - 1 + ring, y);
    }
  }
  return rgb;
}

async function saveCrop(dir: string, id: string, crop: ContextCrop): Promise<string | null> {
  try {
    await mkdir(join(dir, TEXT_CROPS_DIR), { recursive: true });
    const name = join(TEXT_CROPS_DIR, `${id}.png`);
    await writeFile(join(dir, name), encodePng(outlined(crop), crop.width, crop.height));
    return name;
  } catch {
    return null;
  }
}

/** The kept overlays and every reading's record, from what the text pass read. */
export async function judgeReadText(
  ctx: StepContext,
  read: { readonly overlays: readonly TextOverlay[]; readonly evidence: readonly TextEvidence[] },
  options: {
    /** The frames shots start at (not 0). */
    readonly cuts: readonly number[];
    /** The picture's width over its height. */
    readonly aspect: number;
    readonly subjects: ReelSubjects | null;
  },
): Promise<{ overlays: TextOverlay[]; regions: DraftTextRegion[]; warnings: string[] }> {
  const weigh = { cuts: options.cuts, total: ctx.total, rate: ctx.rate, config: ctx.config.textScene };
  // Each site (the readings at one place in one shot) is measured once, over all their time, in the median of its
  // readings' boxes: a sign read three ways drifts as one sign, a long baseline shows a slow handheld drift, and
  // one odd box (a reading that took in a shoulder) doesn't decide it.
  const facts = factsFor(read.overlays, weigh);
  const sites = [...new Set(facts.map((fact) => fact.site))];
  const middle = (values: number[]) => values.sort((a, b) => a - b)[values.length >> 1]!;
  const places = sites.map((site) => {
    const boxes = facts.flatMap((fact, index) => (fact.site === site ? [read.overlays[index]!.box] : []));
    const left = middle(boxes.map((box) => box.x));
    const top = middle(boxes.map((box) => box.y));
    const right = middle(boxes.map((box) => box.x + box.width));
    const bottom = middle(boxes.map((box) => box.y + box.height));
    const span = facts.find((fact) => fact.site === site)!.siteSpan;
    return {
      box: { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) },
      ...span,
    };
  });
  const pixels = await measureTextPixels(ctx, places, options.cuts);
  const siteAt = (index: number) => sites.indexOf(facts[index]!.site);
  const judged: TextRegionJudgement[] = weighText(read.overlays, read.evidence, {
    ...weigh,
    aspect: options.aspect,
    pixels: read.overlays.map((_, index) => pixels.evidence[siteAt(index)] ?? null),
    subjects: options.subjects,
  });
  const overlays: TextOverlay[] = [];
  const regions: DraftTextRegion[] = [];
  for (const [index, overlay] of read.overlays.entries()) {
    const judgement = judged[index]!;
    const verdict = verdictOf(judgement);
    const crop = pixels.context[siteAt(index)];
    const saved = verdict === 'maybeScene' && crop ? await saveCrop(ctx.dir, overlay.id, crop) : null;
    const start = RationalTime.toFrames(overlay.start, ctx.rate, 'round');
    regions.push({
      overlayId: verdict === 'scene' ? null : overlay.id,
      text: overlay.text,
      box: overlay.box,
      start,
      end: start + RationalTime.toFrames(overlay.duration, ctx.rate, 'round'),
      kind: judgement.kind,
      score: judgement.score,
      sceneProbability: judgement.sceneProbability,
      signals: judgement.signals,
      lean: judgement.lean,
      site: judgement.site,
      ...(saved ? { crop: saved } : {}),
    });
    if (verdict === 'scene') continue;
    overlays.push(
      verdict === 'maybeScene'
        ? { ...overlay, doubts: [{ reason: 'textMaybeScene', confidence: judgement.sceneProbability }] }
        : overlay,
    );
  }
  return { overlays, regions: regions.slice(0, 500), warnings: pixels.warnings };
}
