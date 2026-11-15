// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A sequence's place read again (LYR1): the read. Each chain the first pass found whose words are mostly unrelated
 * (text-sequence.ts) has its place cut out and read on every frame at each enlargement the config names
 * (`BreakdownVision.ocrRegion`), over its time and a margin either side, and further out while its words still show
 * at the edge of what was read. The pieces that come of it (text-zone.ts) take the place of the chain's readings
 * only when they are text replacing itself (`isReplacing`); anything else keeps what the first pass read. Optional:
 * without `ocrRegion` the text comes back as it was.
 */
import type { Box, TextOverlay } from '@taalcut/core';
import type { OcrRegionPage } from './ports';
import type { StepContext } from './steps';
import { overlayFromTrack } from './text-overlay';
import type { TextEvidence } from './text-scene';
import {
  isReplacing,
  sequenceRuleFor,
  textChains,
  type PlacedText,
  type SequenceRule,
  type TextChain,
} from './text-sequence';
import { textSimilarity } from './text-track';
import { sequenceRun, settleCase } from './text-zone-run';
import { UNREAD_TEXT, zoneFrames, zonePieces, type ZoneOptions, type ZonePiece } from './text-zone';
import { refinePlace, zonePlace, type ZonePlace } from './text-zone-place';

/** Chains read again per reel, the surest and longest first. */
export const MAX_ZONES = 3;
/** Links between words less alike than this are between unrelated words (text-sites.ts's floor). */
const ALIKE = 0.4;

const placed = (piece: ZonePiece): PlacedText => ({
  text: piece.text ?? UNREAD_TEXT,
  box: piece.box,
  start: piece.start,
  end: piece.end,
});

/** Whether a chain could be text replacing itself: at least half its links are between unrelated words. */
function worthReading(chain: TextChain, texts: readonly PlacedText[]): boolean {
  const words = chain.members.map((index) => texts[index]!.text);
  const unrelated = words.slice(1).filter((word, at) => textSimilarity(words[at]!, word) < ALIKE).length;
  return unrelated * 2 >= words.length - 1;
}

/** Reads a chain's place over its time and beyond while it grows; the sequence's pieces, or null to keep the chain. */
async function rereadChain(
  ctx: StepContext,
  chain: TextChain,
  place: ZonePlace,
  cuts: readonly number[],
  rule: SequenceRule,
): Promise<{ pieces: ZonePiece[]; warning?: string } | null> {
  const { config, rate, total, signal } = ctx;
  const ocrRegion = ctx.analysers.vision.ocrRegion!;
  const zone = config.textScene.sequence.zone;
  const fps = rate.num / rate.den;
  const step = Math.max(1, Math.round(fps / zone.fps));
  const margin = Math.max(step, Math.round(zone.marginSeconds * fps));
  const options: ZoneOptions = {
    cuts,
    minConfidence: config.text.minConfidence,
    sizeRatio: config.textScene.sequence.sizeRatio,
    changeRatio: zone.changeRatio,
    tinyFrames: rule.gapFrames,
  };
  const reads = zone.scales.map(() => new Map<number, OcrRegionPage>());
  const aligned = (frame: number) => frame - (frame % step);
  let from = Math.max(0, aligned(chain.start - margin));
  let to = Math.min(total, chain.end + margin);
  let run: ZonePiece[] = [];
  for (;;) {
    const have = reads[0]!;
    // Every frame not yet read, and the read frames beside them: a frame's change is measured from the frame asked
    // just before it, so a stretch read later starts from a frame already known and ends on one.
    const unreadAt = (frame: number) => frame >= from && frame < to && !have.has(frame);
    const frames: number[] = [];
    for (let frame = from; frame < to; frame += step)
      if (unreadAt(frame) || unreadAt(frame - step) || unreadAt(frame + step)) frames.push(frame);
    const fresh = frames.filter((frame) => !have.has(frame)).length;
    if (fresh > 0) {
      if (have.size + fresh > zone.maxFrames) break;
      for (const [at, scale] of zone.scales.entries()) {
        const read = await ocrRegion(ctx.path, {
          rate,
          frames,
          region: place.region,
          watch: place.watch,
          scale,
          languages: config.text.languages,
          signal,
        });
        if (!read.ok)
          return run.length > 0 ? { pieces: run, warning: `text_zone_failed: ${read.error.code}` } : null;
        read.value.forEach((page, index) => {
          // A page's change is from the frame asked before it: kept only where that is the frame before it.
          const follows = index > 0 && read.value[index - 1]!.frame === page.frame - step;
          const known = reads[at]!.get(page.frame);
          if (!known) reads[at]!.set(page.frame, follows ? page : { ...page, change: 0 });
          else if (follows && known.change === 0)
            reads[at]!.set(page.frame, { ...known, change: page.change });
        });
      }
    }
    const seen = zoneFrames(reads.map((pages) => [...pages.values()]));
    run = sequenceRun(zonePieces(seen, place, options), chain, rule);
    // Once more with the anchors the words just read kept (text-zone-place.ts).
    const read = run.filter((piece) => piece.text !== null).map((piece) => piece.box);
    const refined = refinePlace(place, read);
    if (refined !== place) run = sequenceRun(zonePieces(seen, refined, options), chain, rule);
    const first = run[0];
    const last = run[run.length - 1];
    if (!first || !last) return null;
    // Still showing at the edge of what was read: the sequence goes on beyond it.
    const earlier = first.start <= from + step && from > 0;
    const later = last.end >= to - step && to < total;
    if ((!earlier && !later) || fresh === 0) break;
    if (earlier) from = Math.max(0, aligned(from - margin));
    if (later) to = Math.min(total, to + margin);
  }
  return { pieces: settleCase(run) };
}

