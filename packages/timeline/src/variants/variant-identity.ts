// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A varied draft as a timeline of its own (P3-V3): its id and name ("<base> · Variant k"), the set's new cast id
 * with its index 1…n, revision 1, and fresh item ids (the cast's and the voice lines' clip references follow), so
 * no two timelines share an item.
 */
import type { CastId, Timeline, TimelineId, TimelineItemId, Track } from '@taalcut/core';

export interface VariantIdentity {
  readonly timelineId: TimelineId;
  readonly baseName: string;
  readonly castId: CastId;
  /** 1…count. */
  readonly index: number;
  readonly count: number;
  readonly now: number;
}

const NAME_MAX = 200;

export function variantName(baseName: string, index: number): string {
  const suffix = ` · Variant ${index}`;
  return `${baseName.slice(0, NAME_MAX - suffix.length)}${suffix}`;
}

export function asVariant(draft: Timeline, identity: VariantIdentity, ids: () => TimelineItemId): Timeline {
  const renamed = new Map<string, TimelineItemId>();
  const fresh = <Item extends { readonly id: TimelineItemId }>(item: Item): Item => {
    const id = ids();
    renamed.set(item.id, id);
    return { ...item, id };
  };
  const tracks = draft.tracks.map((track): Track => {
    if (track.kind === 'text') return { ...track, items: track.items.map(fresh) };
    if (track.kind === 'audio') return { ...track, items: track.items.map(fresh) };
    return { ...track, items: track.items.map(fresh) };
  });
  const clipOf = (clipId: TimelineItemId | null) => (clipId ? (renamed.get(clipId) ?? null) : null);
  return {
    ...draft,
    id: identity.timelineId,
    name: variantName(identity.baseName, identity.index),
    revision: 1,
    tracks,
    markers: draft.markers.map(fresh),
    cast: draft.cast && {
      ...draft.cast,
      castId: identity.castId,
      variantIndex: identity.index,
      variantCount: identity.count,
      slots: draft.cast.slots.map((slot) => ({ ...slot, clipId: clipOf(slot.clipId) })),
    },
    voiceover: draft.voiceover && {
      ...draft.voiceover,
      lines: draft.voiceover.lines.map((line) => ({ ...line, clipId: clipOf(line.clipId) })),
    },
    createdAt: identity.now,
    updatedAt: identity.now,
  };
}
