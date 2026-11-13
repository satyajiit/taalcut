// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A voiceover's lines between placement and the timeline: what placement needs to know about each line's file,
 * read back from the voice track for lines that aren't generated again, and the voice track and Voiceover record
 * the placements become. Pure.
 */
import {
  ok,
  RationalTime,
  TimeRange,
  type FrameRate,
  type Result,
  type Timeline,
  type Track,
  type VoiceLine,
  type VoiceLineId,
  type Voiceover,
  type VoiceQuality,
} from '@taalcut/core';
import { buildRoleTrack, trackOfRole, type PlacedSound } from '../commands/audio-track';
import { LINE_RATE } from './alignment';
import type { Placement, PlacementLine } from './placement';

export interface LineFacts extends PlacementLine {
  readonly text: string;
  readonly quality: VoiceQuality;
}

/**
 * Facts for a line already on the voice track. Its clip starts half a frame before the onset, and the clip runs to
 * the next line, so the speech is taken to end a frame before the clip does: re-placement stays where it was.
 */
export function keptFacts(timeline: Timeline, line: VoiceLine): LineFacts | null {
  const track = trackOfRole(timeline, 'voice');
  const clip = track?.items.find((item) => item.type === 'clip' && item.id === line.clipId);
  if (!clip || clip.type !== 'clip' || clip.media.kind !== 'audio') return null;
  const frame = RationalTime.rescale(RationalTime.of(1, timeline.canvas.rate), LINE_RATE);
  const start = RationalTime.rescale(clip.sourceStart, LINE_RATE);
  const half = RationalTime.of(Math.round(frame.value / 2), LINE_RATE);
  const onset = RationalTime.add(start, half);
  const clipEnd = RationalTime.add(start, RationalTime.rescale(clip.duration, LINE_RATE));
  return {
    lineId: line.id,
    slotId: line.slotId,
    assetId: clip.media.assetId,
    duration: RationalTime.rescale(clip.media.available.duration, LINE_RATE),
    onset,
    speechEnd: RationalTime.max(onset, RationalTime.subtract(clipEnd, frame)),
    text: line.text,
    quality: line.quality,
  };
}

/** The placed lines as sounds on the voice track; clip ids are the lines' own (stable across re-placement). */
export function voiceSounds(
  placements: readonly Placement[],
  facts: ReadonlyMap<VoiceLineId, LineFacts>,
  clipIds: ReadonlyMap<VoiceLineId, VoiceLine['clipId']>,
  rate: FrameRate,
): PlacedSound[] {
  return placements.map((p) => {
    const fact = facts.get(p.lineId);
    const duration = fact?.duration ?? RationalTime.zero(LINE_RATE);
    const id = clipIds.get(p.lineId);
    return {
      ...(id ? { id } : {}),
      startFrame: p.startFrame,
      durationFrames: p.durationFrames,
      assetId: p.assetId,
      available: TimeRange.of(RationalTime.zero(LINE_RATE), duration),
      sourceStart: p.sourceStart,
      gainDb: 0,
      slotId: p.slotId,
      beatAnchor: p.beatIndex === null ? null : { beatIndex: p.beatIndex, offset: RationalTime.zero(rate) },
    };
  });
}

/** One line of the Voiceover record: how long it speaks, on its file's clock (LINE_RATE). */
export function voiceLineOf(facts: LineFacts, placement: Placement, clipId: VoiceLine['clipId']): VoiceLine {
  const spoken = RationalTime.subtract(facts.speechEnd, facts.onset);
  return {
    id: facts.lineId,
    text: facts.text,
    slotId: facts.slotId,
    clipId,
    assetId: facts.assetId,
    quality: facts.quality,
    duration: RationalTime.max(RationalTime.zero(spoken.rate), spoken),
    offBeat: placement.offBeat,
  };
}

/** How long a stored line speaks, ms: for tool outputs (the model-facing edge) only. */
export function lineDurationMs(line: VoiceLine): number {
  return Math.max(0, Math.round(RationalTime.toSeconds(line.duration) * 1000));
}

export interface VoiceRecord {
  readonly voiceId: string;
  readonly voiceName: string;
  readonly own: boolean;
  readonly language: string;
  readonly seed: number;
  readonly id: Voiceover['id'];
}

/** The voice track and the Voiceover for these placements, the payload `voice.applyVoiceover` takes. */
export function voiceoverOf(
  timeline: Timeline,
  record: VoiceRecord,
  placements: readonly Placement[],
  facts: ReadonlyMap<VoiceLineId, LineFacts>,
): Result<{ readonly voiceover: Voiceover; readonly track: Track }> {
  const previous = new Map((timeline.voiceover?.lines ?? []).map((l) => [l.id, l.clipId]));
  const sounds = voiceSounds(placements, facts, previous, timeline.canvas.rate);
  const track = buildRoleTrack(timeline, 'voice', sounds);
  if (!track.ok) return track;
  const clips = track.value.items.filter((item) => item.type === 'clip');
  const lines = placements.map((p, i) => {
    const fact = facts.get(p.lineId);
    return fact ? voiceLineOf(fact, p, clips[i]?.id ?? null) : null;
  });
  return ok({
    track: track.value,
    voiceover: { ...record, lines: lines.filter((l): l is VoiceLine => l !== null) },
  });
}
