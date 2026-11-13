// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { setTimeout as delay } from 'node:timers/promises';
import {
  CancelledError,
  CommandBusToken,
  CreationStoreToken,
  ConflictError,
  err,
  ok,
  parseId,
  RationalTime,
  RENDER_COMMANDS,
  RenderStoreToken,
  renderWorkerOverRpc,
  TimelineStoreToken,
  ValidationError,
  type AssetId,
  type AsyncResult,
  type Container,
  type ProjectId,
  type TimelineId,
} from '@taalcut/core';
import type { CreationDirectorDeps } from '@taalcut/agent';
import { AgentMainServicesToken } from '../../shared/tokens';
import { keepCreationImage } from './browser';
import { authoredTimelines, publishCreation } from './publish';
import { readCreationTimeline } from './programs';
import { creationSoundNotes } from './sound-attention';

async function publishedVariants(container: Container, projectId: ProjectId) {
  const project = await container.resolve(CreationStoreToken).get(projectId);
  if (!project.ok) return project;
  const variants = await authoredTimelines(container, projectId);
  if (!variants.ok) return variants;
  const base = project.value.publicationBase ?? [];
  const selected = variants.value.filter((timeline) =>
    base.some((entry) => entry.timelineId === timeline.id),
  );
  if (selected.length !== base.length || !selected.length)
    return err(ValidationError({ field: 'publicationBase' }, { detail: 'Published variants are missing' }));
  const changed = selected.find(
    (timeline) => base.find((entry) => entry.timelineId === timeline.id)?.revision !== timeline.revision,
  );
  return changed ? err(ConflictError({ entity: 'timeline', id: changed.id })) : ok(selected);
}

export function creationMedia(
  container: Container,
): Pick<CreationDirectorDeps, 'preview' | 'review' | 'finalize'> {
  const worker = renderWorkerOverRpc(() => container.resolve(AgentMainServicesToken)().render);
  return {
    async preview(scene, _brief, signal, projectId) {
      const project = await container.resolve(CreationStoreToken).get(projectId);
      if (!project.ok) return project;
      const draft = project.value.draft;
      const beat = draft?.beats.find((item) => item.id === scene.beatId);
      if (!draft || !beat) return err(ValidationError({ field: 'draft' }));
      const timelineId = await publishCreation(
        container,
        { project: project.value, draft: { ...draft, beats: [beat] }, scenes: [scene], voice: null },
        signal,
        true,
      );
      if (!timelineId.ok) return timelineId;
      const frame = await worker.captureFrame(
        {
          projectId,
          timelineId: timelineId.value,
          frame: Math.max(1, Math.round(RationalTime.toSeconds(beat.duration) * 60 * 0.45)),
          source: { kind: 'preview' },
          maxDimension: 1280,
        },
        { signal },
      );
      return frame.ok
        ? keepCreationImage(
            container,
            Buffer.from(frame.value.dataBase64, 'base64'),
            'style-preview',
            'image/jpeg',
          )
        : frame;
    },
    async review(timelineId, signal) {
      const current = await container.resolve(TimelineStoreToken).get(timelineId);
      if (!current.ok) return current;
      const variants = await publishedVariants(container, current.value.summary.projectId);
      if (!variants.ok) return variants;
      const frames: AssetId[] = [];
      const notes: string[] = [];
      for (const timeline of variants.value) {
        const program = timeline.authoredPrograms?.[0];
        if (!program) return err(ValidationError({ field: 'program' }));
        const points = program.chapters
          .flatMap((chapter) => [
            Math.round(RationalTime.toSeconds(chapter.start) * 60 + 1),
            Math.round(
              (RationalTime.toSeconds(chapter.start) + RationalTime.toSeconds(chapter.duration) * 0.55) * 60,
            ),
          ])
          .filter((frame) => frame < program.duration.value);
        // Capture a frame on both sides of every seam and one readable hold per chapter.
        for (const chapter of program.chapters.slice(1)) points.push(Math.max(0, chapter.start.value - 1));
        for (const at of [...new Set(points)]) {
          if (signal.aborted) return err(CancelledError());
          const captured = await worker.captureFrame(
            {
              projectId: timeline.projectId,
              timelineId: timeline.id,
              timelineRevision: timeline.revision,
              frame: at,
              source: { kind: 'preview' },
              maxDimension: 960,
            },
            { signal },
          );
          if (!captured.ok) return captured;
          if (captured.value.textBoxes.some((box) => !box.inSafeZone))
            notes.push(`Text leaves safe area at frame ${at} in ${timeline.name}`);
          const kept = await keepCreationImage(
            container,
            Buffer.from(captured.value.dataBase64, 'base64'),
            'creation-review',
            'image/jpeg',
          );
          if (!kept.ok) return kept;
          frames.push(kept.value);
        }
      }
      return ok({ passed: notes.length === 0, notes, frameAssetIds: frames });
    },
    async finalize(timelineId, signal) {
      const current = await container.resolve(TimelineStoreToken).get(timelineId);
      if (!current.ok) return current;
      const variants = await publishedVariants(container, current.value.summary.projectId);
      if (!variants.ok) return variants;
      for (const timeline of variants.value) {
        const done = await exportCreation(
          container,
          timeline.projectId,
          timeline.id,
          timeline.revision,
          signal,
        );
        if (!done.ok) return done;
      }
      return ok(undefined);
    },
  };
}

