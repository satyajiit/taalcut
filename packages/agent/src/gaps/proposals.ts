// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Fixes per gap (SPEC section 26, P3-B8), pure: what each gap can get from what is available now, and the
 * fix applied when the user isn't asked. Film and drop are always offered; a generated still only with an
 * image path (never under Local only); stock only when its tool is registered. FIX-GAPS: a weak pick also gets
 * swap (its next-best candidates by fit, when it has any) and keep, first. FIX-ASK: then the clip another shot has
 * (borrow) and another part of a used clip (reuse) when the reader found them, and Add more clips when the
 * person's new clips can be cast (trades.ts).
 */
import { RationalTime, type GAP_FIX_UNAVAILABLE, type GapFixKind, type GapFixOption } from '@taalcut/core';
import type { BorrowShot, GapRow, GapSlot, GapTimeline, ImagePath, StockPath, SwapTarget } from './gap-types';
import { borrowOf, defaultBorrow, tradeOptions, Trades } from './trades';

export type GapFixUnavailable = (typeof GAP_FIX_UNAVAILABLE)[number];

export interface ProposalInput {
  readonly image: ImagePath;
  readonly stock: StockPath;
  /** FIX-ASK: the person's new clips can be waited for and cast (the composition root has the port). */
  readonly addClips?: boolean;
}

export interface SlotProposal {
  readonly options: GapFixOption[];
  readonly unavailable: { kind: GapFixKind; reason: GapFixUnavailable }[];
}

const usd = (amount: number) => ({ currency: 'USD', micros: Math.round(amount * 1_000_000) });

/** The words a gap's intent gives, or a plain description of the slot when the template has none. */
export function intentText(slot: Pick<GapSlot, 'intent' | 'number'>): string {
  return slot.intent?.text.trim() || `a shot for slot ${slot.number}`;
}

/**
 * What the still should show: the slot's intent, in the format's frame, never a real person's likeness
 * (SOUL.md's boundaries). Plain text the card shows and the image model gets.
 */
export function imagePrompt(slot: Pick<GapSlot, 'intent' | 'number'>): string {
  const shot = slot.intent?.shotType ? `${slot.intent.shotType} shot` : 'shot';
  const motion = slot.intent?.motion && slot.intent.motion !== 'static' ? `, ${slot.intent.motion}` : '';
  const what = intentText(slot).slice(0, 300);
  return `A vertical 9:16 still for a short video, ${shot}${motion}: ${what}. No real person's face or likeness, no text, no logos.`.slice(
    0,
    500,
  );
}

/** Search words for stock footage: the intent's own words. */
export function stockQuery(slot: Pick<GapSlot, 'intent' | 'number'>): string {
  return intentText(slot).slice(0, 200);
}

/** FIX-GAPS: a weak pick's own fixes: swap to a next-best candidate (when there is one), or keep the clip. */
function weakOptions(slot: GapSlot): GapFixOption[] {
  if (slot.state !== 'weak' || !slot.weak) return [];
  const candidates = slot.weak.candidates.slice(0, 3).map((c) => ({
    assetId: c.assetId,
    shotId: c.shotId,
    description: c.description?.slice(0, 300) ?? null,
    fit: c.fit,
  }));
  return [
    ...(candidates.length > 0 ? [{ kind: 'swap' as const, candidates } as GapFixOption] : []),
    { kind: 'keep' },
  ];
}

export function proposeFixes(slot: GapSlot, timeline: GapTimeline, input: ProposalInput): SlotProposal {
  const options: GapFixOption[] = [
    ...weakOptions(slot),
    ...tradeOptions(slot),
    ...(input.addClips ? [{ kind: 'addClips' } as GapFixOption] : []),
    { kind: 'film' },
  ];
  const unavailable: SlotProposal['unavailable'] = [];
  if (input.image.ok)
    options.push({
      kind: 'generate',
      provider: input.image.provider,
      model: input.image.model,
      estimate: usd(input.image.usdPerImage),
      prompt: imagePrompt(slot),
    });
  else
    unavailable.push({
      kind: 'generate',
      reason: input.image.reason === 'localOnly' ? 'localOnly' : 'noImageModel',
    });
  if (input.stock.ok) options.push({ kind: 'stock', query: stockQuery(slot) });
  else unavailable.push({ kind: 'stock', reason: input.stock.reason });
  options.push({ kind: 'drop', newDuration: RationalTime.subtract(timeline.duration, slot.duration) });
  return { options, unavailable };
}

export interface DefaultInput {
  /** What the project's cap leaves to spend; null when it has no cap. */
  readonly budgetLeftUsd: number | null;
}

/** A gap's fix, why, and for a swap the candidate it takes (FIX-ASK: for a borrow, the clip and its trade). */
export interface ChosenFix {
  readonly fix: GapFixKind;
  readonly why: string;
  readonly swapTo?: SwapTarget;
  readonly borrow?: BorrowShot;
}

/**
 * The fix applied at "Only before render" and on autopilot (SPEC section 26): a weak pick swaps to the candidate
 * that clearly fits better (FIX-GAPS), else it stays as it is (it isn't black, and replacing footage the user has
 * with a worse fit is a bigger change than the gap needs); an empty slot is dropped when it isn't the hook and the
 * video stays within the format's minimum length, else filled with a generated still when one is offered and fits
 * the cap, else dropped with a note.
 */
