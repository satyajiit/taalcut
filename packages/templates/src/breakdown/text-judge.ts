// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The text stage's verdicts (FIX-SIGN): each reading's pixels measured (text-motion.ts), its record weighed
 * (text-scene.ts), and the overlays the breakdown keeps: the scene's are dropped, the composited kept, the unsure
 * kept with a `textMaybeScene` doubt (its confidence the record's scene probability) and the frame round them saved
 * for the vision model's look after the job (text-check.ts). Every reading's record goes into the draft
 * (`textRegions`), dropped ones included, for the review and for DSG1's reader.
 *
 * LYR1: before anything is judged, the place of readings that chain is read again (text-zone-read.ts), so text that
 * replaces itself in place comes out piece by piece. Its pieces take one look, each is measured on its own (its
 * words change, so a site's one measure would mix them), a piece no frame could read is kept without words and with
 * the doubt, and the draft lists the sequence (`textSequences`) with a picture of its pieces for the model that
 * reads them after the job (sequence-sheet.ts, sequence-read.ts).
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { boxSchema, RationalTime, type Doubt, type ReelSubjects, type TextOverlay } from '@taalcut/core';
import { encodePng } from '@taalcut/vision';
import { z } from 'zod';
import { makeSequenceSheets, type DraftTextSequence } from './sequence-sheet';
import type { StepContext } from './steps';
import { measureTextPixels, type ContextCrop } from './text-motion';
import { factsFor, verdictOf, weighText, type TextEvidence, type TextRegionJudgement } from './text-scene';
import { unionBox } from './text-sequence';
import { SCENE_SIGNALS } from './text-signals';
import type { SiteFacts } from './text-sites';
import { rereadSequences } from './text-zone-read';

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
  /** LYR1: the sequence it is a piece of, by its index in the draft's `textSequences`. */
  sequence: z.int().nonnegative().optional(),
  /** LYR1: read inside that sequence's place while it showed, so dropped: not an overlay of its own. */
  within: z.int().nonnegative().optional(),
});
export type DraftTextRegion = z.output<typeof draftTextRegionSchema>;

/** LYR1: a sequence as the draft keeps it; defined beside its sheet (sequence-sheet.ts). */
export { draftTextSequenceSchema, type DraftTextSequence } from './sequence-sheet';

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

const most = <T>(values: readonly T[]): T => {
  const counts = new Map<T, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0];
};

/** LYR1: a sequence is one piece of text in one look: its pieces take the role, size and alignment most have. */
function oneLook(overlays: readonly TextOverlay[], facts: readonly SiteFacts[]): TextOverlay[] {
  const groups = new Map<number, TextOverlay[]>();
  facts.forEach((fact, index) => {
    if (fact.sequence !== null)
      groups.set(fact.sequence, [...(groups.get(fact.sequence) ?? []), overlays[index]!]);
  });
  return overlays.map((overlay, index) => {
    const { sequence } = facts[index]!;
    const group = sequence === null ? undefined : groups.get(sequence);
    if (!group) return overlay;
    const sizes = group.map((item) => item.appearance.size).sort((a, b) => a - b);
    return {
      ...overlay,
      role: most(group.map((item) => item.role)),
      styleKey: most(group.map((item) => item.styleKey)),
      appearance: {
        ...overlay.appearance,
        size: sizes[sizes.length >> 1]!,
        align: most(group.map((item) => item.appearance.align)),
      },
    };
  });
}