async function exportCreation(
  container: Container,
  projectId: ProjectId,
  timelineId: TimelineId,
  expectedRevision: number,
  signal: AbortSignal,
): AsyncResult<void> {
  const timeline = await readCreationTimeline(container.resolve(TimelineStoreToken), {
    projectId,
    timelineId,
  });
  if (!timeline.ok) return timeline;
  if (timeline.value.revision !== expectedRevision)
    return err(ConflictError({ entity: 'timeline', id: timelineId }));
  if (signal.aborted) return err(CancelledError());
  const bus = container.resolve(CommandBusToken);
  const queued = await bus.dispatch(
    RENDER_COMMANDS.export,
    {
      projectId,
      timelineId,
      timelineRevision: timeline.value.revision,
      presetId:
        timeline.value.canvas.width > timeline.value.canvas.height
          ? 'landscape'
          : timeline.value.canvas.width === timeline.value.canvas.height
            ? 'square'
            : timeline.value.canvas.height === 1350
              ? 'portrait'
              : 'device',
      captions: { burnIn: false, sidecars: [] },
      notify: false,
      includeBumpers: false,
    },
    { source: 'agent', actor: `creation:${projectId}` },
  );
  if (!queued.ok) return queued;
  const result = queued.value.result as { renderId?: unknown };
  const renderId = parseId<'Render'>(result.renderId);
  if (!renderId.ok) return renderId;
  const stop = () => {
    void bus.dispatch(
      RENDER_COMMANDS.cancel,
      { projectId, renderId: renderId.value },
      { source: 'agent', actor: `creation:${projectId}` },
    );
  };
  signal.addEventListener('abort', stop, { once: true });
  try {
    // Dispatch may have queued the render while cancellation was waiting for its id.
    if (signal.aborted) stop();
    for (let attempt = 0; attempt < 2700; attempt++) {
      if (signal.aborted) return err(CancelledError());
      const record = await container.resolve(RenderStoreToken).get(renderId.value);
      if (!record.ok) return record;
      if (record.value.status === 'ready') {
        // EAR1-A4: the export's sound, critiqued against the launch films (render QA's soundCritique): a silence
        // the film shouldn't have needs the person's attention, with its time.
        const notes = creationSoundNotes(record.value.qaReport ?? null, timeline.value.name);
        return notes.length === 0
          ? ok(undefined)
          : err(
              ValidationError(
                { field: 'sound' },
                { detail: `The exported sound needs attention: ${notes.join('; ')}` },
              ),
            );
      }
      if (['failed', 'cancelled', 'needsAttention'].includes(record.value.status))
        return err(
          ValidationError(
            { field: 'render' },
            {
              detail: `The encoded film requires review: ${record.value.error?.code ?? record.value.status}`,
            },
          ),
        );
      await delay(1000, undefined, { signal }).catch(() => undefined);
    }
    stop();
    return err(
      ValidationError({ field: 'render' }, { detail: 'The render exceeded its 45-minute production limit' }),
    );
  } finally {
    signal.removeEventListener('abort', stop);
  }
}
