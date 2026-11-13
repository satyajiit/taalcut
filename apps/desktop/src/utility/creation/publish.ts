// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  AuthoredProgramStoreToken,
  authoredProgramSchema,
  CommandBusToken,
  ConflictError,
  defineCommand,
  err,
  idSchema,
  newId,
  ok,
  RationalTime,
  timelineSchema,
  TimelineStoreToken,
  ValidationError,
  type AsyncResult,
  type Container,
  type CreationDraft,
  type CreationProject,
  type ProjectId,
  type Timeline,
  type TimelineId,
} from '@taalcut/core';
import type { CreationPublishInput, CreationVoiceArtifact } from '@taalcut/agent';
import { createAuthoredTimeline } from '@taalcut/timeline';
import { z } from 'zod';
import { creationCommandKit } from './command-kit';
import { readCreationTimeline } from './programs';
import { buildCreationProgram } from './source-builder';

export const PUBLISH_CREATION = 'creation.publishProgram';
const publishSchema = z.object({
  projectId: idSchema<'Project'>(),
  draftRevision: z.int().positive(),
  preview: z.boolean(),
  rows: z
    .array(
      z.object({
        program: authoredProgramSchema,
        timeline: timelineSchema,
        expectedRevision: z.int().nonnegative(),
      }),
    )
    .min(1)
    .max(4),
});

export function creationPublishCommand(container: Container) {
  const kit = creationCommandKit(container);
  return defineCommand({
    name: PUBLISH_CREATION,
    payload: publishSchema,
    internal: true,
    sideEffect: 'write',
    handle: kit.handle(async (input, context) => {
      const project = await kit.store.get(input.projectId);
      if (!project.ok) return project;
      if (
        project.value.draft?.revision !== input.draftRevision ||
        (!input.preview && project.value.approvedDraftRevision !== input.draftRevision)
      )
        return err(ValidationError({ field: 'draftRevision' }, { detail: 'Publication inputs changed' }));
      for (const row of input.rows) {
        if (row.timeline.projectId !== input.projectId) return err(ValidationError({ field: 'projectId' }));
        const expected =
          project.value.publicationBase?.find((entry) => entry.timelineId === row.timeline.id)?.revision ?? 0;
        if (!input.preview && expected !== row.expectedRevision)
          return err(
            ConflictError(
              { entity: 'timeline', id: row.timeline.id },
              { detail: 'The timeline was edited during production; those edits have been preserved' },
            ),
          );
        const program = await kit.programs.save(input.projectId, row.program, context);
        if (!program.ok) return program;
        const timeline =
          row.expectedRevision === 0
            ? await kit.timelines.create(row.timeline, context)
            : await kit.timelines.put(row.timeline, row.expectedRevision, context);
        if (!timeline.ok) return timeline;
        kit.note(context, 'timeline', row.timeline.id);
      }
      if (!input.preview) {
        const saved = await kit.store.save(
          {
            ...project.value,
            revision: project.value.revision + 1,
            updatedAt: Date.now(),
            timelineId: input.rows[0]!.timeline.id,
            publicationBase: input.rows.map((row) => ({
              timelineId: row.timeline.id,
              revision: row.expectedRevision + 1,
            })),
          },
          project.value.revision,
          context,
        );
        if (!saved.ok) return saved;
        kit.note(context, 'project', input.projectId);
      }
      return ok({ result: { timelineId: input.rows[0]!.timeline.id } });
    }),
  });
}

