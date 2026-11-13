// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  DEFAULT_MIX,
  err,
  ok,
  RationalTime,
  TIMELINE_SCHEMA_VERSION,
  ValidationError,
  type AssetId,
  type Clip,
  type ClipVisualLayout,
  type FrameRate,
  type ProjectId,
  type Result,
  type SequenceItem,
  type ShortEditPlan,
  type StyleId,
  type Timeline,
  type TimelineId,
  type TimelineItemId,
  type TimeRange,
} from '@taalcut/core';
import { checkEdited } from '../model/validate';

export interface AssembleShortInput {
  readonly projectId: ProjectId;
  readonly timelineId: TimelineId;
  readonly name: string;
  readonly rate: FrameRate;
  readonly plan: ShortEditPlan;
  readonly assets: ReadonlyMap<AssetId, { readonly available: TimeRange }>;
  readonly styleId: StyleId | null;
  readonly layouts?: ReadonlyMap<number, ClipVisualLayout>;
  readonly now: number;
}

/** Source speech and the pictures are separate sequences, so a cutaway cannot replace what was said. */
export function assembleShort(input: AssembleShortInput, ids: { item(): TimelineItemId }): Result<Timeline> {
  const { rate, plan } = input;
  const length = RationalTime.toFrames(plan.duration, rate);
  const sequence = (spans: ShortEditPlan['speech'], speech: boolean): Result<SequenceItem[]> => {
    const items: SequenceItem[] = [];
    let at = 0;
    for (const [index, span] of spans.entries()) {
      const start = RationalTime.toFrames(span.start, rate);
      const duration = RationalTime.toFrames(RationalTime.add(span.start, span.duration), rate) - start;
      const asset = input.assets.get(span.source.assetId);
      if (!asset || start < at || duration < 1 || start + duration > length)
        return err(
          ValidationError(
            { field: 'short.spans' },
            { detail: 'Missing source, overlapping span or invalid duration' },
          ),
        );
      if (RationalTime.compare(span.duration, span.source.range.duration) > 0)
        return err(
          ValidationError({ field: 'short.source' }, { detail: 'The excerpt is shorter than its placement' }),
        );
      if (start > at)
        items.push({
          type: 'gap',
          id: ids.item(),
          duration: RationalTime.of(start - at, rate),
          slotId: null,
        });
      const clip: Clip = {
        type: 'clip',
        id: ids.item(),
        media: speech
          ? { kind: 'audio', assetId: span.source.assetId, available: asset.available }
          : { kind: 'video', assetId: span.source.assetId, shotId: null, available: asset.available },
        sourceStart: span.source.range.start,
        duration: RationalTime.of(duration, rate),
        speed: null,
        slotId: null,
        syncPoint: null,
        beatAnchor: null,
        fit: 'contain',
        audio: { gainDb: 0, muted: !speech && plan.speech.length > 0 },
        locked: false,
        enabled: true,
        stillMotion: null,
        reframe: null,
        ...(!speech && input.layouts?.has(index) ? { visualLayout: input.layouts.get(index)! } : {}),
      };
      items.push(clip);
      at = start + duration;
    }
    if (at < length)
      items.push({ type: 'gap', id: ids.item(), duration: RationalTime.of(length - at, rate), slotId: null });
    return ok(items);
  };
  const visuals = sequence(plan.visuals, false);
  if (!visuals.ok) return visuals;
  const speech = sequence(plan.speech, true);
  if (!speech.ok) return speech;
  const timeline: Timeline = {
    schemaVersion: TIMELINE_SCHEMA_VERSION,
    id: input.timelineId,
    projectId: input.projectId,
    name: input.name,
    revision: 1,
    canvas: { width: 1080, height: 1920, rate },
    template: null,
    beatMap: null,
    cast: null,
    captions: null,
    music: { path: 'none' },
    styleId: input.styleId,
    voiceover: null,
    mix: DEFAULT_MIX,
    ...(plan.speech.length > 0 ? { speechTrackId: 'A1' } : {}),
    tracks: [
      { id: 'V1', kind: 'video', name: 'Video', enabled: true, items: visuals.value },
      { id: 'A1', kind: 'audio', role: 'clip', name: 'Source speech', enabled: true, items: speech.value },
    ],
    markers: [],
    createdAt: input.now,
    updatedAt: input.now,
  };
  const checked = checkEdited(timeline);
  return checked.ok ? ok(timeline) : checked;
}
