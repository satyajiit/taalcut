// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Handlers for CAPTION_COMMANDS (core), registered on the agent's bus.
 * Every edit is a new timeline revision through TimelineAccess, and every
 * command's inverse is the internal `captions.restore` with the whole
 * previous track, so undo and redo are exact.
 */
import {
  CAPTION_COMMANDS,
  captionCommandPayloads,
  ConflictError,
  defineCommand,
  err,
  NotFoundError,
  ok,
  RationalTime,
  ValidationError,
  type AssetId,
  type AsyncResult,
  type CaptionCue,
  type CaptionCueId,
  type CaptionTrack,
  type CommandContext,
  type CommandOutcome,
  type ProjectId,
  type Rect,
  type Timeline,
  type TimelineId,
  type Transcript,
} from '@taalcut/core';
import { planTimeline } from '../plan/render-plan';
import type { TimelineAccess, TranscriptSource } from '../ports';
import { safeRectFor } from '../presets/presets.v1';
import type { TextMeasurer } from '../types';
import { buildCaptionCues, captionWordsFromPlan } from './cues';
import { matchCaptionStyle } from './style';
import { applyTranslationCommand, timeCueWords } from './translation';
import { transcriptsOf } from './transcripts';

export interface CaptionCommandDeps {
  readonly timelines: TimelineAccess;
  readonly transcripts: TranscriptSource;
  readonly measurer: TextMeasurer;
  /** Cues are regrouped to fit this. Default: the intersection of every preset's safe rect. */
  readonly safe?: Rect;
  readonly newCueId?: () => CaptionCueId;
}

/** What each caption command returns (and the caption tools report). */
export interface CaptionTrackSummary {
  readonly timelineId: TimelineId;
  readonly revision: number;
  readonly enabled: boolean;
  readonly cues: number;
  readonly affectedItemIds?: string[];
  readonly language: string | null;
  readonly styleSource: CaptionTrack['styleSource'] | null;
}

const summary = (timeline: Timeline): CaptionTrackSummary => ({
  timelineId: timeline.id,
  revision: timeline.revision,
  enabled: timeline.captions?.enabled ?? false,
  cues: timeline.captions?.cues.length ?? 0,
  language: timeline.captions?.language ?? null,
  styleSource: timeline.captions?.styleSource ?? null,
});

/** The cue's span shared out by grapheme count: every word at least a frame, the last takes the rest. */
export function splitCueText(
  cue: CaptionCue,
  text: string,
  rate: Timeline['canvas']['rate'],
): CaptionCue['words'] {
  return timeCueWords(cue, text.trim().split(/\s+/u), rate);
}