/** The kept overlays, every reading's record and the sequences among them, from what the text pass read. */
export async function judgeReadText(
  ctx: StepContext,
  firstRead: { readonly overlays: readonly TextOverlay[]; readonly evidence: readonly TextEvidence[] },
  options: {
    /** The frames shots start at (not 0). */
    readonly cuts: readonly number[];
    /** The picture's width over its height. */
    readonly aspect: number;
    readonly subjects: ReelSubjects | null;
    /** LYR1: ids for the pieces a sequence's place gives when read again; without it nothing is read again. */
    readonly newId?: () => TextOverlay['id'];
  },
): Promise<{
  overlays: TextOverlay[];
  regions: DraftTextRegion[];
  sequences: DraftTextSequence[];
  warnings: string[];
}> {
  const weigh = { cuts: options.cuts, total: ctx.total, rate: ctx.rate, config: ctx.config.textScene };
  const again = options.newId
    ? await rereadSequences(ctx, firstRead, { cuts: options.cuts, newId: options.newId })
    : null;
  const unread = new Set(again?.unread ?? []);
  const facts = factsFor(again?.overlays ?? firstRead.overlays, weigh);
  const read = {
    overlays: oneLook(again?.overlays ?? firstRead.overlays, facts),
    evidence: again?.evidence ?? firstRead.evidence,
  };
  // Each site (the readings at one place in one shot) is measured once, over all their time, in the median of its
  // readings' boxes: a sign read three ways drifts as one sign, a long baseline shows a slow handheld drift, and
  // one odd box (a reading that took in a shoulder) doesn't decide it. A sequence's pieces are measured one by one.
  const keys = facts.map((fact, index) => (fact.sequence === null ? `site ${fact.site}` : `piece ${index}`));
  const measured = [...new Set(keys)];
  const middle = (values: number[]) => values.sort((a, b) => a - b)[values.length >> 1]!;
  const places = measured.map((key) => {
    const at = keys.flatMap((other, index) => (other === key ? [index] : []));
    const boxes = at.map((index) => read.overlays[index]!.box);
    const left = middle(boxes.map((box) => box.x));
    const top = middle(boxes.map((box) => box.y));
    const right = middle(boxes.map((box) => box.x + box.width));
    const bottom = middle(boxes.map((box) => box.y + box.height));
    const first = facts[at[0]!]!;
    return {
      box: { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) },
      ...(first.sequence === null ? first.siteSpan : first.span),
    };
  });
  const pixels = await measureTextPixels(ctx, places, options.cuts);
  const siteAt = (index: number) => measured.indexOf(keys[index]!);
  const judged: TextRegionJudgement[] = weighText(read.overlays, read.evidence, {
    ...weigh,
    aspect: options.aspect,
    pixels: read.overlays.map((_, index) => pixels.evidence[siteAt(index)] ?? null),
    subjects: options.subjects,
  });
  const frames = read.overlays.map((overlay) => {
    const start = RationalTime.toFrames(overlay.start, ctx.rate, 'round');
    return { start, end: start + RationalTime.toFrames(overlay.duration, ctx.rate, 'round') };
  });
  // The sequences that keep two pieces or more, in the order they start; the records name them by this order.
  const pieces = new Map<number, number[]>();
  judged.forEach((judgement, index) => {
    if (judgement.sequence !== null && verdictOf(judgement) !== 'scene')
      pieces.set(judgement.sequence, [...(pieces.get(judgement.sequence) ?? []), index]);
  });
  const kept = [...pieces.entries()]
    .filter(([, members]) => members.length >= 2)
    .map(([at, members]) => ({ at, members: members.sort((a, b) => frames[a]!.start - frames[b]!.start) }))
    .sort((a, b) => frames[a.members[0]!]!.start - frames[b.members[0]!]!.start);
  const numberOf = new Map(kept.map((sequence, number) => [sequence.at, number]));
  const sequences: DraftTextSequence[] = kept.slice(0, 16).map(({ members }) => ({
    overlayIds: members.slice(0, 200).map((index) => read.overlays[index]!.id),
    zone: unionBox(members.map((index) => read.overlays[index]!.box)),
    start: Math.min(...members.map((index) => frames[index]!.start)),
    end: Math.max(...members.map((index) => frames[index]!.end)),
    unread: members.flatMap((index) =>
      unread.has(read.overlays[index]!.id) ? [read.overlays[index]!.id] : [],
    ),
  }));
  const overlays: TextOverlay[] = [];
  const regions: DraftTextRegion[] = [];
  for (const [index, overlay] of read.overlays.entries()) {
    const judgement = judged[index]!;
    const verdict = verdictOf(judgement);
    const crop = pixels.context[siteAt(index)];
    const saved = verdict === 'maybeScene' && crop ? await saveCrop(ctx.dir, overlay.id, crop) : null;
    const { start } = frames[index]!;
    const sequence = judgement.sequence === null ? undefined : numberOf.get(judgement.sequence);
    const within = judgement.within === null ? undefined : numberOf.get(judgement.within);
    regions.push({
      overlayId: verdict === 'scene' ? null : overlay.id,
      text: overlay.text,
      box: overlay.box,
      start,
      end: frames[index]!.end,
      kind: judgement.kind,
      score: judgement.score,
      sceneProbability: judgement.sceneProbability,
      signals: judgement.signals,
      lean: judgement.lean,
      site: judgement.site,
      ...(saved ? { crop: saved } : {}),
      ...(sequence !== undefined && sequence < 16 ? { sequence } : {}),
      ...(within !== undefined && within < 16 ? { within } : {}),
    });
    if (verdict === 'scene') continue;
    // A piece no frame could read is asked about too: a text has no other doubt, and a made video leaves it out.
    const doubt: Doubt = { reason: 'textMaybeScene', confidence: judgement.sceneProbability };
    overlays.push(
      verdict === 'maybeScene' || unread.has(overlay.id) ? { ...overlay, doubts: [doubt] } : overlay,
    );
  }
  const sheets = await makeSequenceSheets(ctx, sequences, overlays);
  return {
    overlays,
    regions: regions.slice(0, 500),
    sequences: sheets.sequences,
    warnings: [...(again?.warnings ?? []), ...pixels.warnings, ...sheets.warnings],
  };
}
