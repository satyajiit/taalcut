// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { err, idSchema, ok, type AsyncResult, type CreationDraft, type CreationProject } from '@taalcut/core';
import { z } from 'zod';
import {
  CreationApprovalRequired,
  CreationInputsChanged,
  CreationOutputInvalid,
  CreationReviewFailed,
} from './errors';
import type { CreationDirectorDeps, CreationVoiceArtifact } from './ports';
import { CREATION_REVIEWER_PROMPT, CREATION_VISUAL_REVIEWER_PROMPT } from './prompts';
import { makeCreationScene } from './scenes';
import type { CreationState } from './state';
import { creationTasks, type CreationTasks, type CreationWorkers } from './tasks';
import { conformCreationVoice } from './voice-timing';
import { makeCreationMaster } from './master-scene';
import { creationMotionOf } from './motion-contract';
import { creationRepairNotes } from './repair';

const reviewSchema = z.object({ passed: z.boolean(), notes: z.array(z.string().max(2000)).max(30) });
const voiceSchema = z.object({
  usageMicros: z.int().nonnegative(),
  assetIds: z.array(idSchema<'Asset'>()),
  lines: z.array(
    z.object({
      beatId: z.string(),
      assetId: idSchema<'Asset'>(),
      durationMs: z.number().positive(),
      sourceStartMs: z.number().nonnegative().optional(),
    }),
  ),
});

async function voice(
  deps: CreationDirectorDeps,
  project: CreationProject,
  draft: CreationDraft,
  tasks: CreationTasks,
  signal: AbortSignal,
): AsyncResult<CreationVoiceArtifact | null> {
  if (project.brief.voice.mode === 'none') return ok(null);
  return tasks.execute(
    'voice',
    'voice',
    draft.revision,
    (value) => {
      const parsed = voiceSchema.safeParse(value);
      return parsed.success ? ok(parsed.data) : err(CreationOutputInvalid());
    },
    (task) =>
      tasks.charge(task, deps.estimateVoice(project, draft), async () => {
        const result = await deps.voice(project, draft, signal);
        return result.ok
          ? ok({ value: result.value, usageMicros: result.value.usageMicros, tokens: 0 })
          : result;
      }),
  );
}

export async function produceCreation(
  deps: CreationDirectorDeps,
  state: CreationState,
  project: CreationProject,
  signal: AbortSignal,
  workers: CreationWorkers,
): AsyncResult<CreationProject> {
  let draft = project.draft;
  if (
    !draft ||
    draft.answersPending ||
    project.approvedDraftRevision !== draft.revision ||
    draft.questions.some((q) => q.required && !q.answer?.trim())
  )
    return err(CreationApprovalRequired());
  if (draft.beats.length > 12)
    return err(CreationOutputInvalid(undefined, { detail: 'Use at most twelve story beats.' }));
  if (project.status === 'ready' && project.timelineId) return ok(project);
  const tasks = creationTasks(deps, state, project.projectId, signal, workers);
  const director = await state.task(project.projectId, 'director:produce', 'director', draft.revision);
  if (!director.ok) return director;
  const running = await state.patch(project.projectId, director.value.id, {
    status: 'running',
    progress: 0.1,
  });
  if (!running.ok) return running;
  const started = await state.update(project.projectId, (p) => ({ ...p, status: 'producing', error: null }));
  if (!started.ok) return started;
  const speech = await voice(deps, project, draft, tasks, signal);
  if (!speech.ok) return speech;
  draft = conformCreationVoice(draft, speech.value);
  let notes: readonly string[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const [scenes, masters] = await Promise.all([
      Promise.all(
        project.brief.formats.flatMap((format) =>
          draft.beats.map((beat) =>
            makeCreationScene(tasks, project, draft, beat, format, false, notes, attempt),
          ),
        ),
      ),
      Promise.all(
        project.brief.formats.map((format) =>
          makeCreationMaster(tasks, project, draft, format, notes, attempt),
        ),
      ),
    ]);
    const failures = [...scenes, ...masters].filter((scene) => !scene.ok);
    const fatal = failures.find((failure) => !creationRepairNotes(failure.error));
    if (fatal) return fatal;
    if (failures.length) {
      notes = failures.flatMap((failure) => creationRepairNotes(failure.error) ?? []);
      continue;
    }
    const produced = scenes.flatMap((scene) => (scene.ok ? [scene.value] : []));
    const masterScenes = masters.flatMap((scene) => (scene.ok ? [scene.value] : []));
    const reviewed = await tasks.model(
      `review:source:${attempt}`,
      'reviewer',
      draft.revision,
      reviewSchema,
      CREATION_REVIEWER_PROMPT,
      JSON.stringify({
        draft,
        scenes: produced,
        masterScenes,
        motionContract: creationMotionOf(project, draft.revision),
        sources: project.sources.map((s) => ({ id: s.id, evidence: s.evidence })),
      }),
      project.sources.flatMap((source) => source.assetIds).slice(0, 12),
    );
    if (!reviewed.ok) return reviewed;
    if (!reviewed.value.passed) {
      notes = reviewed.value.notes;
      continue;
    }
    const latest = await deps.store.get(project.projectId);
    if (!latest.ok) return latest;
    if (
      latest.value.draft?.revision !== draft.revision ||
      latest.value.approvedDraftRevision !== draft.revision
    )
      return err(CreationInputsChanged());
    const published = await deps.publish(
      { project: latest.value, draft, scenes: produced, masterScenes, voice: speech.value },
      signal,
    );
    if (!published.ok) {
      const repair = creationRepairNotes(published.error);
      if (!repair) return published;
      notes = repair;
      continue;
    }
    const kept = await state.update(project.projectId, (p) => ({ ...p, timelineId: published.value }));
    if (!kept.ok) return kept;
    const visual = await deps.review(published.value, signal);
    if (!visual.ok) return visual;
    if (!visual.value.passed) {
      notes = visual.value.notes;
      continue;
    }
    const frames = visual.value.frameAssetIds ?? [];
    const findings: string[] = [];
    let passed = true;
    for (let offset = 0; offset < frames.length; offset += 12) {
      const judged = await tasks.model(
        `review:visual:${attempt}:${offset / 12}`,
        'reviewer',
        draft.revision,
        reviewSchema,
        CREATION_VISUAL_REVIEWER_PROMPT,
        JSON.stringify({
          draft,
          checks: visual.value.notes,
          frameOffset: offset,
          totalFrames: frames.length,
        }),
        frames.slice(offset, offset + 12),
      );
      if (!judged.ok) return judged;
      if (!judged.value.passed) {
        passed = false;
        findings.push(...judged.value.notes);
      }
    }
    if (!passed) {
      notes = findings.length ? findings : ['The captured frames did not pass visual review.'];
      continue;
    }
    const exported = await deps.finalize(published.value, signal);
    if (!exported.ok) return exported;
    const finished = await state.patch(project.projectId, director.value.id, {
      status: 'completed',
      progress: 1,
    });
    if (!finished.ok) return finished;
    const saved = await state.update(project.projectId, (p) =>
      p.draft?.revision === draft.revision
        ? { ...p, timelineId: published.value, status: 'ready', error: null }
        : p,
    );
    return saved.ok && saved.value.draft?.revision !== draft.revision ? err(CreationInputsChanged()) : saved;
  }
  return err(CreationReviewFailed(undefined, { detail: notes.join('\n').slice(0, 2000) }));
}
