// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  defineCommand,
  err,
  NotImplementedError,
  ok,
  RationalTime,
  TimeRange,
  ValidationError,
  SIMPLE_EDITOR_COMMANDS as N,
  simpleEditorPayloads as P,
  type Clip,
  type SequenceItem,
  type Timeline,
} from '@taalcut/core';
import { positions } from '../model/sequence';
import { withTransitions } from '../edits/insert-extras';
import type { EditOptions } from '../edits/types';
import { writeMade } from './editor-commands';
import type { CommandDeps } from './context';
import type { NarrationAsset } from './narration-types';
export type { NarrationAsset, NarrationAssets } from './narration-types';

const invalid = (detail: string) => err(ValidationError({ field: 'narration' }, { detail }));

function placeNarration(timeline: Timeline, asset: NarrationAsset, at: RationalTime, options: EditOptions) {
  const rate = timeline.canvas.rate;
  const start = RationalTime.rescale(at, rate, 'round').value;
  const duration = RationalTime.rescale(asset.duration, rate, 'floor');
  const end = start + duration.value;
  const videoEnd = positions(timeline.tracks[0]?.items as SequenceItem[]).at(-1)?.end ?? 0;
  if (start < 0 || duration.value < 1 || end > videoEnd)
    return invalid('The take must fit between the captured playhead position and the end of the video');
  const existing = timeline.tracks.find((track) => track.kind === 'audio' && track.role === 'voice');
  if (existing?.kind === 'text') return invalid('The voice track is invalid');
  const placed = positions(existing?.items ?? []).filter((place) => place.item.type === 'clip');
  if (placed.some((place) => place.start < end && place.end > start))
    return invalid('There is already narration here; choose an empty interval or move the existing take');
  const ids = options.ids!;
  const item: Clip = {
    type: 'clip',
    id: ids(),
    media: {
      kind: 'audio',
      assetId: asset.assetId,
      available: TimeRange.of(RationalTime.zero(asset.duration.rate), asset.duration),
    },
    sourceStart: RationalTime.zero(asset.duration.rate),
    duration,
    speed: null,
    slotId: null,
    syncPoint: null,
    beatAnchor: null,
    fit: 'contain',
    audio: { gainDb: 0, muted: false },
    locked: false,
    enabled: true,
    stillMotion: null,
    reframe: null,
  };
  const items: SequenceItem[] = [];
  let cursor = 0;
  for (const place of [...placed, { item, start, end }].sort((a, b) => a.start - b.start)) {
    if (place.start > cursor)
      items.push({
        type: 'gap',
        id: ids(),
        slotId: null,
        duration: RationalTime.of(place.start - cursor, rate),
      });
    items.push(place.item);
    cursor = place.end;
  }
  const id =
    existing?.id ??
    Array.from({ length: 9 }, (_, index) => `A${index + 1}`).find(
      (candidate) => !timeline.tracks.some((track) => track.id === candidate),
    );
  if (!id) return invalid('There is no available audio track');
  const track = {
    kind: 'audio' as const,
    role: 'voice' as const,
    id,
    name: existing?.name ?? 'Voice',
    enabled: existing?.enabled ?? true,
    items: withTransitions(existing?.items ?? [], items),
  };
  const tracks = existing
    ? timeline.tracks.map((old) => (old.id === id ? track : old))
    : [...timeline.tracks, track];
  return ok({ timeline: { ...timeline, tracks }, changed: ['tracks'] as const, itemId: item.id });
}

export function narrationCommand(deps: CommandDeps) {
  return defineCommand({
    name: N.addNarration,
    payload: P[N.addNarration],
    sideEffect: 'write',
    handle: (payload, context) =>
      writeMade(deps, payload, context, async (timeline, options) => {
        if (!deps.narration) return err(NotImplementedError({ feature: 'timeline.addNarration' }));
        const source = await deps.narration(payload, payload.projectId);
        return source.ok ? placeNarration(timeline, source.value, payload.at, options) : source;
      }),
  });
}