function addVoice(
  timeline: Timeline,
  project: CreationProject,
  draft: CreationDraft,
  voice: CreationVoiceArtifact | null,
): Timeline {
  if (!voice?.lines.length) return timeline;
  // A single recorded take stays a single clip. Scene boundaries never splice or restart the voice.
  const assetId = voice.lines[0]!.assetId;
  if (!voice.lines.every((line) => line.assetId === assetId))
    throw new Error('Creation voice must be one continuous take');
  const durationMs = Math.max(...voice.lines.map((line) => (line.sourceStartMs ?? 0) + line.durationMs));
  const duration = RationalTime.of(Math.round(durationMs), { num: 1000, den: 1 });
  const zero = RationalTime.of(0, duration.rate);
  const clipId = newId<'TimelineItem'>();
  return {
    ...timeline,
    tracks: [
      ...timeline.tracks,
      {
        kind: 'audio',
        id: 'A1',
        name: 'Voiceover',
        enabled: true,
        role: 'voice',
        items: [
          {
            type: 'clip',
            id: clipId,
            media: { kind: 'audio', assetId, available: { start: zero, duration } },
            sourceStart: zero,
            duration: RationalTime.rescale(duration, timeline.canvas.rate, 'round'),
            speed: null,
            slotId: null,
            syncPoint: null,
            beatAnchor: null,
            fit: 'contain',
            audio: { gainDb: 0, muted: false },
            locked: false,
            enabled: true,
            stillMotion: null,
            reframe: null,
          },
        ],
      },
    ],
    voiceover: {
      id: newId<'Voiceover'>(),
      voiceId: project.brief.voice.voiceId ?? 'recording',
      voiceName: '',
      own: project.brief.voice.mode === 'upload',
      language: project.brief.voice.language,
      seed: 42,
      lines: voice.lines.map((line) => ({
        id: newId<'VoiceLine'>(),
        text: (draft.beats.find((beat) => beat.id === line.beatId)?.narration || line.beatId).slice(0, 500),
        slotId: null,
        clipId,
        assetId: line.assetId,
        quality: 'final',
        offBeat: false,
        duration: RationalTime.of(Math.round(line.durationMs), { num: 1000, den: 1 }),
      })),
    },
  };
}

export async function authoredTimelines(
  container: Container,
  projectId: ProjectId,
  preview = false,
): AsyncResult<Timeline[]> {
  const store = container.resolve(TimelineStoreToken);
  const rows = await store.listByProject(projectId);
  if (!rows.ok) return rows;
  const result: Timeline[] = [];
  for (const row of rows.value) {
    const timeline = await readCreationTimeline(store, { projectId, timelineId: row.id });
    if (!timeline.ok) return timeline;
    if (timeline.value.authoredPrograms?.some((p) => p.entry.startsWith(preview ? 'style-' : 'film-')))
      result.push(timeline.value);
  }
  return ok(result);
}

export async function publishCreation(
  container: Container,
  input: CreationPublishInput,
  signal: AbortSignal,
  preview = false,
): AsyncResult<TimelineId> {
  if (signal.aborted) return err(ValidationError({ field: 'run' }, { detail: 'Publication was cancelled' }));
  const existing = await authoredTimelines(container, input.project.projectId, preview);
  if (!existing.ok) return existing;
  const rows: z.output<typeof publishSchema>['rows'] = [];
  for (const format of [...new Set(input.scenes.map((scene) => scene.format))]) {
    const entry = `${preview ? 'style' : 'film'}-${format.replace(':', '-')}.html`;
    const before = existing.value.find((timeline) =>
      timeline.authoredPrograms?.some((p) => p.entry === entry),
    );
    const scenes = input.scenes.filter((scene) => scene.format === format);
    const result = await buildCreationProgram(
      container,
      container.resolve(AuthoredProgramStoreToken),
      input.project.projectId,
      input.draft,
      scenes,
      format,
      input.project.sources.flatMap((source) => source.assetIds),
      before?.authoredPrograms?.[0],
      preview,
      input.masterScenes?.find((scene) => scene.format === format),
    );
    if (!result.ok) return result;
    const timeline = createAuthoredTimeline({
      projectId: input.project.projectId,
      program: result.value.program,
      name: `${preview ? 'Style preview' : input.draft.title} (${format})`,
      ...(before ? { timelineId: before.id } : {}),
    });
    if (!timeline.ok) return timeline;
    rows.push({
      program: result.value.program,
      timeline: addVoice(timeline.value, input.project, input.draft, input.voice),
      expectedRevision: before?.revision ?? 0,
    });
  }
  const saved = await container.resolve(CommandBusToken).dispatch(
    PUBLISH_CREATION,
    {
      projectId: input.project.projectId,
      draftRevision: input.draft.revision,
      preview,
      rows,
    },
    { source: 'agent', actor: `creation:${input.project.projectId}` },
  );
  return saved.ok ? ok(rows[0]!.timeline.id) : saved;
}
