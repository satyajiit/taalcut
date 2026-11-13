// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* eslint-disable lingui/no-unlocalized-strings -- fixture content and error identifiers */

import {
  CREATION_COMMANDS as C,
  CREATION_ROLES,
  ConflictError,
  NotFoundError,
  ValidationError,
  creationCommandPayloads,
  creationProjectSchema,
  creationRouter,
  defineCommand,
  err,
  newId,
  ok,
  type AnyCommand,
  type AuthoredInspection,
  type CreationProject,
  type ProjectId,
  type TimelineId,
} from '@taalcut/core';
import type { z } from 'zod';
import type { FakeMake } from '../make/fake-make';
import {
  CREATION_DEMO,
  CREATION_PREVIEW,
  creationDemo,
  creationDraft,
  creationTimeline,
} from './creation-fixtures';
import { editCreationFixture } from './creation-edit';
import { rangeCreationFixture } from './creation-range';

export function createFakeCreation(make: FakeMake) {
  const projects = new Map<ProjectId, CreationProject>([[CREATION_DEMO, creationDemo()]]);
  let demoOpened = false;
  const inspections = new Map<TimelineId, AuthoredInspection>();
  const missing = (id: string) => NotFoundError({ entity: 'creation', id });
  const read = (projectId: ProjectId) => {
    const found = projects.get(projectId);
    if (found && projectId === CREATION_DEMO && !demoOpened) {
      make.projects.addCreation(projectId, found.brief.title);
      demoOpened = true;
    }
    return found ? ok(structuredClone(found)) : err(missing(projectId));
  };
  const router = creationRouter({
    list: async () =>
      ok({
        items: [...projects.values()]
          .filter((project) => project.projectId !== CREATION_DEMO)
          .map((project) => structuredClone(project)),
      }),
    get: async ({ projectId }) => read(projectId),
    inspect: async ({ timelineId }) => {
      const found = inspections.get(timelineId);
      return found ? ok(structuredClone(found)) : err(missing(timelineId));
    },
  });
  const commands: AnyCommand[] = Object.entries(creationCommandPayloads).map(([name, schema]) =>
    defineCommand({
      name,
      payload: schema as z.ZodType<Record<string, unknown>>,
      sideEffect: 'write',
      project: (input) => (input.projectId as ProjectId) ?? null,
      handle: async (input) => {
        if (name === C.create) {
          const parsed = creationCommandPayloads[C.create].parse(input);
          const projectId = parsed.projectId ?? newId<'Project'>();
          if (projects.has(projectId)) return err(ConflictError({ entity: 'creation', id: projectId }));
          const project: CreationProject = {
            projectId,
            revision: 1,
            brief: parsed.brief,
            sources: [],
            draft: null,
            approvedDraftRevision: null,
            status: 'draft',
            tasks: [],
            budget: { capMicros: null, spentMicros: 0, reservedMicros: 0 },
            timelineId: null,
            error: null,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };
          projects.set(projectId, project);
          make.projects.addCreation(projectId, project.brief.title);
          return ok({ result: project });
        }
        const id = input.projectId as ProjectId;
        const existing = projects.get(id);
        if (!existing) return err(missing(id));
        const before = structuredClone(existing);
        if (name === C.restore) {
          const parsed = creationProjectSchema.safeParse(input.snapshot);
          if (!parsed.success) return err(ValidationError({ field: 'snapshot' }));
          projects.set(id, { ...parsed.data, revision: before.revision + 1 });
          return ok({
            result: projects.get(id),
            inverse: { name: C.restore, payload: { projectId: id, snapshot: before } },
          });
        }
        if (name === C.setProgramRange) {
          const timeline = make.timelines.get(input.timelineId as TimelineId);
          if (!timeline) return err(missing(String(input.timelineId)));
          if (timeline.projectId !== id) return err(ValidationError({ field: 'projectId' }));
          if (timeline.revision !== input.revision)
            return err(ConflictError({ entity: 'timeline', id: timeline.id }));
          const edited = rangeCreationFixture(timeline, input);
          if (!edited.ok) return edited;
          make.timelines.replace(id, edited.value);
          return ok({ result: null });
        }
        if (name === C.editProgram || name === C.replaceSource) {
          const timeline = make.timelines.get(input.timelineId as TimelineId);
          const inspection = inspections.get(input.timelineId as TimelineId);
          if (!timeline || !inspection) return err(missing(String(input.timelineId)));
          if (timeline.revision !== input.revision)
            return err(ConflictError({ entity: 'timeline', id: timeline.id }));
          if (name === C.replaceSource)
            inspection.source = creationCommandPayloads[C.replaceSource].parse(input).source;
          else editCreationFixture(inspection, creationCommandPayloads[C.editProgram].parse(input).edits);
          inspection.program = {
            ...inspection.program,
            version: inspection.program.version + 1,
            hash: String((inspection.program.version + 1) % 10).repeat(64),
          };
          make.timelines.replace(id, {
            ...timeline,
            authoredPrograms: [inspection.program],
            tracks: timeline.tracks.map((track) =>
              track.kind === 'video'
                ? {
                    ...track,
                    items: track.items.map((item) =>
                      item.type === 'program'
                        ? { ...item, program: { id: inspection.program.id, hash: inspection.program.hash } }
                        : item,
                    ),
                  }
                : track,
            ),
          });
          return ok({ result: null });
        }
        if ('revision' in input && input.revision !== before.revision)
          return err(ConflictError({ entity: 'creation', id }));
        const next = structuredClone(before);
        const invalidate = () => {
          next.approvedDraftRevision = null;
          next.status = 'draft';
          next.draft = null;
        };
        if (name === C.updateBrief) {
          next.brief = creationCommandPayloads[C.updateBrief].parse(input).brief;
          invalidate();
        }
        if (name === C.addSource) {
          next.sources.push({
            ...creationCommandPayloads[C.addSource].parse(input).source,
            status: 'pending',
            evidence: [],
            assetIds: [],
          });
          invalidate();
        }
        if (name === C.removeSource) {
          next.sources = next.sources.filter((source) => source.id !== input.sourceId);
          invalidate();
        }
        if (name === C.research) {
          next.sources = next.sources.map((source) => ({
            ...source,
            status: 'ready',
            evidence: [
              {
                sourceId: source.id,
                locator: source.url ?? source.label,
                summary: `Product evidence from ${source.label}.`,
              },
            ],
          }));
          next.draft = next.draft
            ? { ...next.draft, answersPending: false, visualPreviewAssetId: CREATION_PREVIEW }
            : creationDraft(next);
          next.status = 'awaiting-approval';
          next.approvedDraftRevision = null;
        }
        if (name === C.updateDraft) {
          const parsed = creationCommandPayloads[C.updateDraft].parse(input);
          if (parsed.draftRevision !== next.draft?.revision) return err(ConflictError({ entity: 'draft' }));
          next.draft = { ...parsed.draft, revision: parsed.draftRevision + 1, visualPreviewAssetId: null };
          next.approvedDraftRevision = null;
          next.status = 'awaiting-approval';
        }
        if (name === C.answer) {
          const parsed = creationCommandPayloads[C.answer].parse(input);
          if (parsed.draftRevision !== next.draft?.revision) return err(ConflictError({ entity: 'draft' }));
          next.draft = {
            ...next.draft,
            revision: next.draft.revision + 1,
            answersPending: true,
            visualPreviewAssetId: null,
            questions: next.draft.questions.map((question) => ({
              ...question,
              answer: parsed.answers.find((answer) => answer.id === question.id)?.answer ?? question.answer,
            })),
          };
          next.approvedDraftRevision = null;
          next.status = 'draft';
        }
        if (name === C.approve) {
          if (
            !next.draft ||
            !next.draft.visualPreviewAssetId ||
            next.draft.answersPending ||
            next.draft.revision !== input.draftRevision ||
            next.draft.questions.some((question) => question.required && !question.answer?.trim())
          )
            return err(ValidationError({ field: 'draft' }));
          next.approvedDraftRevision = next.draft.revision;
        }
        if (name === C.approve || name === C.produce || name === C.resume || name === C.retry) {
          if (!next.draft || next.approvedDraftRevision !== next.draft.revision)
            return err(ValidationError({ field: 'approval' }));
          const { timeline, inspection } = creationTimeline(next);
          make.timelines.addCreation(timeline);
          inspections.set(timeline.id, inspection);
          next.timelineId = timeline.id;
          next.status = 'ready';
          next.tasks = CREATION_ROLES.map((role) => ({
            id: newId<'CreationTask'>(),
            key: role,
            role,
            inputRevision: next.revision,
            costMicros: 0,
            tokens: 0,
            parentId: null,
            status: 'completed',
            progress: 1,
            message: 'Complete',
            artifact: null,
          }));
        }
        if (name === C.cancel) next.status = 'cancelled';
        next.revision += 1;
        next.updatedAt = Date.now();
        projects.set(id, next);
        return ok({
          result: next,
          inverse: { name: C.restore, payload: { projectId: id, snapshot: before } },
        });
      },
    }),
  );
  return { router, commands, get: read };
}
