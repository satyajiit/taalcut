// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Lines fitted to slots before anything is paid for (SPEC P3.3 step 1), pure. A line's spoken length is its word
 * count at the language's rate; its span is its slot plus up to half of the next slot when that slot has no
 * line. A line over by more than 15 % comes back with `overByMs` and a suggested word count, so the skill
 * shortens it first.
 */
import type { SlotId } from '@taalcut/core';
import { VOICE_CONFIG, wordsPerSecond } from './config';
import type { SlotSpan } from './slots';

export interface ScriptLine {
  readonly text: string;
  readonly slotId?: SlotId | null;
}

export interface LineFit {
  readonly slotId: SlotId | null;
  readonly estimatedMs: number;
  /** The span the line may use, ms (0 when it has no slot to sit in). */
  readonly slotMs: number;
  /** How far past its span, ms; 0 when it fits within the tolerance. */
  readonly overByMs: number;
  readonly suggestedWords?: number;
}

/** Spoken words (Intl.Segmenter's word-like segments), audio tags such as [whispers] left out. */
export function countWords(text: string, language: string): number {
  const spoken = text.replace(/\[[^\]]*\]/g, ' ');
  const segmenter = new Intl.Segmenter(language, { granularity: 'word' });
  let words = 0;
  for (const segment of segmenter.segment(spoken)) if (segment.isWordLike) words += 1;
  return words;
}

/** Each line's slot: its own when given, else the next slot no other line took, in order. */
export function assignSlots(lines: readonly ScriptLine[], slots: readonly SlotSpan[]): (SlotId | null)[] {
  const taken = new Set(lines.map((l) => l.slotId).filter((s): s is SlotId => Boolean(s)));
  let cursor = 0;
  return lines.map((line) => {
    if (line.slotId) {
      const index = slots.findIndex((s) => s.slotId === line.slotId);
      if (index >= 0) cursor = Math.max(cursor, index + 1);
      return line.slotId;
    }
    while (cursor < slots.length && taken.has(slots[cursor]?.slotId ?? ('' as SlotId))) cursor += 1;
    const slot = slots[cursor];
    cursor += 1;
    if (!slot) return null;
    taken.add(slot.slotId);
    return slot.slotId;
  });
}

export function fitScript(input: {
  readonly lines: readonly ScriptLine[];
  readonly language: string;
  readonly slots: readonly SlotSpan[];
  readonly frameMs: number;
}): LineFit[] {
  const rate = wordsPerSecond(input.language);
  const assigned = assignSlots(input.lines, input.slots);
  const used = new Set(assigned.filter((s): s is SlotId => s !== null));
  return input.lines.map((line, i) => {
    const slotId = assigned[i] ?? null;
    const estimatedMs = Math.round((countWords(line.text, input.language) / rate) * 1000);
    const index = input.slots.findIndex((s) => s.slotId === slotId);
    const slot = input.slots[index];
    if (!slot) return { slotId, estimatedMs, slotMs: 0, overByMs: estimatedMs };
    const next = input.slots[index + 1];
    const spill =
      next && !used.has(next.slotId) ? (next.endFrame - next.startFrame) * VOICE_CONFIG.spillMax : 0;
    const slotMs = Math.round((slot.endFrame - slot.startFrame + spill) * input.frameMs);
    const over = estimatedMs - slotMs;
    if (over <= slotMs * VOICE_CONFIG.overTolerance) return { slotId, estimatedMs, slotMs, overByMs: 0 };
    return {
      slotId,
      estimatedMs,
      slotMs,
      overByMs: over,
      suggestedWords: Math.max(1, Math.floor((slotMs / 1000) * rate)),
    };
  });
}
