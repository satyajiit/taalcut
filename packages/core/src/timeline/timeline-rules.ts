// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Timeline's invariants (packages/timeline/SPEC.md, "Rules"), checked by
 * timelineSchema after the shape. Each is reported with its path:
 * - timeline times (durations, offsets, ramps, text, captions, markers) are at canvas.rate;
 * - the first track is the video track 'V1' and the only video track; a track's id letter matches its
 *   kind; track ids are unique; item ids are unique across the document;
 * - clips and gaps last at least one frame; a transition sits between two clips; its offsets fit the
 *   neighbours, and their handles lie inside the media's `available` range;
 * - each real-time clip's consumed media lies inside `available` (a ramped clip is checked by
 *   @taalcut/timeline, which integrates its speed curve);
 * - text items and caption cues lie inside V1 and don't overlap within their track; caption words lie
 *   inside their cue;
 * - cast.slots[].clipId names a clip in V1, at most once;
 * - v2: only image clips set `stillMotion` and only video clips set `reframe`; at most one audio track of role
 *   'voice' and one of role 'sfx'; graphics share their text track's no-overlap rule; a voiceover line's clipId
 *   names a clip on the voice track, at most once;
 * - EDT1-OPS: a clip's sound fades are at canvas.rate, zero or more, and each fits inside the clip.
 */
import type { z } from 'zod';
import type { CaptionTrack } from '../render/captions';
import { RationalTime } from '../time/rational-time';
import { TimeRange } from '../time/time-range';
import { atMost, lessThan, plus, ruleContext, type Path, type RuleContext } from '../templates/rule-helpers';
import type { BeatMap, Canvas } from '../templates/template-parts';
import { checkBeatMap, checkRamp } from '../templates/template-rules';
import type { CastState } from './cast-schema';
import type { Clip, Marker, SequenceItem, TextTrackItem, Track } from './timeline-items';
import type { Voiceover } from './voiceover';

/** The fields the rules read; timelineSchema's object satisfies it. */
export interface TimelineShape {
  readonly canvas: Canvas;
  readonly beatMap: BeatMap | null;
  readonly tracks: readonly Track[];
  readonly markers: readonly Marker[];
  readonly cast: CastState | null;
  readonly captions: CaptionTrack | null;
  readonly voiceover: Voiceover | null;
}

/**
 * The shortest an edit leaves a clip, in canvas frames (a fifth of a second at 30 fps): trims, re-syncs and
 * moved cuts keep both neighbours at least this long. The schema itself only asks for one frame, so a
 * document cut elsewhere still loads; @taalcut/timeline's edits, the UI kit's clip detail and the editor
 * enforce this.
 */
export const MIN_CLIP_FRAMES = 6;

const KIND_LETTER = { video: 'V', audio: 'A', text: 'T' } as const;

/** The media a clip needs, from `from` for `length` at real time, lies inside `available`. */
function mediaFits(clip: Clip, from: RationalTime, length: RationalTime): boolean {
  if (clip.media.kind === 'image') return true;
  if (clip.holdFrame) return TimeRange.contains(clip.media.available, clip.holdFrame);
  const { available } = clip.media;
  return atMost(available.start, from) && atMost(plus(from, length), TimeRange.end(available));
}

function checkTransition(
  rules: RuleContext,
  items: readonly SequenceItem[],
  index: number,
  path: Path,
): void {
  const item = items[index];
  if (item?.type !== 'transition') return;
  const outgoing = items[index - 1];
  const incoming = items[index + 1];
  if (outgoing?.type !== 'clip' || incoming?.type !== 'clip') {
    rules.issue(path, 'A transition sits between two clips');
    return;
  }
  if (!atMost(item.inOffset, outgoing.duration))
    rules.issue([...path, 'inOffset'], 'Longer than the clip before');
  if (!atMost(item.outOffset, incoming.duration))
    rules.issue([...path, 'outOffset'], 'Longer than the clip after');
  // Handles: the incoming clip shows inOffset early; the outgoing one runs outOffset late.
  if (
    incoming.speed === null &&
    !mediaFits(incoming, RationalTime.subtract(incoming.sourceStart, item.inOffset), item.inOffset)
  )
    rules.issue([...path, 'inOffset'], 'The clip after has no media for the transition');
  const outgoingEnd = plus(outgoing.sourceStart, outgoing.duration);
  if (outgoing.speed === null && !mediaFits(outgoing, outgoingEnd, item.outOffset))
    rules.issue([...path, 'outOffset'], 'The clip before has no media for the transition');
}

