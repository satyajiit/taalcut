// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * planTimeline: a Timeline → RenderPlan. Pure. The timeline has already
 * passed `timelineSchema` (its invariants hold), so this only lays items out
 * on the frame grid:
 *
 * - V1's clips and gaps tile [0, N). A transition between two clips shows the
 *   incoming clip `inOffset` early and runs the outgoing one `outOffset` late
 *   (core's timeline rules), so their visible windows overlap by the
 *   transition and each cut stays where the timeline put it.
 * - Template transition kinds map to drawable effects; glitch and other kinds
 *   draw as cuts, with a warning.
 * - Clip sound follows the visible window, crossfading over transitions;
 *   audio tracks lay out the same way.
 */
import {
  ok,
  RationalTime,
  type Clip,
  type FrameRate,
  type Grade,
  type Result,
  type SequenceItem,
  type SpeedRamp,
  type Timeline,
  type TransitionItem,
} from '@taalcut/core';
import { toFrame } from '../time/frames';
import { planSpeech } from './speech';
import { planCompositions } from '../workspace/fold/plan-compositions';
import { bySpanStart, enabledTextItems } from './text-items';
import {
  NO_BUMPERS,
  type FrameSpan,
  type PlannedAudioClip,
  type PlannedText,
  type PlannedTransition,
  type PlannedVisual,
  type RenderPlan,
  type TransitionEffect,
} from './types';

/** Source seconds per timeline second over the clip: ∫speed / duration. Linear and ease integrate alike. */
export function meanSpeed(speed: SpeedRamp | null, durationFrames: number, rate: FrameRate): number {
  if (!speed || durationFrames <= 0) return 1;
  const points = speed.points.map((point) => ({ at: toFrame(point.at, rate), speed: point.speed }));
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const point = points[i]!;
    const next = points[i + 1];
    const end = Math.min(next ? next.at : durationFrames, durationFrames);
    const length = Math.max(0, end - point.at);
    const endSpeed = next && speed.curve !== 'hold' ? next.speed : point.speed;
    area += (length * (point.speed + endSpeed)) / 2;
  }
  return area / durationFrames;
}

/** A template transition kind and direction as an effect. Unknown kinds are cuts. */
export function transitionEffect(kind: string, direction: string | null): TransitionEffect | null {
  switch (kind) {
    case 'dissolve':
      return 'crossfade';
    case 'fade':
      return 'dipToBlack';
    case 'flash':
      return 'flash';
    case 'whip':
      return 'whipPan';
    case 'zoom':
      return direction === 'down' ? 'zoomOut' : 'zoomIn';
    case 'slide':
      return direction === 'right'
        ? 'slideRight'
        : direction === 'up'
          ? 'slideUp'
          : direction === 'down'
            ? 'slideDown'
            : 'slideLeft';
    default:
      return null;
  }
}

interface Laid {
  readonly item: SequenceItem;
  readonly start: number;
  readonly end: number;
}

/** Each clip and gap with its frames; transitions sit at the boundary they cross. */
function layOut(items: readonly SequenceItem[], rate: FrameRate): Laid[] {
  const laid: Laid[] = [];
  let at = 0;
  for (const item of items) {
    if (item.type === 'transition') {
      laid.push({ item, start: at, end: at });
      continue;
    }
    const frames = toFrame(item.duration, rate);
    laid.push({ item, start: at, end: at + frames });
    at += frames;
  }
  return laid;
}

interface Handles {
  readonly before: number;
  readonly after: number;
  readonly fadeIn: number;
  readonly fadeOut: number;
}

/** How far each clip is grown by the transitions on either side of it. */
function handlesOf(laid: readonly Laid[], rate: FrameRate): Map<string, Handles> {
  const handles = new Map<string, Handles>();
  const get = (id: string) => handles.get(id) ?? { before: 0, after: 0, fadeIn: 0, fadeOut: 0 };
  laid.forEach(({ item }, index) => {
    if (item.type !== 'transition') return;
    const outgoing = laid[index - 1]?.item;
    const incoming = laid[index + 1]?.item;
    if (outgoing?.type !== 'clip' || incoming?.type !== 'clip') return;
    const early = toFrame(item.inOffset, rate);
    const late = toFrame(item.outOffset, rate);
    const total = early + late;
    handles.set(outgoing.id, { ...get(outgoing.id), after: late, fadeOut: total });
    handles.set(incoming.id, { ...get(incoming.id), before: early, fadeIn: total });
  });
  return handles;
}