/**
 * The text as read, with each sequence's first-pass readings swapped for the pieces its place gave when read again.
 * `unread` are the ids of pieces too few frames read. Without `ocrRegion`, or when nothing chains, the text comes
 * back as it was.
 */
export async function rereadSequences(
  ctx: StepContext,
  read: { readonly overlays: readonly TextOverlay[]; readonly evidence: readonly TextEvidence[] },
  options: { readonly cuts: readonly number[]; readonly newId: () => TextOverlay['id'] },
): Promise<{ overlays: TextOverlay[]; evidence: TextEvidence[]; unread: string[]; warnings: string[] }> {
  const unread: string[] = [];
  const warnings: string[] = [];
  const asRead = { overlays: [...read.overlays], evidence: [...read.evidence], unread, warnings };
  if (!ctx.analysers.vision.ocrRegion) return asRead;
  const { rate, config } = ctx;
  const rule = sequenceRuleFor(config.textScene.sequence, rate);
  const near = config.textScene.shotEdgeFrames;
  const texts: PlacedText[] = read.overlays.map((overlay) => ({
    text: overlay.text,
    box: overlay.box,
    start: overlay.start.value,
    end: overlay.start.value + overlay.duration.value,
  }));
  const sure = (chain: TextChain) => isReplacing(chain, texts, { cuts: options.cuts, near, rule });
  const chains = textChains(texts, rule)
    .filter((chain) => worthReading(chain, texts))
    .sort((a, b) => Number(sure(b)) - Number(sure(a)) || b.members.length - a.members.length)
    .slice(0, MAX_ZONES);
  const gone = new Set<number>();
  const added: { overlay: TextOverlay; evidence: TextEvidence }[] = [];
  const taken: { start: number; end: number; zone: Box }[] = [];
  for (const chain of chains) {
    if (ctx.signal.aborted) break;
    // A chain inside a place and time already read again is that sequence, seen twice by the first pass.
    const within = (t: { start: number; end: number; zone: Box }) =>
      chain.start >= t.start &&
      chain.end <= t.end &&
      chain.zone.y < t.zone.y + t.zone.height &&
      chain.zone.y + chain.zone.height > t.zone.y;
    if (taken.some(within)) continue;
    const place = zonePlace(chain.members.map((index) => texts[index]!.box));
    const reread = await rereadChain(ctx, chain, place, options.cuts, rule);
    if (!reread) continue;
    if (reread.warning) warnings.push(reread.warning);
    const pieces = reread.pieces.map(placed);
    const run = textChains(pieces, rule).find((found) => found.members.length === pieces.length);
    // Only text replacing itself takes the second read; anything else keeps what the first pass read.
    if (!run || !isReplacing(run, pieces, { cuts: options.cuts, near, rule })) continue;
    for (const index of chain.members) gone.add(index);
    taken.push({ start: run.start, end: run.end, zone: run.zone });
    for (const piece of reread.pieces) {
      const overlay = overlayFromTrack(
        {
          text: piece.text ?? UNREAD_TEXT,
          box: piece.box,
          first: piece.start,
          last: piece.end - 1,
          before: null,
          after: null,
          samples: piece.samples,
          confidence: piece.confidence,
          language: piece.language,
          wordByWord: false,
          drift: piece.drift,
          ...(piece.quad ? { quad: piece.quad } : {}),
        },
        { start: piece.start, end: piece.end, rate },
        options.newId(),
      );
      if (piece.text === null) unread.push(overlay.id);
      const evidence = { samples: Math.max(1, piece.samples), drift: piece.drift, block: 0 };
      added.push({ overlay, evidence: piece.quad ? { ...evidence, quad: piece.quad } : evidence });
    }
  }
  const all = [
    ...read.overlays.map((overlay, index) => ({ overlay, evidence: read.evidence[index]!, index })),
    ...added.map((item) => ({ ...item, index: -1 })),
  ]
    .filter((item) => !gone.has(item.index))
    .sort((a, b) => a.overlay.start.value - b.overlay.start.value || a.overlay.box.y - b.overlay.box.y);
  return {
    overlays: all.map((item) => item.overlay),
    evidence: all.map((item) => item.evidence),
    unread,
    warnings,
  };
}
