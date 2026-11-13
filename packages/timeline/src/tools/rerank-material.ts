// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What the Librarian's rerank needs, in `timeline.cast`'s answer (FIX-LIBRARIAN): the few unsure slots worth a
 * second look, each with its intent and its candidates as indexing described them, so the model reorders them by
 * reading, in the turn it reads the cast. A look at every unsure slot of a big template doesn't fit a step's turns
 * (the owner's had 11), so the least confident come first, at most RERANK_SLOTS. No frame is extracted or sent
 * anywhere: the descriptions are the ones the library already stores.
 *
 * FIX-STORY: a slot with no alternate (a library with no spare shot) lists the other slots' picks that could
 * change places with its own, each with the slot it would leave and that slot's intent (casting/swaps.ts): put
 * first, one swaps the two slots. A slot under graphics says their kinds: a chat wants someone on a phone.
 */
import {
  type AsyncResult,
  type ShotId,
  type SlotCast,
  type Template,
  type TemplateSlot,
} from '@taalcut/core';
import type { CastResult } from '../casting/engine';
import type { CastVariant } from '../casting/result';
import { slotGraphicKinds } from '../casting/slot-graphics';
import type { GraphicKind } from '../casting/terms';

/** Unsure slots one cast lists for a rerank. */
export const RERANK_SLOTS = 3;
/** Each text is cut to this, so the cast's answer stays inline (a tool answer over 8 KiB becomes an artifact). */
const TEXT_CHARS = 200;

/** What indexing said each shot shows, by shot id; shots with no description are left out. */
export type ShotDescriptions = (
  shotIds: readonly ShotId[],
  signal?: AbortSignal,
) => AsyncResult<ReadonlyMap<string, string>>;

export interface RerankSlot {
  readonly slotId: string;
  readonly intent: Pick<TemplateSlot['intent'], 'text' | 'shotType' | 'motion'> & {
    /** The kinds of the graphics over the slot, when there are any. */
    readonly graphics?: GraphicKind[];
  };
  /** The pick first, then the alternates (or, with none, the other slots' picks it could swap with). */
  readonly candidates: {
    readonly shotId: string;
    readonly description: string | null;
    /** A swap: the slot this shot fills now, and that slot's intent; it would take this slot's pick. */
    readonly from?: { readonly slotId: string; readonly intent: string };
  }[];
}

const clip = (text: string) => (text.length > TEXT_CHARS ? `${text.slice(0, TEXT_CHARS - 1)}…` : text);

interface Unsure {
  readonly slot: SlotCast;
  /** Another slot's pick, with that slot, for each shot a swap would bring. */
  readonly swaps: ReadonlyMap<string, string>;
}

const swapsOf = (variant: CastVariant, slotId: string): Map<string, string> =>
  new Map(
    (variant.swaps?.find((entry) => entry.slotId === slotId)?.options ?? []).flatMap((option) =>
      option.candidate.shotId ? [[option.candidate.shotId as string, option.fromSlotId as string]] : [],
    ),
  );

/** Each unsure slot with an alternate or a swap, from the variant where it is least sure; least first. */
function unsureSlots(result: CastResult, template: Template): Unsure[] {
  const order = new Map(template.slots.map((slot, index) => [slot.id as string, index]));
  const least = new Map<string, Unsure>();
  for (const variant of result.variants)
    for (const slot of variant.slots) {
      if (!slot.needsRerank || !slot.pick?.shotId) continue;
      const swaps = swapsOf(variant, slot.slotId);
      if (!slot.alternates.some((a) => a.shotId) && swaps.size === 0) continue;
      const seen = least.get(slot.slotId);
      if (!seen || (slot.confidence ?? 1) < (seen.slot.confidence ?? 1))
        least.set(slot.slotId, { slot, swaps });
    }
  return [...least.values()].sort(
    (a, b) =>
      (a.slot.confidence ?? 1) - (b.slot.confidence ?? 1) ||
      (order.get(a.slot.slotId) ?? 0) - (order.get(b.slot.slotId) ?? 0),
  );
}

/**
 * The cast's rerank list: empty when no description reader is wired, when no unsure slot has an alternate or a
 * swap, for a story cast (it orders by capture time and takes no rerank), or when the descriptions can't be read
 * (the cast never fails for them). A slot is listed only when at least two of its candidates are described: with
 * fewer there is nothing to compare.
 */
export async function rerankMaterial(
  result: CastResult,
  template: Template,
  describe: ShotDescriptions | undefined,
  options: { readonly count: number; readonly signal?: AbortSignal },
): Promise<RerankSlot[]> {
  if (!describe || result.mode === 'story') return [];
  const slots = unsureSlots(result, template);
  if (slots.length === 0) return [];
  const shots = new Map(
    slots.map(({ slot, swaps }) => [
      slot.slotId,
      [
        ...[slot.pick, ...slot.alternates].flatMap((c) => (c?.shotId ? [c.shotId as string] : [])),
        ...swaps.keys(),
      ].slice(0, options.count),
    ]),
  );
  const described = await describe([...new Set([...shots.values()].flat())] as ShotId[], options.signal);
  if (!described.ok) return [];
  const intents = new Map(template.slots.map((slot) => [slot.id as string, slot.intent]));
  const kindsBySlot = slotGraphicKinds(template);
  const graphics = new Map(
    template.slots.map((slot, index) => [slot.id as string, kindsBySlot[index] ?? []]),
  );
  const listed: RerankSlot[] = [];
  for (const { slot, swaps } of slots) {
    const candidates = (shots.get(slot.slotId) ?? []).map((shotId) => {
      const description = described.value.get(shotId);
      const from = swaps.get(shotId);
      return {
        shotId,
        description: description ? clip(description) : null,
        ...(from ? { from: { slotId: from, intent: clip(intents.get(from)?.text ?? '') } } : {}),
      };
    });
    if (candidates.filter((c) => c.description).length < 2) continue;
    const intent = intents.get(slot.slotId);
    const kinds = graphics.get(slot.slotId) ?? [];
    listed.push({
      slotId: slot.slotId,
      intent: {
        text: clip(intent?.text ?? ''),
        shotType: intent?.shotType ?? null,
        motion: intent?.motion ?? null,
        ...(kinds.length > 0 ? { graphics: kinds } : {}),
      },
      candidates,
    });
    if (listed.length === RERANK_SLOTS) break;
  }
  return listed;
}