export function chooseDefaults(
  timeline: GapTimeline,
  rows: readonly { slot: GapSlot; proposal: SlotProposal }[],
  input: DefaultInput,
): Map<string, ChosenFix> {
  const chosen = new Map<string, ChosenFix>();
  const running: Running = { length: timeline.duration, left: input.budgetLeftUsd, trades: new Trades() };
  // A shot that gives its clip to a borrow keeps its own default here; settleTrades takes it out of the rows.
  for (const { slot, proposal } of rows)
    chosen.set(slot.gapId, defaultFor(timeline, slot, proposal, running));
  return chosen;
}

/** The video's length, the budget left and the trades made by the defaults chosen so far. */
interface Running {
  length: RationalTime;
  left: number | null;
  readonly trades: Trades;
}

/** FIX-ASK: the default borrow, if one is clear of the trades so far (trades.ts). */
function borrowFor(slot: GapSlot, proposal: SlotProposal, running: Running): ChosenFix | undefined {
  if (!proposal.options.some((o) => o.kind === 'borrow')) return undefined;
  const shot = defaultBorrow(slot, running.trades);
  if (!shot) return undefined;
  const swapTo = { assetId: shot.assetId, shotId: shot.shotId };
  running.trades.take(slot.gapId, borrowOf(shot), swapTo);
  return {
    fix: 'borrow',
    why: `Shot ${shot.from.number}'s clip fits this one clearly better; that shot takes another clip instead.`,
    swapTo,
    borrow: shot,
  };
}

/** One slot's default, in the order chooseDefaults describes; a drop shortens `running`, a still spends it. */
function defaultFor(
  timeline: GapTimeline,
  slot: GapSlot,
  proposal: SlotProposal,
  running: Running,
): ChosenFix {
  if (slot.state === 'weak') {
    const better = slot.weak?.better;
    if (better && proposal.options.some((o) => o.kind === 'swap'))
      return {
        fix: 'swap',
        why: 'Another clip fits this slot clearly better.',
        swapTo: { assetId: better.assetId, shotId: better.shotId },
      };
    return (
      borrowFor(slot, proposal, running) ?? {
        fix: 'keep',
        why: 'No other clip fits this slot better, so the pick stays as it is.',
      }
    );
  }
  // FIX-ASK: another shot's clip keeps the video whole when it fits here and the trade fits better overall.
  const borrowed = borrowFor(slot, proposal, running);
  if (borrowed) return borrowed;
  const after = RationalTime.subtract(running.length, slot.duration);
  const fitsLength = !timeline.minDuration || !RationalTime.isBefore(after, timeline.minDuration);
  const hook = slot.number === 1;
  if (!hook && fitsLength) {
    running.length = after;
    return { fix: 'drop', why: 'Dropping it keeps the video long enough.' };
  }
  const cost = stillCost(proposal);
  if (cost !== undefined && (running.left === null || cost <= running.left)) {
    if (running.left !== null) running.left -= cost;
    return {
      fix: 'generate',
      why: hook ? 'The hook needs a picture.' : 'Dropping it would make the video too short.',
    };
  }
  running.length = after;
  return {
    fix: 'drop',
    why: hook
      ? 'No still can be made now, so the hook is dropped and the next shot opens the video.'
      : 'No still can be made now, so it is dropped even though the video gets shorter than the format.',
  };
}

/** The offered still's estimate in US dollars; undefined when no still is offered. */
function stillCost(proposal: SlotProposal): number | undefined {
  const generate = proposal.options.find((o) => o.kind === 'generate');
  return generate?.kind === 'generate' ? generate.estimate.micros / 1_000_000 : undefined;
}

/** A gap's row for the skill: the default unless the user answered (a declined question films every gap). */
export function gapRow(timelineId: string, slot: GapSlot, proposal: SlotProposal, chosen: ChosenFix): GapRow {
  const fixes = proposal.options.map((o) => o.kind);
  const generate = proposal.options.find((o) => o.kind === 'generate');
  const stock = proposal.options.find((o) => o.kind === 'stock');
  return {
    timelineId,
    gapId: slot.gapId,
    slotId: slot.slotId,
    number: slot.number,
    state: slot.state === 'weak' ? 'weak' : 'empty',
    intent: slot.intent?.text.trim() ?? '',
    fixes,
    fix: chosen.fix,
    ...(generate?.kind === 'generate' ? { prompt: generate.prompt } : {}),
    ...(stock?.kind === 'stock' ? { query: stock.query } : {}),
    ...(chosen.fix === 'swap' && chosen.swapTo ? { swapTo: chosen.swapTo } : {}),
    ...(chosen.fix === 'borrow' && chosen.swapTo && chosen.borrow
      ? { swapTo: chosen.swapTo, borrow: borrowOf(chosen.borrow) }
      : {}),
    why: chosen.why,
  };
}

/**
 * Gaps a timeline still has: its empty slots, and (FIX-GAPS) its weak picks, which the timeline lane's rule
 * reports. A weak pick's default swaps only to a clip that clearly fits better, else keeps it (chooseDefaults).
 */
export function openSlots(timeline: GapTimeline): GapSlot[] {
  return timeline.slots.filter((slot) => slot.state === 'empty' || slot.state === 'weak');
}
