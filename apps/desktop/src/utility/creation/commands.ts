// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  ConflictError,
  CREATION_COMMANDS as names,
  creationCommandPayloads as payloads,
  creationProjectSchema,
  DEFAULT_PROJECT_CAP_SETTING,
  defineCommand,
  err,
  ok,
  PERSON_SOURCES,
  PROJECT_COMMANDS,
  SettingsStoreToken,
  ValidationError,
  type AnyCommand,
  type CommandContext,
  type CreationProject,
  type CreationStore,
  type Container,
  type ProjectId,
  type Result,
} from '@taalcut/core';
import { z } from 'zod';
import { persistableCreationUrl } from './source-input';
import { resolveCreationDirectory } from '../../shared/creation-grants';
import { creationCommandKit, type CreationCommandKit } from './command-kit';
import { creationEditCommands } from './edit-commands';
import { authoredTimelines } from './publish';
import { stageCreationProjectName } from './project-name';

export const SAVE_CREATION_STATE = 'creation.saveState';
const changeSchema = z.object({ project: creationProjectSchema, expectedRevision: z.int().nonnegative() });
const invalid = (detail: string) => err(ValidationError({ field: 'creation' }, { detail }));
const busy = (project: CreationProject) => ['researching', 'producing'].includes(project.status);
const fresh = (project: CreationProject): CreationProject => ({
  ...project,
  draft: null,
  approvedDraftRevision: null,
  tasks: [],
  status: 'draft',
  error: null,
});

// Brand evidence depends on the unchanged inputs, not on a script's edit revision.
const draftEvidence = (project: CreationProject, revision: number) =>
  project.tasks
    .filter((task) => task.key === 'brand:logos' && task.status === 'completed')
    .map((task) => ({ ...task, inputRevision: revision, parentId: null }));

