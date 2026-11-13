// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EDT1-OPS: what the edit eval's checkers read off a timeline (clips by id, their shot, speed, sound and colour,
 * the transition between two clips, the texts, graphics, music and captions), and the out-of-target diff: what
 * changed that the request wasn't about.
 */
import { type Clip, type Grade, type GraphicItem, type GraphicsDesignJob, type TextItem, type Timeline, type TimelineItemId, type TransitionItem } from '@taalcut/core';
import { LIBRARY_SHOTS, VIDEO_SHOTS, type Shot } from './footage';
import { IDS } from './timeline-doc';

export interface Verdict {
  readonly pass: boolean;
  readonly why: string;
}

/** Every condition must hold; the verdict names the first that doesn't. */
export function all(...conditions: readonly (readonly [boolean, string])[]): Verdict {
  const failed = conditions.find(([holds]) => !holds);
  return failed ? { pass: false, why: failed[1] } : { pass: true, why: 'ok' };
}

export const near = (value: number | undefined, target: number, within: number) =>
  value !== undefined && Math.abs(value - target) <= within;

export const videoItems = (timeline: Timeline) => {
  const track = timeline.tracks.find((entry) => entry.kind === 'video');
  return track?.kind === 'video' ? track.items : [];
};

export const clipsOf = (timeline: Timeline): Clip[] =>
  videoItems(timeline).filter((item): item is Clip => item.type === 'clip');

/** The clip that was clip `index` (0-based) in the original video, by its id. */
export const clipNo = (timeline: Timeline, index: number): Clip | undefined =>
  clipsOf(timeline).find((clip) => clip.id === IDS.clips[index]);

/** Clips showing a shot (`bike`, `harbour`, ...), in order. */
export const clipsOfShot = (timeline: Timeline, key: string): Clip[] => {
  const shot = shotByKey(key);
  return clipsOf(timeline).filter((clip) => clip.media.assetId === shot.assetId);
};

export function shotByKey(key: string): Shot {
  const found = [...VIDEO_SHOTS, ...LIBRARY_SHOTS].find((entry) => entry.key === key);
  if (!found) throw new Error(`No shot ${key}`);
  return found;
}

/** The order of shots in the video, by key. */
export const shotOrder = (timeline: Timeline): string[] =>
  clipsOf(timeline).map(
    (clip) => [...VIDEO_SHOTS, ...LIBRARY_SHOTS].find((entry) => entry.assetId === clip.media.assetId)?.key ?? '?',
  );

/** Frames (at 30 fps) of a canvas-rate time. */
export const frames = (time: { value: number; rate: { num: number; den: number } } | undefined) =>
  time ? Math.round((time.value * time.rate.den * 30) / time.rate.num) : 0;

/** A clip's speed: the mean of its points, 1 without a ramp. */
export function speedOf(clip: Clip | undefined): number {
  if (!clip?.speed || clip.speed.points.length === 0) return 1;
  const speeds = clip.speed.points.map((point) => point.speed);
  return speeds.reduce((sum, value) => sum + value, 0) / speeds.length;
}

export const constantSpeed = (clip: Clip | undefined, speed: number) =>
  clip !== undefined && (clip.speed?.points ?? [{ speed: 1 }]).every((point) => near(point.speed, speed, 0.02));

/** The transition between two clips next to each other, if any. */
export function transitionBetween(timeline: Timeline, fromId: string, toId: string): TransitionItem | undefined {
  const items = videoItems(timeline);
  const index = items.findIndex((item) => item.id === fromId);
  const next = items[index + 1];
  return index >= 0 && next?.type === 'transition' && items[index + 2]?.id === toId ? next : undefined;
}

/** Whether a clip's colour is black and white. */
export const isMono = (grade: Grade | undefined) =>
  grade !== undefined && (grade.look === 'mono' || grade.saturation <= -0.9);

export const isWarmer = (grade: Grade | undefined) =>
  grade !== undefined && (grade.temperature > 0 || grade.look === 'warm');

export const texts = (timeline: Timeline): TextItem[] =>
  timeline.tracks.flatMap((track) =>
    track.kind === 'text' ? track.items.filter((item): item is TextItem => item.type === 'text') : [],
  );

export const textById = (timeline: Timeline, id: string) => texts(timeline).find((item) => item.id === id);

/** The video's graphics: each a composition the Designer made (HFW1). */
export const graphics = (timeline: Timeline): GraphicItem[] =>
  timeline.tracks.flatMap((track) =>
    track.kind === 'text'
      ? track.items.filter((item): item is GraphicItem => item.type === 'graphic')
      : [],
  );