/** The source time shown `frames` output frames before a clip's sourceStart (real time). */
function sourceBefore(clip: Clip, frames: number, rate: FrameRate): RationalTime {
  if (frames === 0 || clip.media.kind === 'image') return clip.sourceStart;
  return RationalTime.subtract(clip.sourceStart, RationalTime.of(frames, rate));
}

function beatFrame(clip: Clip, timeline: Timeline, rate: FrameRate): PlannedVisual['beat'] {
  const anchor = clip.beatAnchor;
  const beat = anchor ? timeline.beatMap?.beats[anchor.beatIndex] : undefined;
  if (!anchor || !beat) return null;
  return {
    beatIndex: anchor.beatIndex,
    frame: RationalTime.toFrames(beat, rate) + toFrame(anchor.offset, rate),
  };
}

/** EDT1-OPS: a clip's sound fades, at least as long as a transition's overlap on that side. */
function fadesOf(clip: Clip, grow: Handles, rate: FrameRate) {
  const own = (time: RationalTime | undefined) => (time ? toFrame(time, rate) : 0);
  return {
    fadeInFrames: Math.max(grow.fadeIn, own(clip.audio.fadeIn)),
    fadeOutFrames: Math.max(grow.fadeOut, own(clip.audio.fadeOut)),
  };
}

/** EDT1-OPS: a clip's colour then the whole video's; nothing when neither has one. */
function gradesOf(clip: Clip, timeline: Timeline): { grades?: Grade[] } {
  const grades = [clip.grade, timeline.grade].filter((grade): grade is Grade => grade !== undefined);
  return grades.length > 0 ? { grades } : {};
}

function planVideoTrack(timeline: Timeline, rate: FrameRate) {
  const track = timeline.tracks[0];
  const items = track?.kind === 'video' && track.enabled ? track.items : [];
  const laid = layOut(items, rate);
  const handles = handlesOf(laid, rate);
  const visuals: PlannedVisual[] = [];
  const gaps: FrameSpan[] = [];
  const transitions: PlannedTransition[] = [];
  const warnings: string[] = [];
  const audio: PlannedAudioClip[] = [];
  const programs: NonNullable<RenderPlan['programs']>[number][] = [];
  laid.forEach(({ item, start, end }, index) => {
    if (item.type === 'gap') {
      gaps.push({ start, end });
      return;
    }
    if (item.type === 'transition') {
      const planned = planTransition(item, laid, index, rate);
      if (planned) transitions.push(planned);
      else warnings.push(`transition ${item.id} (${item.kind}) is drawn as a cut`);
      return;
    }
    if (item.type === 'program') {
      const program = timeline.authoredPrograms?.find(
        (candidate) => candidate.id === item.program.id && candidate.hash === item.program.hash,
      );
      if (!item.enabled) gaps.push({ start, end });
      else if (program)
        programs.push({ itemId: item.id, span: { start, end }, program, sourceStart: item.sourceStart });
      return;
    }
    if (item.media.kind === 'audio') return;
    const grow = handles.get(item.id) ?? { before: 0, after: 0, fadeIn: 0, fadeOut: 0 };
    const visible = { start: start - grow.before, end: end + grow.after };
    if (!item.enabled) gaps.push({ start, end });
    const speed = meanSpeed(item.speed, end - start, rate);
    const sourceIn = item.holdFrame ?? sourceBefore(item, grow.before, rate);
    visuals.push({
      id: item.id,
      kind: item.media.kind,
      assetId: item.media.assetId,
      cut: { start, end },
      visible,
      sourceIn,
      sourceAtCut: item.holdFrame ?? item.sourceStart,
      ...(item.holdFrame ? { holdFrame: item.holdFrame } : {}),
      speed: item.speed,
      meanSpeed: speed,
      fit: item.fit,
      enabled: item.enabled,
      slotId: item.slotId,
      beat: beatFrame(item, timeline, rate),
      audio: item.audio,
      reframe: item.media.kind === 'video' ? item.reframe : null,
      stillMotion: item.media.kind === 'image' ? item.stillMotion : null,
      ...(item.visualLayout ? { visualLayout: item.visualLayout } : {}),
      ...gradesOf(item, timeline),
    });
    if (item.media.kind === 'video' && !item.holdFrame && item.enabled && !item.audio.muted) {
      audio.push({
        id: item.id,
        track: 'V1',
        assetId: item.media.assetId,
        span: visible,
        sourceIn,
        speed: item.speed,
        lead: grow.before,
        meanSpeed: speed,
        gainDb: item.audio.gainDb,
        ...fadesOf(item, grow, rate),
      });
    }
  });
  const durationFrames = laid.length > 0 ? laid[laid.length - 1]!.end : 0;
  return { visuals, gaps, transitions, warnings, audio, programs, durationFrames };
}

