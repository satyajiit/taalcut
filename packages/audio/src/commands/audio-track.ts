// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Audio tracks audio's commands own: the voice track (role 'voice', by convention A2) and the effects track (role
 * 'sfx', A3). Placed sounds become clips with gaps between them, at the canvas rate, never overlapping. Pure.
 */
import {
  err,
  newId,
  ok,
  RationalTime,
  ValidationError,
  type AssetId,
  type AudioTrackRole,
  type FrameRate,
  type Result,
  type SequenceItem,
  type SlotId,
  type TimeRange,
  type Timeline,
  type TimelineItemId,
  type Track,
} from '@taalcut/core';

/** One sound placed on the timeline, in canvas frames. */
export interface PlacedSound {
  readonly id?: TimelineItemId;
  readonly startFrame: number;
  readonly durationFrames: number;
  readonly assetId: AssetId;
  /** The asset's whole range, at its own rate. */
  readonly available: TimeRange;
  /** First source instant played. */
  readonly sourceStart: RationalTime;
  readonly gainDb: number;
  readonly slotId: SlotId | null;
  readonly beatAnchor: { readonly beatIndex: number; readonly offset: RationalTime } | null;
  /** EAR1-K3: the source instant that lands on its cut (an effect's), when it was placed for one. */
  readonly syncPoint?: RationalTime | null;
}

const DEFAULT_IDS: Record<Exclude<AudioTrackRole, 'clip'>, { readonly id: string; readonly name: string }> = {
  voice: { id: 'A2', name: 'Voice' },
  sfx: { id: 'A3', name: 'Sound effects' },
};

/** The track of `role`, or null. */
export function trackOfRole(timeline: Timeline, role: AudioTrackRole): Extract<Track, { kind: 'audio' }> | null {
  for (const track of timeline.tracks) if (track.kind === 'audio' && track.role === role) return track;
  return null;
}

/** A free 'A<n>' id: the conventional one when it's free, else the next unused. */
function freeTrackId(timeline: Timeline, preferred: string): Result<string> {
  const used = new Set(timeline.tracks.map((track) => track.id));
  if (!used.has(preferred)) return ok(preferred);
  for (let n = 1; n <= 9; n++) if (!used.has(`A${n}`)) return ok(`A${n}`);
  return err(ValidationError({ field: 'tracks' }, { detail: 'no free audio track id' }));
}

/** Clips and gaps for sounds sorted by start; overlapping sounds are refused (a bug in the caller's plan). */
export function soundsToItems(sounds: readonly PlacedSound[], rate: FrameRate): Result<SequenceItem[]> {
  const sorted = [...sounds].sort((a, b) => a.startFrame - b.startFrame);
  const items: SequenceItem[] = [];
  let cursor = 0;
  for (const sound of sorted) {
    if (sound.durationFrames < 1) continue;
    if (sound.startFrame < cursor)
      return err(ValidationError({ field: 'items' }, { detail: `sound at frame ${sound.startFrame} overlaps` }));
    if (sound.startFrame > cursor)
      items.push({
        type: 'gap',
        id: newId<'TimelineItem'>(),
        duration: RationalTime.of(sound.startFrame - cursor, rate),
        slotId: null,
      });
    items.push({
      type: 'clip',
      id: sound.id ?? newId<'TimelineItem'>(),
      media: { kind: 'audio', assetId: sound.assetId, available: sound.available },
      sourceStart: sound.sourceStart,
      duration: RationalTime.of(sound.durationFrames, rate),
      speed: null,
      slotId: sound.slotId,
      syncPoint: sound.syncPoint ?? null,
      beatAnchor: sound.beatAnchor,
      fit: 'cover',
      audio: { gainDb: sound.gainDb, muted: false },
      locked: false,
      enabled: true,
      stillMotion: null,
      reframe: null,
    });
    cursor = sound.startFrame + sound.durationFrames;
  }
  return ok(items);
}

/** The track of `role` holding exactly these sounds (its id kept, or a free one for a new track). */
export function buildRoleTrack(
  timeline: Timeline,
  role: Exclude<AudioTrackRole, 'clip'>,
  sounds: readonly PlacedSound[],
): Result<Track> {
  const items = soundsToItems(sounds, timeline.canvas.rate);
  if (!items.ok) return items;
  const existing = trackOfRole(timeline, role);
  const id = existing ? ok(existing.id) : freeTrackId(timeline, DEFAULT_IDS[role].id);
  if (!id.ok) return id;
  return ok({
    kind: 'audio',
    id: id.value,
    name: existing?.name ?? DEFAULT_IDS[role].name,
    enabled: existing?.enabled ?? true,
    role,
    items: items.value,
  });
}

/** The timeline's tracks with `track` in place of the track of its role (or added after the last audio track). */
export function withRoleTrack(timeline: Timeline, track: Track): Track[] {
  if (track.kind !== 'audio') return [...timeline.tracks];
  const index = timeline.tracks.findIndex((t) => t.kind === 'audio' && t.role === track.role);
  if (index >= 0) return timeline.tracks.map((t, i) => (i === index ? track : t));
  const lastAudio = timeline.tracks.reduce((last, t, i) => (t.kind === 'audio' ? i : last), 0);
  return [...timeline.tracks.slice(0, lastAudio + 1), track, ...timeline.tracks.slice(lastAudio + 1)];
}

/** The timeline without the track of `role`. */
export function withoutRoleTrack(timeline: Timeline, role: Exclude<AudioTrackRole, 'clip'>): Track[] {
  return timeline.tracks.filter((t) => !(t.kind === 'audio' && t.role === role));
}