export const voiceClip = (timeline: Timeline): Clip | undefined =>
  timeline.tracks
    .flatMap((track) => (track.kind === 'audio' ? track.items : []))
    .find((item): item is Clip => item.type === 'clip' && item.id === IDS.voice);

/** The music's level (the choice's gain) and its bed. */
export function musicOf(timeline: Timeline) {
  const gainDb = 'gainDb' in timeline.music ? timeline.music.gainDb : 0;
  const bed = timeline.mix.music;
  return {
    gainDb,
    muted: bed?.muted ?? false,
    start: frames(bed?.start),
    shift: frames(bed?.shift),
    end: bed?.end ? frames(bed.end) : null,
    fadeIn: frames(bed?.fadeIn),
    fadeOut: frames(bed?.fadeOut),
  };
}

export const cueText = (timeline: Timeline, index: number) =>
  timeline.captions?.cues[index]?.words.map((word) => word.text).join(' ');

/** What a request may change; anything else that changes is out of target. */
export interface Scope {
  /** Original clips by index, `title`, `caption`, `voice`, `graphic`. */
  readonly items?: readonly (number | 'title' | 'caption' | 'voice' | 'graphic')[];
  /** Clips come and go and move (split, delete, insert, move): only the others' own fields are compared. */
  readonly structure?: boolean;
  /** The whole video's colour, the music, the captions. */
  readonly video?: readonly ('grade' | 'music' | 'captions' | 'graphics')[];
}

const ref = (item: NonNullable<Scope['items']>[number]): TimelineItemId | undefined =>
  typeof item === 'number'
    ? IDS.clips[item]
    : item === 'title'
      ? IDS.title
      : item === 'caption'
        ? IDS.caption
        : item === 'voice'
          ? IDS.voice
          : undefined;

/**
 * A clip's own settings. A structural edit (a move, an insert, a ripple) re-times positions: the beats keep their
 * lengths, so a clip may take its new position's length and in-point, and that alone isn't out of target.
 */
const clipFields = (clip: Clip, structure = false) =>
  JSON.stringify([
    clip.media,
    ...(structure ? [] : [clip.sourceStart, clip.duration]),
    clip.speed,
    clip.audio,
    clip.grade ?? null,
    clip.reframe,
    clip.fit,
    clip.enabled,
  ]);

const transitionFields = (item: TransitionItem) => JSON.stringify([item.kind, item.inOffset, item.outOffset, item.direction]);

/** What changed outside the scope, in words; empty when nothing did. */
const graphicsInScope = (scope: Scope) => (scope.video ?? []).includes('graphics') || (scope.items ?? []).includes('graphic');

/**
 * The graphics a run proposed that the request wasn't about, when the case is not about graphics: new proposals
 * waiting for Use it, and (HFW1) jobs asked of the Designer, whose design comes as a proposal after the run. Not out
 * of target, since nothing is committed, but reported: run 11 proposed a new "Weekend ride" title for "move the
 * Weekend ride title down".
 */
export function proposedUnasked(before: Timeline, after: Timeline, scope: Scope, asked: readonly GraphicsDesignJob[] = []): string[] {
  if (graphicsInScope(scope)) return [];
  const had = new Set(graphics(before).filter((item) => item.proposal).map((item) => item.id));
  return [
    ...graphics(after)
      .filter((item) => item.proposal && !had.has(item.id))
      .map((item) => `a proposed graphic ${item.id}`),
    ...asked.map((job) => `a graphic asked of the Designer: ${job.request.slice(0, 80)}`),
  ];
}

