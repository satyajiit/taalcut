// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What the review asks the person to check (BRK1, contract §1): the doubts the breakdown wrote, in one list, the
 * whole reel's first, then the slots' and their text's in time order. A doubt is left while its slot waits for
 * approval (a slot's own and its text's) or until it is dismissed or its item is gone (the reel's); the count says
 * what is left, beside how many slots are approved.
 */
import type { I18n, MessageDescriptor } from '@lingui/core';
import { msg, plural } from '@lingui/core/macro';
import type { DoubtReason, Id, Template } from '@taalcut/core';
import { listOf } from '#lib/format';

export type CheckTarget =
  | { readonly kind: 'reel' }
  | { readonly kind: 'slot'; readonly slotId: Id<'TemplateSlot'> }
  | {
      readonly kind: 'text';
      readonly overlayId: Id<'TextOverlay'>;
      readonly slotId: Id<'TemplateSlot'> | null;
    };

export interface CheckItem {
  /** Stable across versions while the item and its reason last: `<kind>:<id>:<reason>`. */
  readonly key: string;
  readonly target: CheckTarget;
  readonly reason: DoubtReason;
  readonly confidence: number | null;
}

/** Every doubt still left, in the order the review steps through them. */
export function checkItems(template: Template): CheckItem[] {
  const items: CheckItem[] = (template.doubts ?? []).map((doubt) => ({
    key: `reel::${doubt.reason}`,
    target: { kind: 'reel' },
    reason: doubt.reason,
    confidence: doubt.confidence ?? null,
  }));
  for (const slot of template.slots) {
    // Approving a slot answers its own doubts, not its text's: a line that may be part of the scene reaches a
    // video only once someone says it is text (core: template.slot.approve).
    for (const doubt of slot.approved ? [] : (slot.doubts ?? []))
      items.push({
        key: `slot:${slot.id}:${doubt.reason}`,
        target: { kind: 'slot', slotId: slot.id },
        reason: doubt.reason,
        confidence: doubt.confidence ?? null,
      });
    for (const text of template.text) {
      if (text.slotId !== slot.id) continue;
      for (const doubt of text.doubts ?? [])
        items.push({
          key: `text:${text.id}:${doubt.reason}`,
          target: { kind: 'text', overlayId: text.id, slotId: text.slotId },
          reason: doubt.reason,
          confidence: doubt.confidence ?? null,
        });
    }
  }
  // Text the breakdown placed in no slot is checked last.
  for (const text of template.text) {
    if (text.slotId !== null && template.slots.some((slot) => slot.id === text.slotId)) continue;
    for (const doubt of text.doubts ?? [])
      items.push({
        key: `text:${text.id}:${doubt.reason}`,
        target: { kind: 'text', overlayId: text.id, slotId: null },
        reason: doubt.reason,
        confidence: doubt.confidence ?? null,
      });
  }
  return items;
}

/** The slot an item is about (a text item's slot), or null for the whole reel. */
export function itemSlot(item: CheckItem): Id<'TemplateSlot'> | null {
  return item.target.kind === 'reel' ? null : item.target.slotId;
}

/**
 * The next item to check after `key` (or before it, `step` −1), going round; the first (or last) when `key` is no
 * longer in the list. Null when nothing is left.
 */
export function stepItem(items: readonly CheckItem[], key: string | null, step: 1 | -1): CheckItem | null {
  if (items.length === 0) return null;
  const at = key === null ? -1 : items.findIndex((item) => item.key === key);
  if (at < 0) return step === 1 ? items[0]! : items[items.length - 1]!;
  return items[(at + step + items.length) % items.length]!;
}

export interface ReviewCounts {
  readonly toCheck: number;
  readonly approved: number;
  readonly waiting: number;
}

export function reviewCounts(template: Template, items: readonly CheckItem[]): ReviewCounts {
  const approved = template.slots.filter((slot) => slot.approved).length;
  return { toCheck: items.length, approved, waiting: template.slots.length - approved };
}

/** What a doubt asks, as the review's line says it. */
export const DOUBT_WORDS: Readonly<Record<DoubtReason, MessageDescriptor>> = {
  cutUnsure: msg`Taalcut isn’t sure this is a cut`,
  cutMaybeTransition: msg`This may be one shot with a transition, not a cut`,
  fadeTail: msg`This slot is mostly a fade to black or white`,
  intentVague: msg`The description doesn’t say what moves`,
  intentGeneralised: msg`Taalcut took the reel’s place names out of this description`,
  motionUnsure: msg`Taalcut isn’t sure how the camera moves`,
  textMaybeScene: msg`This may be part of the scene, not text on top`,
  speechMaybeHallucinated: msg`The speech may be misheard over the music`,
  tempoMaybeHalfOrDouble: msg`The beat may be twice as fast or half as fast`,
  soundCreditMissing: msg`The reel doesn’t say whose sound it is`,
};

type Group = 'cut' | 'slot' | 'description' | 'camera' | 'text' | 'sound';
const GROUP: Readonly<Record<DoubtReason, Group>> = {
  cutUnsure: 'cut',
  cutMaybeTransition: 'cut',
  fadeTail: 'slot',
  intentVague: 'description',
  intentGeneralised: 'description',
  motionUnsure: 'camera',
  textMaybeScene: 'text',
  speechMaybeHallucinated: 'sound',
  tempoMaybeHalfOrDouble: 'sound',
  soundCreditMissing: 'sound',
};

/** "2 cuts Taalcut isn’t sure of, 1 vague description": what is left, by kind, for the card's one line. */
export function checkSummary(i18n: I18n, items: readonly CheckItem[]): string {
  const counts = new Map<Group, number>();
  for (const item of items) counts.set(GROUP[item.reason], (counts.get(GROUP[item.reason]) ?? 0) + 1);
  const words: Record<Group, (n: number) => string> = {
    cut: (n) =>
      i18n._(
        msg`${plural(n, { one: '# cut Taalcut isn’t sure of', other: '# cuts Taalcut isn’t sure of' })}`,
      ),
    slot: (n) =>
      i18n._(msg`${plural(n, { one: '# slot that may be a fade', other: '# slots that may be fades' })}`),
    description: (n) =>
      i18n._(msg`${plural(n, { one: '# vague description', other: '# vague descriptions' })}`),
    camera: (n) =>
      i18n._(
        msg`${plural(n, {
          one: '# camera move Taalcut isn’t sure of',
          other: '# camera moves Taalcut isn’t sure of',
        })}`,
      ),
    text: (n) =>
      i18n._(
        msg`${plural(n, {
          one: '# line of text that may be part of the scene',
          other: '# lines of text that may be part of the scene',
        })}`,
      ),
    sound: (n) =>
      i18n._(msg`${plural(n, { one: '# thing about the sound', other: '# things about the sound' })}`),
  };
  const order: Group[] = ['cut', 'slot', 'description', 'camera', 'text', 'sound'];
  return listOf(
    i18n,
    order.flatMap((group) => {
      const n = counts.get(group);
      return n ? [words[group](n)] : [];
    }),
  );
}
