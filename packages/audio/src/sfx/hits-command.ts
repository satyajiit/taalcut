// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `sfx.setHits` (SPEC P3.10): replaces the effects track (role 'sfx') with exactly these hits; no hits removes it.
 * Every source may dispatch it; the inverse is `timeline.restore { tracks }`. A hit's clip starts on the first
 * canvas frame at or after its `at` and skips into the sound by the difference, so the peak lands on the cut to
 * the sample rather than to the frame. EAR1-K3: a hit that names its cut keeps it as the clip's sync point, the
 * source instant on the cut (`sourceStart + (cut − at)`, at the sound's rate), so render QA judges it on that cut;
 * one that doesn't, or whose cut falls outside what it plays, has none, as before.
 */
import {
  defineCommand,
  MIX_COMMANDS,
  mixCommandPayloads,
  ok,
  RationalTime,
  TimeRange,
  type FrameRate,
  type SfxHit,
} from '@taalcut/core';
import { buildRoleTrack, withoutRoleTrack, withRoleTrack, type PlacedSound } from '../commands/audio-track';
import { createTimelineWriter, type TimelineWriteDeps } from '../commands/timeline-writes';

export function hitSound(hit: SfxHit, rate: FrameRate): PlacedSound {
  const startFrame = Math.max(0, RationalTime.toFrames(hit.at, rate, 'ceil'));
  const skip = RationalTime.subtract(RationalTime.of(startFrame, rate), hit.at);
  const sourceStart = RationalTime.add(hit.sourceStart, RationalTime.rescale(skip, hit.sourceStart.rate));
  const end = RationalTime.add(hit.at, hit.duration);
  const durationFrames = RationalTime.toFrames(end, rate, 'floor') - startFrame;
  const cut = hit.cut;
  const syncPoint =
    cut && !RationalTime.isBefore(cut, hit.at) && !RationalTime.isAfter(cut, end)
      ? RationalTime.rescale(
          RationalTime.add(hit.sourceStart, RationalTime.subtract(cut, hit.at)),
          hit.sourceStart.rate,
        )
      : null;
  return {
    id: hit.id,
    startFrame,
    durationFrames,
    assetId: hit.assetId,
    available: TimeRange.of(
      RationalTime.zero(hit.sourceStart.rate),
      RationalTime.add(hit.sourceStart, hit.duration),
    ),
    sourceStart,
    gainDb: hit.gainDb,
    slotId: null,
    beatAnchor: null,
    syncPoint,
  };
}

export function createSfxCommands(deps: TimelineWriteDeps) {
  const writer = createTimelineWriter(deps);
  const setHits = defineCommand({
    name: MIX_COMMANDS.setHits,
    payload: mixCommandPayloads[MIX_COMMANDS.setHits],
    sideEffect: 'write',
    handle: (payload, context) =>
      writer.write(payload, context, (timeline) => {
        if (payload.hits.length === 0)
          return ok({
            timeline: { ...timeline, tracks: withoutRoleTrack(timeline, 'sfx') },
            changed: ['tracks'],
          });
        const track = buildRoleTrack(
          timeline,
          'sfx',
          payload.hits.map((hit) => hitSound(hit, timeline.canvas.rate)),
        );
        if (!track.ok) return track;
        return ok({
          timeline: { ...timeline, tracks: withRoleTrack(timeline, track.value) },
          changed: ['tracks'],
        });
      }),
  });
  return { setHits, all: [setHits] as const };
}