export function createCaptionCommands(deps: CaptionCommandDeps) {
  const safe = deps.safe ?? safeRectFor([]);

  async function transcriptsFor(timeline: Timeline): AsyncResult<Map<AssetId, Transcript>> {
    const plan = planTimeline(timeline);
    if (!plan.ok) return plan;
    return transcriptsOf(
      deps.transcripts,
      (plan.value.speech ?? plan.value.visuals).map((visual) => visual.assetId),
    );
  }

  /** Cues regrouped from the transcripts; cues the user edited stay, and new cues never overlap them. */
  async function rebuilt(timeline: Timeline, previous: CaptionTrack | null): AsyncResult<CaptionTrack> {
    const plan = planTimeline(timeline);
    if (!plan.ok) return plan;
    const transcripts = await transcriptsFor(timeline);
    if (!transcripts.ok) return transcripts;
    const language = previous?.language ?? [...transcripts.value.values()][0]?.language ?? 'en';
    const style =
      previous?.style ?? matchCaptionStyle(null, language, { safe, height: timeline.canvas.height });
    const rate = timeline.canvas.rate;
    const edited = previous?.cues.filter((cue) => cue.edited) ?? [];
    const words = captionWordsFromPlan(plan.value, transcripts.value);
    const built = buildCaptionCues(words, style, deps.measurer, safe, {
      language,
      rate,
      durationFrames: plan.value.durationFrames,
      ...(deps.newCueId ? { newCueId: deps.newCueId } : {}),
    });
    const spanOf = (cue: CaptionCue) => {
      const start = RationalTime.toFrames(cue.range.start, rate);
      return [start, start + RationalTime.toFrames(cue.range.duration, rate)] as const;
    };
    const kept = built.filter((cue) => {
      const [start, end] = spanOf(cue);
      return edited.every((other) => {
        const [otherStart, otherEnd] = spanOf(other);
        return end <= otherStart || start >= otherEnd;
      });
    });
    const cues = [...edited, ...kept].sort((a, b) => spanOf(a)[0] - spanOf(b)[0]);
    return ok({
      enabled: previous?.enabled ?? true,
      language,
      style,
      styleSource: previous?.styleSource ?? 'preset',
      cues,
    });
  }

  /** Writes `next` as the timeline's captions; the inverse restores what was there. */
  async function write(
    projectId: ProjectId,
    timelineId: TimelineId,
    context: CommandContext,
    next: (timeline: Timeline) => AsyncResult<CaptionTrack | null>,
    revision?: number,
  ): AsyncResult<CommandOutcome<CaptionTrackSummary>> {
    const current = await deps.timelines.get(timelineId);
    if (!current.ok) return current;
    if (current.value.projectId !== projectId)
      return err(NotFoundError({ entity: 'timeline', id: timelineId }));
    if (revision !== undefined && context.replay !== 'redo' && current.value.revision !== revision)
      return err(ConflictError({ entity: 'timeline', id: timelineId }));
    const previous = current.value.captions;
    const track = await next(current.value);
    if (!track.ok) return track;
    const updated = await deps.timelines.update(
      timelineId,
      (timeline) => ({ ...timeline, captions: track.value }),
      context,
    );
    if (!updated.ok) return updated;
    return ok({
      result: {
        ...summary(updated.value),
        affectedItemIds: [
          ...new Set(
            [...(previous?.cues ?? []), ...(updated.value.captions?.cues ?? [])].map((cue) => cue.id),
          ),
        ],
      },
      inverse: { name: CAPTION_COMMANDS.restore, payload: { projectId, timelineId, track: previous } },
    });
  }

  const requireTrack = (timeline: Timeline) =>
    timeline.captions
      ? ok(timeline.captions)
      : err(NotFoundError({ entity: 'caption track', id: timeline.id }));

  const setEnabled = defineCommand({
    name: CAPTION_COMMANDS.setEnabled,
    payload: captionCommandPayloads[CAPTION_COMMANDS.setEnabled],
    sideEffect: 'write',
    handle: ({ projectId, timelineId, revision, enabled }, context) =>
      write(
        projectId,
        timelineId,
        context,
        async (timeline) => {
          if (timeline.captions) return ok({ ...timeline.captions, enabled });
          if (!enabled) return ok(null);
          const built = await rebuilt(timeline, null);
          return built.ok ? ok({ ...built.value, enabled }) : built;
        },
        revision,
      ),
  });

  const editText = defineCommand({
    name: CAPTION_COMMANDS.editText,
    payload: captionCommandPayloads[CAPTION_COMMANDS.editText],
    sideEffect: 'write',
    handle: ({ projectId, timelineId, revision, cueId, text }, context) =>
      write(
        projectId,
        timelineId,
        context,
        async (timeline) => {
          const track = requireTrack(timeline);
          if (!track.ok) return track;
          const cue = track.value.cues.find((candidate) => candidate.id === cueId);
          if (!cue) return err(NotFoundError({ entity: 'caption cue', id: cueId }));
          if (text.trim() === '')
            return ok({ ...track.value, cues: track.value.cues.filter((other) => other !== cue) });
          const words = splitCueText(cue, text, timeline.canvas.rate);
          if (words.length > 40)
            return err(ValidationError({ field: 'text' }, { detail: 'At most 40 words in a cue' }));
          const edited: CaptionCue = { ...cue, words, edited: true };
          return ok({
            ...track.value,
            cues: track.value.cues.map((other) => (other === cue ? edited : other)),
          });
        },
        revision,
      ),
  });

  const setStyle = defineCommand({
    name: CAPTION_COMMANDS.setStyle,
    payload: captionCommandPayloads[CAPTION_COMMANDS.setStyle],
    sideEffect: 'write',
    handle: ({ projectId, timelineId, revision, style }, context) =>
      write(
        projectId,
        timelineId,
        context,
        async (timeline) => {
          const track = requireTrack(timeline);
          if (!track.ok) return track;
          return ok({
            ...track.value,
            style: { ...track.value.style, ...style },
            styleSource: 'user' as const,
          });
        },
        revision,
      ),
  });

  const rebuild = defineCommand({
    name: CAPTION_COMMANDS.rebuild,
    payload: captionCommandPayloads[CAPTION_COMMANDS.rebuild],
    sideEffect: 'write',
    handle: ({ projectId, timelineId, revision }, context) =>
      write(projectId, timelineId, context, (timeline) => rebuilt(timeline, timeline.captions), revision),
  });

  const restore = defineCommand({
    name: CAPTION_COMMANDS.restore,
    payload: captionCommandPayloads[CAPTION_COMMANDS.restore],
    sideEffect: 'write',
    internal: true,
    handle: ({ projectId, timelineId, track }, context) =>
      write(projectId, timelineId, context, async () => ok(track)),
  });

  const applyTranslation = applyTranslationCommand(write);

  return {
    setEnabled,
    editText,
    setStyle,
    rebuild,
    restore,
    applyTranslation,
    all: [setEnabled, editText, setStyle, rebuild, restore, applyTranslation],
  };
}