/** Checks a video or audio track's items; returns its length. */
function checkSequence(
  rules: RuleContext,
  timeline: TimelineShape,
  items: readonly SequenceItem[],
  path: Path,
): RationalTime {
  const rate = timeline.canvas.rate;
  let length = RationalTime.zero(rate);
  items.forEach((item, index) => {
    const at = [...path, 'items', index];
    if (item.type === 'transition') {
      const timed =
        rules.atRate(item.inOffset, rate, [...at, 'inOffset']) &&
        rules.atRate(item.outOffset, rate, [...at, 'outOffset']);
      if (timed) checkTransition(rules, items, index, at);
      return;
    }
    if (!rules.atRate(item.duration, rate, [...at, 'duration'])) return;
    if (item.duration.value < 1) rules.issue([...at, 'duration'], 'An item lasts at least one frame');
    length = plus(length, item.duration);
    if (item.type !== 'clip') return;
    checkClipKind(rules, item, at);
    checkFades(rules, item, rate, at);
    if (item.speed) checkRamp(rules, item.speed, item.duration, rate, [...at, 'speed']);
    else if (!mediaFits(item, item.sourceStart, item.duration))
      rules.issue([...at, 'sourceStart'], 'The clip uses media outside its available range');
    if (item.beatAnchor) {
      rules.atRate(item.beatAnchor.offset, rate, [...at, 'beatAnchor', 'offset']);
      if (!timeline.beatMap?.beats[item.beatAnchor.beatIndex])
        rules.issue([...at, 'beatAnchor', 'beatIndex'], 'No such beat');
    }
  });
  return length;
}

/** Ranges at the canvas rate, inside [0, length), in order without overlap. */
function checkSpans(
  rules: RuleContext,
  spans: readonly { readonly range: TimeRange; readonly path: Path }[],
  length: RationalTime,
  rate: Canvas['rate'],
): void {
  let previousEnd: RationalTime | null = null;
  for (const { range, path } of spans) {
    const timed =
      rules.atRate(range.start, rate, [...path, 'start']) &&
      rules.atRate(range.duration, rate, [...path, 'duration']);
    if (!timed) continue;
    if (range.duration.value < 1) rules.issue(path, 'Lasts at least one frame');
    if (range.start.value < 0 || !atMost(TimeRange.end(range), length))
      rules.issue(path, 'Outside the video track');
    if (previousEnd && lessThan(range.start, previousEnd)) rules.issue(path, 'Overlaps the item before');
    previousEnd = TimeRange.end(range);
  }
}

function checkCaptions(
  rules: RuleContext,
  captions: CaptionTrack,
  length: RationalTime,
  rate: Canvas['rate'],
): void {
  rules.unique(
    captions.cues.map((cue) => cue.id),
    (index) => ['captions', 'cues', index, 'id'],
    'caption cue',
  );
  checkSpans(
    rules,
    captions.cues.map((cue, index) => ({ range: cue.range, path: ['captions', 'cues', index, 'range'] })),
    length,
    rate,
  );
  captions.cues.forEach((cue, index) =>
    cue.words.forEach((word, w) => {
      if (!TimeRange.containsRange(cue.range, word.range))
        rules.issue(['captions', 'cues', index, 'words', w, 'range'], 'A word outside its cue');
    }),
  );
}

/** v2: only an image clip moves (`stillMotion`), only a video clip is reframed. */
function checkClipKind(rules: RuleContext, clip: Clip, at: Path): void {
  if (
    clip.holdFrame &&
    (clip.media.kind !== 'video' ||
      clip.speed !== null ||
      !clip.audio.muted ||
      RationalTime.compare(clip.sourceStart, clip.holdFrame) !== 0)
  )
    rules.issue(
      [...at, 'holdFrame'],
      'A held video frame has a matching in-point, no speed ramp and muted source sound',
    );
  if (clip.stillMotion !== null && clip.media.kind !== 'image')
    rules.issue([...at, 'stillMotion'], 'Only a still moves');
  if (clip.reframe !== null && clip.media.kind !== 'video')
    rules.issue([...at, 'reframe'], 'Only a video clip is reframed');
}

/** EDT1-OPS: a sound fade is timeline time inside its clip. */
function checkFades(rules: RuleContext, clip: Clip, rate: Canvas['rate'], at: Path): void {
  for (const edge of ['fadeIn', 'fadeOut'] as const) {
    const fade = clip.audio[edge];
    if (!fade || !rules.atRate(fade, rate, [...at, 'audio', edge])) continue;
    if (fade.value < 0 || fade.value > clip.duration.value)
      rules.issue([...at, 'audio', edge], 'A fade lies inside its clip');
  }
}