export function outOfTarget(before: Timeline, after: Timeline, scope: Scope): string[] {
  const allowed = new Set((scope.items ?? []).flatMap((item) => ref(item) ?? []));
  const video = new Set(scope.video ?? []);
  const found: string[] = [];
  const afterClips = new Map(clipsOf(after).map((clip) => [clip.id, clip]));
  for (const clip of clipsOf(before)) {
    if (allowed.has(clip.id)) continue;
    const now = afterClips.get(clip.id);
    if (!now) found.push(`clip ${clip.id} was removed`);
    else if (clipFields(now, scope.structure) !== clipFields(clip, scope.structure)) found.push(`clip ${clip.id} changed`);
  }
  // A structural edit moves its target and closes up after it; the clips around it keep their order. Moving one of
  // them is out of target: run 9 moved the dog to the start for "open on the skyline" (a clip moved only past the
  // target leaves the same video as the target moved past it, so this order is all that tells).
  const beforeIds = new Set(clipsOf(before).map((clip) => clip.id));
  const others = (timeline: Timeline) =>
    clipsOf(timeline).filter((clip) => !allowed.has(clip.id) && beforeIds.has(clip.id) && afterClips.has(clip.id));
  const named = (clips: readonly Clip[]) =>
    clips.map((clip) => [...VIDEO_SHOTS, ...LIBRARY_SHOTS].find((entry) => entry.assetId === clip.media.assetId)?.key ?? clip.id).join(',');
  const aroundBefore = others(before);
  const aroundAfter = others(after);
  if (aroundBefore.map((clip) => clip.id).join() !== aroundAfter.map((clip) => clip.id).join())
    found.push(`the clips around the target changed order: ${named(aroundBefore)} became ${named(aroundAfter)}`);
  // A structural edit's transitions stay with the cuts they were on, so only their kinds are kept.
  const kinds = (timeline: Timeline) =>
    JSON.stringify(
      videoItems(timeline)
        .flatMap((item) => (item.type === 'transition' ? [`${item.kind}:${item.direction ?? ''}`] : []))
        .sort(),
    );
  const pairs = (timeline: Timeline) => {
    const items = videoItems(timeline);
    return new Map(
      items.flatMap((item, index) =>
        item.type === 'transition' && items[index - 1] && items[index + 1]
          ? [[`${items[index - 1]!.id}>${items[index + 1]!.id}`, transitionFields(item)] as const]
          : [],
      ),
    );
  };
  const was = pairs(before);
  const is = pairs(after);
  const touchesScope = [...was.keys(), ...is.keys()].some((key) => key.split('>').some((id) => allowed.has(id as TimelineItemId)));
  if (scope.structure && !touchesScope && kinds(before) !== kinds(after)) found.push('the transitions changed');
  // A transition belongs to its cut: it is in scope only when both its clips are (a clip the run made, a split's
  // half, counts as in scope). Run 11 put "a crossfade into the next one" (the bike selected) on the coffee to
  // crossing cut, and the coffee being in scope had let it pass.
  const inScope = (id: string) => allowed.has(id as TimelineItemId) || !beforeIds.has(id as TimelineItemId);
  for (const key of scope.structure ? [] : new Set([...was.keys(), ...is.keys()])) {
    const [from, to] = key.split('>') as [string, string];
    if (inScope(from) && inScope(to)) continue;
    if (!afterClips.has(from as TimelineItemId) || !afterClips.has(to as TimelineItemId)) continue;
    if (was.get(key) !== is.get(key)) found.push(`the transition ${key} changed`);
  }
  const afterTexts = new Map(texts(after).map((item) => [item.id, item]));
  for (const item of texts(before)) {
    if (allowed.has(item.id)) continue;
    const now = afterTexts.get(item.id);
    const fields = (text: TextItem) =>
      JSON.stringify([text.text, text.box, text.appearance, ...(scope.structure ? [] : [text.start, text.duration])]);
    if (!now || fields(now) !== fields(item)) found.push(`text ${item.id} changed`);
  }
  // Only the committed graphics: a proposal (the Designer's, not yet used) is drawn in the preview but never
  // exported or checked until the person uses it, so it changes nothing yet (proposedUnasked counts it).
  if (!graphicsInScope(scope)) {
    const committed = (timeline: Timeline) =>
      JSON.stringify(graphics(timeline).filter((item) => !item.proposal).map((item) => [item.id, item.composition, item.placement]));
    if (committed(after) !== committed(before)) found.push('the graphics changed');
  }
  if (!allowed.has(IDS.voice)) {
    const voice = (timeline: Timeline) => JSON.stringify(voiceClip(timeline)?.audio ?? null);
    if (voice(before) !== voice(after)) found.push('the voice line changed');
  }
  if (!video.has('grade') && JSON.stringify(before.grade ?? null) !== JSON.stringify(after.grade ?? null))
    found.push("the whole video's colour changed");
  if (!video.has('music') && JSON.stringify(musicOf(before)) !== JSON.stringify(musicOf(after)))
    found.push('the music changed');
  const captions = (timeline: Timeline) =>
    JSON.stringify([timeline.captions?.enabled, timeline.captions?.style, timeline.captions?.cues.map((cue) => cue.words.map((word) => word.text))]);
  if (!video.has('captions') && !scope.structure && captions(before) !== captions(after)) found.push('the captions changed');
  return found;
}
