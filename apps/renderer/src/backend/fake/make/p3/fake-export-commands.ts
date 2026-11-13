// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* eslint-disable lingui/no-unlocalized-strings -- error details, entity names and track names as the real handlers write them: data for logs, not UI */

/**
 * The commands the export dialog's Phase 3 sections dispatch, as their real handlers answer them: Content
 * Credentials (render, person sources only; P3-V7), ducking and the hits on the cuts (audio; P3-V6), taking the
 * voiceover out (audio; P3-B6) and a clip's framing (timeline; P3-V2). Each writes through the Make fakes'
 * timelines (a new revision, announced) with the real inverse; a stale revision is core.conflict and a no-op
 * leaves no undo step.
 */
import {
  ConflictError,
  defineCommand,
  err,
  MIX_COMMANDS,
  mixCommandPayloads,
  ok,
  PERSON_SOURCES,
  RENDER_COMMANDS,
  renderCommandPayloads,
  TIMELINE_COMMANDS,
  timelineCommandPayloads,
  ValidationError,
  VOICE_COMMANDS,
  voiceCommandPayloads,
  type AnyCommand,
  type ProjectId,
  type Timeline,
  type TimelineId,
} from '@taalcut/core';
import { timelineError, type Edit } from '../edits';
import type { MakeP3Deps } from './deps';
import { withHits } from './interchange/effects-track';
import type { ExportFakeState } from './interchange/export-state';

interface Target {
  readonly projectId: ProjectId;
  readonly timelineId: TimelineId;
  readonly revision?: number | undefined;
}

const base = { sideEffect: 'write' as const, project: (p: { projectId: ProjectId }) => p.projectId };

export function createFakeExportCommands(deps: MakeP3Deps, state: ExportFakeState): AnyCommand[] {
  /** The target's timeline at the revision it names, or the error the real writers return. */
  const read = (target: Target) => {
    const timeline = deps.timelines.get(target.timelineId);
    if (!timeline || timeline.projectId !== target.projectId)
      return err(timelineError('timeline.not_found', { timelineId: target.timelineId }));
    if (target.revision !== undefined && target.revision !== timeline.revision)
      return err(
        ConflictError(
          { entity: 'timeline', id: target.timelineId },
          { detail: `revision ${target.revision} asked, ${timeline.revision} stored` },
        ),
      );
    return ok(timeline);
  };
  const write = (
    target: Target,
    apply: (timeline: Timeline) => Edit,
    inverse?: (before: Timeline) => { readonly name: string; readonly payload: unknown },
  ) => {
    const before = read(target);
    if (!before.ok) return before;
    return deps.timelines.write(target.projectId, before.value, apply(before.value), inverse?.(before.value));
  };

  return [
    defineCommand({
      ...base,
      name: RENDER_COMMANDS.setContentCredentials,
      payload: renderCommandPayloads[RENDER_COMMANDS.setContentCredentials],
      // The agent never turns credentials on: the bus refuses every source but a person's.
      sources: PERSON_SOURCES,
      handle: ({ projectId, add }) => {
        const previous = state.credentials.get(projectId) ?? false;
        state.credentials.set(projectId, add);
        return ok({
          result: { contentCredentials: { add } },
          inverse: { name: RENDER_COMMANDS.setContentCredentials, payload: { projectId, add: previous } },
        });
      },
    }),
    defineCommand({
      ...base,
      name: MIX_COMMANDS.setDucking,
      payload: mixCommandPayloads[MIX_COMMANDS.setDucking],
      handle: (p) =>
        write(
          p,
          (timeline) => {
            const ducking = { ...timeline.mix.ducking, ...p.ducking };
            const same = JSON.stringify(ducking) === JSON.stringify(timeline.mix.ducking);
            return {
              ok: true,
              timeline: same ? timeline : { ...timeline, mix: { ...timeline.mix, ducking } },
            };
          },
          (before) => ({
            name: MIX_COMMANDS.setDucking,
            payload: { projectId: p.projectId, timelineId: p.timelineId, ducking: before.mix.ducking },
          }),
        ),
    }),
    defineCommand({
      ...base,
      name: MIX_COMMANDS.setHits,
      payload: mixCommandPayloads[MIX_COMMANDS.setHits],
      handle: (p) =>
        write(p, (timeline) => {
          const tracks = withHits(timeline, p.hits);
          if (!tracks.ok) return tracks;
          const same = JSON.stringify(tracks.value) === JSON.stringify(timeline.tracks);
          return { ok: true, timeline: same ? timeline : { ...timeline, tracks: tracks.value } };
        }),
    }),
    defineCommand({
      ...base,
      name: VOICE_COMMANDS.removeVoiceover,
      payload: voiceCommandPayloads[VOICE_COMMANDS.removeVoiceover],
      handle: (p) =>
        write(
          p,
          (timeline) =>
            timeline.voiceover
              ? {
                  ok: true,
                  timeline: {
                    ...timeline,
                    tracks: timeline.tracks.filter(
                      (track) => !(track.kind === 'audio' && track.role === 'voice'),
                    ),
                    voiceover: null,
                  },
                }
              : { ok: true, timeline },
          (before) => ({
            name: TIMELINE_COMMANDS.restore,
            payload: {
              projectId: p.projectId,
              timelineId: p.timelineId,
              tracks: before.tracks,
              voiceover: before.voiceover,
            },
          }),
        ),
    }),
    defineCommand({
      ...base,
      name: TIMELINE_COMMANDS.setReframe,
      payload: timelineCommandPayloads[TIMELINE_COMMANDS.setReframe],
      handle: (p, context) =>
        write(p, (timeline) => {
          const video = timeline.tracks.find((track) => track.kind === 'video');
          const clip = video?.items.find((item) => item.id === p.clipId);
          if (!video || !clip)
            return { ok: false, error: timelineError('timeline.item_not_found', { itemId: p.clipId }) };
          if (clip.type !== 'clip' || clip.media.kind !== 'video')
            return {
              ok: false,
              error: ValidationError({ field: 'clipId' }, { detail: 'Only a video clip is reframed' }),
            };
          if (clip.locked && context.source === 'agent')
            return { ok: false, error: timelineError('timeline.clip_locked', { clipId: p.clipId }) };
          if (JSON.stringify(clip.reframe) === JSON.stringify(p.reframe)) return { ok: true, timeline };
          const items = video.items.map((item) => (item === clip ? { ...clip, reframe: p.reframe } : item));
          return {
            ok: true,
            timeline: {
              ...timeline,
              tracks: timeline.tracks.map((track) => (track === video ? { ...video, items } : track)),
            },
          };
        }),
    }),
  ];
}
