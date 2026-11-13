// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** What every pure edit takes and returns (SPEC, "Public API"). */
import { err, ok, type CommandSource, type Result, type Timeline, type TimelineItemId } from '@taalcut/core';
import { ClipLocked, ItemNotFound } from '../errors';
import type { EditConfig } from '../model/config';
import { findPosition, type Position } from '../model/sequence';

/**
 * The parts of a timeline an edit changed: the inverse (`timeline.restore`) puts these back. Timeline v2 (P3)
 * adds the look (`style` is the document's `styleId`), the voiceover, the mix and the template ref.
 */
export const TIMELINE_PARTS = [
  'tracks',
  'markers',
  'cast',
  'beatMap',
  'music',
  'captions',
  'style',
  'voiceover',
  'mix',
  'template',
  /** EDT1-OPS: the whole video's colour grade. */
  'grade',
  'covers',
] as const;
export type TimelinePart = (typeof TIMELINE_PARTS)[number];

export interface EditResult {
  readonly timeline: Timeline;
  readonly changed: readonly TimelinePart[];
}

export interface EditOptions {
  /** Who asked: an agent edit is refused on a clip the user locked. */
  readonly source: CommandSource;
  readonly config?: EditConfig;
  /** Ids for new items and markers. Default: new ULIDs. */
  readonly ids?: () => TimelineItemId;
}

export const unchanged = (timeline: Timeline): Result<EditResult> => ok({ timeline, changed: [] });

/** The V1 position holding clip `clipId`, refusing agents on locked clips. */
export function clipPosition(
  timeline: Timeline,
  clipId: TimelineItemId,
  source: CommandSource,
): Result<Position & { readonly item: Extract<Position['item'], { type: 'clip' }> }> {
  const position = findPosition(timeline, clipId);
  if (!position || position.item.type !== 'clip') return err(ItemNotFound({ itemId: clipId }));
  if (position.item.locked && source === 'agent') return err(ClipLocked({ clipId }));
  return ok(position as Position & { item: Extract<Position['item'], { type: 'clip' }> });
}

/** Agents can't change a locked clip, including as a trim's neighbour. */
export function refuseLocked(item: Position['item'], source: CommandSource): Result<void> {
  if (item.type === 'clip' && item.locked && source === 'agent') return err(ClipLocked({ clipId: item.id }));
  return ok(undefined);
}