function planTransition(
  item: TransitionItem,
  laid: readonly Laid[],
  index: number,
  rate: FrameRate,
): PlannedTransition | null {
  const effect = transitionEffect(item.kind, item.direction);
  const outgoing = laid[index - 1]?.item;
  const incoming = laid[index + 1];
  if (!effect || outgoing?.type !== 'clip' || incoming?.item.type !== 'clip') return null;
  const cut = incoming.start;
  return {
    id: item.id,
    effect,
    kind: item.kind,
    from: outgoing.id,
    to: incoming.item.id,
    cut,
    span: { start: cut - toFrame(item.inOffset, rate), end: cut + toFrame(item.outOffset, rate) },
  };
}

function planAudioTracks(timeline: Timeline, rate: FrameRate, durationFrames: number): PlannedAudioClip[] {
  const planned: PlannedAudioClip[] = [];
  for (const track of timeline.tracks) {
    if (track.kind !== 'audio' || !track.enabled) continue;
    const laid = layOut(track.items, rate);
    const handles = handlesOf(laid, rate);
    for (const { item, start, end } of laid) {
      if (item.type !== 'clip' || !item.enabled || item.audio.muted || item.media.kind === 'image') continue;
      const grow = handles.get(item.id) ?? { before: 0, after: 0, fadeIn: 0, fadeOut: 0 };
      const span = { start: start - grow.before, end: Math.min(end + grow.after, durationFrames) };
      if (span.end <= span.start) continue;
      planned.push({
        id: item.id,
        track: track.id,
        assetId: item.media.assetId,
        span,
        sourceIn: sourceBefore(item, grow.before, rate),
        speed: item.speed,
        lead: grow.before,
        meanSpeed: meanSpeed(item.speed, end - start, rate),
        gainDb: item.audio.gainDb,
        ...fadesOf(item, grow, rate),
      });
    }
  }
  return planned;
}

function planTexts(timeline: Timeline, rate: FrameRate): PlannedText[] {
  // Motion graphics (Timeline v2, P3-V13) are drawn by the graphics layer, not as text.
  return enabledTextItems(timeline, 'text')
    .map((item): PlannedText => {
      const start = toFrame(item.start, rate);
      return {
        id: item.id,
        span: { start, end: start + toFrame(item.duration, rate) },
        text: item.text,
        role: item.role,
        box: item.box,
        sizeRatio: item.appearance.size,
        align: item.appearance.align,
        letterCase: item.appearance.case,
        background: item.appearance.background,
        reveal: item.reveal,
        language: item.language,
        styleKey: item.styleKey,
        origin: item.origin,
      };
    })
    .sort(bySpanStart);
}

/** Lays a validated timeline out on its frame grid. */
export function planTimeline(timeline: Timeline): Result<RenderPlan> {
  const rate = timeline.canvas.rate;
  const video = planVideoTrack(timeline, rate);
  const captions = timeline.captions?.enabled ? timeline.captions : null;
  const compositions = planCompositions(timeline, rate);
  return ok({
    timelineId: timeline.id,
    projectId: timeline.projectId,
    revision: timeline.revision,
    name: timeline.name,
    rate,
    width: timeline.canvas.width,
    height: timeline.canvas.height,
    durationFrames: video.durationFrames,
    visuals: video.visuals,
    ...(video.programs.length > 0 ? { programs: video.programs } : {}),
    gaps: video.gaps,
    transitions: video.transitions,
    texts: planTexts(timeline, rate),
    ...(compositions.planned.length > 0 ? { compositions: compositions.planned } : {}),
    captions,
    audio: [...video.audio, ...planAudioTracks(timeline, rate, video.durationFrames)],
    ...(timeline.speechTrackId ? { speech: planSpeech(timeline) } : {}),
    music: timeline.music,
    ...(timeline.mix.music ? { musicBed: timeline.mix.music } : {}),
    beatMap: timeline.beatMap,
    warnings: [...video.warnings, ...compositions.warnings],
    bumpers: NO_BUMPERS,
  });
}
