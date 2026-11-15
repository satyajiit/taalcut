// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * MATCH1: a slot's stated moment (`lands`, core's slot-landing.ts) through the edits that make or remove a slot's
 * edge. The statement is about one edge: the instant of the footage that falls on the slot's start or its end. An
 * edit that gives the slot another edge there (a split, a merge, a neighbour dropped into it) takes the statement
 * with the edge; moving a cut keeps it, since the edge is the same cut at another frame.
 */
import type { SlotEdge, TemplateSlot } from '@taalcut/core';

/** The slot without a moment stated for `edge`. */
export function withoutLandsOn<T extends Pick<TemplateSlot, 'lands'>>(slot: T, edge: SlotEdge): T {
  if (slot.lands?.edge !== edge) return slot;
  const { lands: _lands, ...rest } = slot;
  return rest as T;
}

/** The moment a merged run of slots still has an edge for: the first slot's start, else the last slot's end. */
export function mergedLands(first: TemplateSlot, last: TemplateSlot): Pick<TemplateSlot, 'lands'> {
  if (first.lands?.edge === 'start') return { lands: first.lands };
  return last.lands?.edge === 'end' ? { lands: last.lands } : {};
}