/** v2: at most one audio track of role 'voice' and one of role 'sfx'. */
function checkAudioRoles(rules: RuleContext, tracks: readonly Track[]): void {
  for (const role of ['voice', 'sfx'] as const) {
    tracks
      .map((track, index) => ({ track, index }))
      .filter(({ track }) => track.kind === 'audio' && track.role === role)
      .slice(1)
      .forEach(({ index }) => rules.issue(['tracks', index, 'role'], `One '${role}' track at most`));
  }
}

/** A voiceover line's clip is on the voice track, and no two lines share one. */
function checkVoiceover(rules: RuleContext, tracks: readonly Track[], voiceover: Voiceover): void {
  const voice = tracks.find(
    (track): track is Extract<Track, { kind: 'audio' }> => track.kind === 'audio' && track.role === 'voice',
  );
  const clips = new Set<string>();
  voice?.items.forEach((item) => {
    if (item.type === 'clip') clips.add(item.id);
  });
  const used = new Set<string>();
  voiceover.lines.forEach((line, index) => {
    if (line.clipId === null) return;
    const path = ['voiceover', 'lines', index, 'clipId'];
    if (!clips.has(line.clipId)) rules.issue(path, 'No such clip on the voice track');
    if (used.has(line.clipId)) rules.issue(path, 'A clip plays one line at most');
    used.add(line.clipId);
  });
}

function textSpans(items: readonly TextTrackItem[], path: Path) {
  return [...items]
    .map((item, index) => ({
      range: TimeRange.of(item.start, item.duration),
      path: [...path, 'items', index],
      start: item.start,
    }))
    .sort((a, b) => RationalTime.compare(a.start, b.start));
}

export function checkTimeline(timeline: TimelineShape, ctx: z.RefinementCtx): void {
  const rules = ruleContext(ctx);
  const rate = timeline.canvas.rate;
  const [first] = timeline.tracks;
  if (first?.kind !== 'video' || first.id !== 'V1')
    rules.issue(['tracks', 0], "The first track is the video track 'V1'");
  timeline.tracks.forEach((track, index) => {
    if (index > 0 && track.kind === 'video') rules.issue(['tracks', index], 'Only one video track');
    if (!track.id.startsWith(KIND_LETTER[track.kind]))
      rules.issue(['tracks', index, 'id'], 'Track id letter must match its kind');
  });
  rules.unique(
    timeline.tracks.map((track) => track.id),
    (index) => ['tracks', index, 'id'],
    'track',
  );
  checkAudioRoles(rules, timeline.tracks);
  const ids: string[] = [];
  const paths: Path[] = [];
  timeline.tracks.forEach((track, t) =>
    track.items.forEach((item, i) => {
      ids.push(item.id);
      paths.push(['tracks', t, 'items', i, 'id']);
    }),
  );
  timeline.markers.forEach((marker, m) => {
    ids.push(marker.id);
    paths.push(['markers', m, 'id']);
  });
  rules.unique(ids, (index) => paths[index] ?? [], 'item');
  if (timeline.beatMap) checkBeatMap(rules, timeline.beatMap, ['beatMap']);

  let length = RationalTime.zero(rate);
  timeline.tracks.forEach((track, t) => {
    if (track.kind === 'text') return;
    const trackLength = checkSequence(rules, timeline, track.items, ['tracks', t]);
    if (t === 0 && track.kind === 'video') length = trackLength;
  });
  timeline.tracks.forEach((track, t) => {
    if (track.kind === 'text') checkSpans(rules, textSpans(track.items, ['tracks', t]), length, rate);
  });
  if (timeline.captions) checkCaptions(rules, timeline.captions, length, rate);
  timeline.markers.forEach((marker, m) => {
    rules.atRate(marker.range.start, rate, ['markers', m, 'range', 'start']);
    rules.atRate(marker.range.duration, rate, ['markers', m, 'range', 'duration']);
  });

  if (timeline.voiceover) checkVoiceover(rules, timeline.tracks, timeline.voiceover);
  if (!timeline.cast || first?.kind !== 'video') return;
  const clips = new Set(first.items.filter((item) => item.type === 'clip').map((item) => item.id as string));
  const used = new Set<string>();
  timeline.cast.slots.forEach((slot, s) => {
    if (slot.clipId === null) return;
    const path = ['cast', 'slots', s, 'clipId'];
    if (!clips.has(slot.clipId)) rules.issue(path, 'No such clip in V1');
    if (used.has(slot.clipId)) rules.issue(path, 'A clip fills one slot at most');
    used.add(slot.clipId);
  });
}
