// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* eslint-disable lingui/no-unlocalized-strings -- error details, entity names and track names as the real handlers write them: data for logs, not UI */

/**
 * The effects track `sfx.setHits` writes, as @taalcut/audio places it (commands/audio-track.ts, sfx/hits-command.ts):
 * each hit a clip starting on the first canvas frame at or after its `at` (skipping into the sound by the
 * difference, so the peak lands on the cut), gaps between them, overlapping hits refused; no hits removes the
 * track. Pure.
 */
import {
  err,
  newId,
  ok,
  RationalTime,
  TimeRange,
  ValidationError,
  type Result,
  type SequenceItem,
  type SfxHit,
  type Timeline,
  type Track,
} from '@taalcut/core';

const isEffects = (track: Track) => track.kind === 'audio' && track.role === 'sfx';

/** A free 'A<n>' id: A3 when it is free, else the next unused. */
function freeTrackId(timeline: Timeline): Result<string> {
  const used = new Set(timeline.tracks.map((track) => track.id));
  for (const id of ['A3', 'A1', 'A2', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9']) if (!used.has(id)) return ok(id);
  return err(ValidationError({ field: 'tracks' }, { detail: 'no free audio track id' }));
}

function hitItems(hits: readonly SfxHit[], timeline: Timeline): Result<SequenceItem[]> {
  const rate = timeline.canvas.rate;
  const placed = hits
    .map((hit) => {
      const startFrame = Math.max(0, RationalTime.toFrames(hit.at, rate, 'ceil'));
      const skip = RationalTime.subtract(RationalTime.of(startFrame, rate), hit.at);
      const end = RationalTime.add(hit.at, hit.duration);
      return {
        hit,
        startFrame,
        frames: RationalTime.toFrames(end, rate, 'floor') - startFrame,
        sourceStart: RationalTime.add(hit.sourceStart, RationalTime.rescale(skip, hit.sourceStart.rate)),
      };
    })
    .sort((a, b) => a.startFrame - b.startFrame);
  const items: SequenceItem[] = [];
  let cursor = 0;
  for (const { hit, startFrame, frames, sourceStart } of placed) {
    if (frames < 1) continue;
    if (startFrame < cursor)
      return err(ValidationError({ field: 'items' }, { detail: `sound at frame ${startFrame} overlaps` }));
    if (startFrame > cursor)
      items.push({
        type: 'gap',
        id: newId<'TimelineItem'>(),
        duration: RationalTime.of(startFrame - cursor, rate),
        slotId: null,
      });
    items.push({
      type: 'clip',
      id: hit.id,
      media: {
        kind: 'audio',
        assetId: hit.assetId,
        available: TimeRange.of(
          RationalTime.zero(hit.sourceStart.rate),
          RationalTime.add(hit.sourceStart, hit.duration),
        ),
      },
      sourceStart,
      duration: RationalTime.of(frames, rate),
      speed: null,
      slotId: null,
      syncPoint: null,
      beatAnchor: null,
      fit: 'cover',
      audio: { gainDb: hit.gainDb, muted: false },
      locked: false,
      enabled: true,
      stillMotion: null,
      reframe: null,
    });
    cursor = startFrame + frames;
  }
  return ok(items);
}

/** The timeline's tracks with exactly these hits on the effects track (none: without it). */
export function withHits(timeline: Timeline, hits: readonly SfxHit[]): Result<Track[]> {
  if (hits.length === 0) return ok(timeline.tracks.filter((track) => !isEffects(track)));
  const items = hitItems(hits, timeline);
  if (!items.ok) return items;
  const index = timeline.tracks.findIndex(isEffects);
  const existing = index >= 0 ? timeline.tracks[index] : undefined;
  const id = existing ? ok(existing.id) : freeTrackId(timeline);
  if (!id.ok) return id;
  const track: Track = {
    kind: 'audio',
    id: id.value,
    name: existing?.name ?? 'Sound effects',
    enabled: existing?.enabled ?? true,
    role: 'sfx',
    items: items.value,
  };
  if (index >= 0) return ok(timeline.tracks.map((t, i) => (i === index ? track : t)));
  const lastAudio = timeline.tracks.reduce((last, t, i) => (t.kind === 'audio' ? i : last), 0);
  return ok([...timeline.tracks.slice(0, lastAudio + 1), track, ...timeline.tracks.slice(lastAudio + 1)]);
}

/** How many hits the effects track holds. */
export function hitCount(timeline: Timeline): number {
  return timeline.tracks
    .filter(isEffects)
    .reduce((sum, track) => sum + track.items.filter((item) => item.type === 'clip').length, 0);
}