export function creationCommands(container: Container, userData: string) {
  const kit = creationCommandKit(container);
  async function productionBase(project: CreationProject): Promise<Result<CreationProject>> {
    const timelines = await authoredTimelines(container, project.projectId);
    return timelines.ok
      ? ok({
          ...project,
          publicationBase: timelines.value.map((timeline) => ({
            timelineId: timeline.id,
            revision: timeline.revision,
          })),
        })
      : timelines;
  }
  function mutation<P extends { projectId: ProjectId; revision?: number }>(
    name: string,
    schema: z.ZodType<P>,
    apply: (
      project: CreationProject,
      payload: P,
    ) => Result<CreationProject> | Promise<Result<CreationProject>>,
    options: { idle?: boolean; undo?: boolean; person?: boolean } = {},
  ): AnyCommand {
    return defineCommand({
      name,
      payload: schema,
      sideEffect: 'write',
      ...(options.person ? { sources: PERSON_SOURCES } : {}),
      handle: kit.handle(async (payload, context) => {
        const found = await kit.store.get(payload.projectId);
        if (!found.ok) return found;
        if (
          context.replay !== 'redo' &&
          payload.revision !== undefined &&
          payload.revision !== found.value.revision
        )
          return err(ConflictError({ entity: 'creationProject', id: payload.projectId }));
        if (options.idle && busy(found.value))
          return invalid('Cancel the current run before editing its inputs');
        const next = await apply(found.value, payload);
        if (!next.ok) return next;
        return saveCreationMutation(kit, found.value, next.value, context, options.undo ?? true);
      }),
    });
  }
  const create = defineCommand({
    name: names.create,
    payload: payloads[names.create],
    sideEffect: 'write',
    project: () => null,
    handle: kit.handle(async (input, context) => {
      const projectId = input.projectId ?? (context.commandId as string as ProjectId);
      const existing = await kit.store.get(projectId);
      if (existing.ok) {
        const restored = kit.stage(context, () => kit.projects.unarchive(projectId));
        if (!restored.ok) return restored;
        kit.note(context, 'project', projectId);
        return ok({
          result: existing.value,
          inverse: { name: PROJECT_COMMANDS.archive, payload: { projectId } },
        });
      }
      const cap = await container.resolve(SettingsStoreToken).get(DEFAULT_PROJECT_CAP_SETTING);
      if (!cap.ok) return cap;
      const staged = kit.stage(context, () =>
        kit.projects.create({ id: projectId, name: input.brief.title, budgetCap: cap.value }),
      );
      if (!staged.ok) return staged;
      const now = Date.now();
      const project: CreationProject = {
        projectId,
        revision: 1,
        brief: input.brief,
        sources: [],
        draft: null,
        approvedDraftRevision: null,
        status: 'draft',
        tasks: [],
        timelineId: null,
        error: null,
        budget: { capMicros: cap.value?.micros ?? null, spentMicros: 0, reservedMicros: 0 },
        createdAt: now,
        updatedAt: now,
      };
      const saved = await kit.store.save(project, 0, context);
      if (!saved.ok) return saved;
      kit.note(context, 'project', projectId);
      return ok({ result: project, inverse: { name: PROJECT_COMMANDS.archive, payload: { projectId } } });
    }),
  });
  const all: AnyCommand[] = [
    create,
    mutation(
      names.updateBrief,
      payloads[names.updateBrief],
      (p, input) => ok({ ...fresh(p), brief: input.brief }),
      { idle: true },
    ),
    mutation(
      names.addSource,
      payloads[names.addSource],
      async (p, input) => {
        if (input.source.kind === 'url' && !persistableCreationUrl(input.source.url ?? ''))
          return invalid('Attach a public HTTP(S) URL without credentials');
        if (p.sources.length >= 50 || p.sources.some((s) => s.id === input.source.id))
          return invalid('Repeated source or source limit');
        if (input.source.kind === 'directory') {
          const grant = await resolveCreationDirectory(userData, input.source.accessId!);
          if (!grant.ok) return grant;
        }
        return ok({
          ...fresh(p),
          sources: [...p.sources, { ...input.source, status: 'pending', evidence: [], assetIds: [] }],
        });
      },
      { idle: true },
    ),
    mutation(
      names.removeSource,
      payloads[names.removeSource],
      (p, input) => ok({ ...fresh(p), sources: p.sources.filter((s) => s.id !== input.sourceId) }),
      { idle: true },
    ),
    mutation(
      names.updateDraft,
      payloads[names.updateDraft],
      (p, input) => {
        if (!p.draft || p.draft.revision !== input.draftRevision) return invalid('The draft changed');
        return ok({
          ...p,
          draft: { ...input.draft, revision: p.draft.revision + 1, visualPreviewAssetId: null },
          tasks: draftEvidence(p, p.draft.revision + 1),
          approvedDraftRevision: null,
          status: 'draft',
          error: null,
        });
      },
      { idle: true },
    ),
    mutation(
      names.answer,
      payloads[names.answer],
      (p, input) => {
        if (!p.draft || p.draft.revision !== input.draftRevision) return invalid('The draft changed');
        const answers = new Map(input.answers.map((answer) => [answer.id, answer.answer]));
        if (input.answers.some((answer) => !p.draft!.questions.some((q) => q.id === answer.id)))
          return invalid('The question changed');
        return ok({
          ...p,
          approvedDraftRevision: null,
          tasks: draftEvidence(p, p.draft.revision + 1),
          status: 'draft',
          error: null,
          draft: {
            ...p.draft,
            revision: p.draft.revision + 1,
            visualPreviewAssetId: null,
            answersPending: true,
            questions: p.draft.questions.map((question) => ({
              ...question,
              answer: answers.get(question.id) ?? question.answer,
            })),
          },
        });
      },
      { idle: true },
    ),
    mutation(
      names.research,
      payloads[names.research],
      (p) => ok({ ...p, status: 'researching', error: null }),
      { idle: true, undo: false },
    ),
    mutation(
      names.approve,
      payloads[names.approve],
      (p, input) => {
        if (
          !p.draft ||
          p.draft.revision !== input.draftRevision ||
          !p.draft.visualPreviewAssetId ||
          p.draft.answersPending
        )
          return invalid('Review the current script and visual preview before approval');
        if (p.draft.questions.some((q) => q.required && !q.answer?.trim()))
          return invalid('Answer the required questions');
        return productionBase({
          ...p,
          approvedDraftRevision: p.draft.revision,
          status: 'producing',
          error: null,
        });
      },
      { idle: true, undo: false, person: true },
    ),
    mutation(
      names.produce,
      payloads[names.produce],
      (p) => {
        if (!p.draft || p.approvedDraftRevision !== p.draft.revision)
          return invalid('Approve this draft before production');
        return productionBase({ ...p, status: 'producing', error: null });
      },
      { idle: true, undo: false },
    ),
    mutation(names.cancel, payloads[names.cancel], (p) => ok({ ...p, status: 'cancelled' }), { undo: false }),
    mutation(names.resume, payloads[names.resume], (p) => ok(p), { idle: true, undo: false }),
    mutation(names.retry, payloads[names.retry], (p) => ok(p), { idle: true, undo: false, person: true }),
    defineCommand({
      name: SAVE_CREATION_STATE,
      payload: changeSchema,
      internal: true,
      sideEffect: 'write',
      project: (input) => input.project.projectId,
      handle: kit.handle(async (input, context) => {
        const saved = await kit.store.save(input.project, input.expectedRevision, context);
        if (!saved.ok) return saved;
        kit.note(context, 'project', input.project.projectId);
        return ok({ result: undefined });
      }),
    }),
    ...creationEditCommands(kit),
  ];
  return { all, store: kit.store };
}

async function saveCreationMutation(
  kit: CreationCommandKit,
  before: CreationProject,
  next: CreationProject,
  context: CommandContext,
  undo: boolean,
) {
  const project = { ...next, revision: before.revision + 1, updatedAt: Date.now() };
  const saved = await kit.store.save(project, before.revision, context);
  if (!saved.ok) return saved;
  const name = stageCreationProjectName(kit, context, before, project);
  if (!name.ok) return name;
  kit.note(context, 'project', project.projectId);
  return ok({
    result: project,
    ...(undo
      ? {
          inverse: {
            name: names.restore,
            payload: {
              projectId: project.projectId,
              snapshot: {
                kind: 'project',
                project: before,
                ...(name.value !== undefined ? { projectName: name.value } : {}),
              },
            },
          },
        }
      : {}),
  });
}

/** The director's durable checkpoints go through the same command transaction and event stream as UI edits. */
export function creationCommandStore(container: Container, store: CreationStore): CreationStore {
  return {
    get: store.get,
    list: store.list,
    async save(project, expectedRevision) {
      const { CommandBusToken } = await import('@taalcut/core');
      const saved = await container
        .resolve(CommandBusToken)
        .dispatch(
          SAVE_CREATION_STATE,
          { project, expectedRevision },
          { source: 'agent', actor: `creation:${project.projectId}` },
        );
      return saved.ok ? ok(undefined) : saved;
    },
  };
}
