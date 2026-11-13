// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  ConflictError,
  CREATION_COMMANDS as names,
  creationCommandPayloads as payloads,
  creationProjectSchema,
  defineCommand,
  err,
  ok,
  timelineSchema,
  ValidationError,
  type AnyCommand,
  type AuthoredEdit,
  type CommandContext,
  type CreationProject,
  type ProjectId,
  type TimelineId,
} from '@taalcut/core';
import { editAuthoredProgram, inspectAuthoredProgram } from '@taalcut/render';
import { replaceAuthoredProgram } from '@taalcut/timeline';
import { z } from 'zod';
import type { CreationCommandKit } from './command-kit';
import { readCreationProgram, readCreationTimeline, storeProgramSource } from './programs';
import { creationRangeCommand } from './range-command';
import { stageCreationProjectName } from './project-name';

const snapshotSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('project'),
    project: creationProjectSchema,
    projectName: z.string().trim().min(1).max(200).optional(),
  }),
  z.object({ kind: z.literal('timeline'), timeline: timelineSchema }),
]);
type EditInput = { projectId: ProjectId; timelineId: TimelineId; revision: number };

async function restoreProject(
  kit: CreationCommandKit,
  projectId: ProjectId,
  snapshot: { project: CreationProject; projectName?: string | undefined },
  context: CommandContext,
) {
  if (snapshot.project.projectId !== projectId) return err(ValidationError({ field: 'projectId' }));
  const before = await kit.store.get(projectId);
  if (!before.ok) return before;
  if (['researching', 'producing'].includes(before.value.status))
    return err(
      ValidationError({ field: 'status' }, { detail: 'Cancel the active run before undoing inputs' }),
    );
  const next = {
    ...snapshot.project,
    revision: before.value.revision + 1,
    updatedAt: Date.now(),
    // An undo cannot refund provider charges or discard an unresolved reservation.
    budget: before.value.budget,
  };
  const saved = await kit.store.save(next, before.value.revision, context);
  if (!saved.ok) return saved;
  const name = stageCreationProjectName(kit, context, before.value, next, snapshot.projectName);
  if (!name.ok) return name;
  kit.note(context, 'project', projectId);
  return ok({
    result: undefined,
    inverse: {
      name: names.restore,
      payload: {
        projectId,
        snapshot: {
          kind: 'project',
          project: before.value,
          ...(name.value !== undefined ? { projectName: name.value } : {}),
        },
      },
    },
  });
}

export function creationEditCommands(kit: CreationCommandKit): AnyCommand[] {
  async function edit(
    input: EditInput & { source?: string; edits?: AuthoredEdit[] },
    context: CommandContext,
  ) {
    const found = await readCreationProgram(kit.programs, kit.timelines, input);
    if (!found.ok) return found;
    const { timeline, inspection } = found.value;
    if (context.replay !== 'redo' && timeline.revision !== input.revision)
      return err(ConflictError({ entity: 'timeline', id: timeline.id }));
    const revised =
      input.source !== undefined
        ? inspectAuthoredProgram(input.source, inspection.program, { updateDuration: true })
        : await editAuthoredProgram(inspection.source, inspection.program, input.edits ?? []);
    if (!revised.ok) return revised;
    const next = await storeProgramSource(
      kit.programs,
      input.projectId,
      revised.value.program,
      revised.value.source,
    );
    if (!next.ok) return next;
    const replaced = replaceAuthoredProgram(timeline, next.value);
    if (!replaced.ok) return replaced;
    const saved = await kit.programs.save(input.projectId, next.value, context);
    if (!saved.ok) return saved;
    const written = await kit.timelines.put(replaced.value, timeline.revision, context);
    if (!written.ok) return written;
    kit.note(context, 'timeline', timeline.id);
    return ok({
      result: written.value,
      inverse: {
        name: names.restore,
        payload: { projectId: input.projectId, snapshot: { kind: 'timeline', timeline } },
      },
    });
  }
  return [
    creationRangeCommand(kit),
    defineCommand({
      name: names.editProgram,
      payload: payloads[names.editProgram],
      sideEffect: 'write',
      handle: kit.handle((input, context) => edit(input, context)),
    }),
    defineCommand({
      name: names.replaceSource,
      payload: payloads[names.replaceSource],
      sideEffect: 'write',
      handle: kit.handle((input, context) => edit(input, context)),
    }),
    defineCommand({
      name: names.restore,
      payload: payloads[names.restore],
      sideEffect: 'write',
      internal: true,
      handle: kit.handle(async ({ projectId, snapshot }, context) => {
        const parsed = snapshotSchema.safeParse(snapshot);
        if (!parsed.success) return err(ValidationError({ field: 'snapshot' }));
        const value = parsed.data;
        if (value.kind === 'project') return restoreProject(kit, projectId, value, context);
        if (value.timeline.projectId !== projectId) return err(ValidationError({ field: 'projectId' }));
        const before = await readCreationTimeline(kit.timelines, {
          projectId,
          timelineId: value.timeline.id,
        });
        if (!before.ok) return before;
        const saved = await kit.timelines.put(value.timeline, before.value.revision, context);
        if (!saved.ok) return saved;
        kit.note(context, 'timeline', value.timeline.id);
        return ok({
          result: undefined,
          inverse: {
            name: names.restore,
            payload: { projectId, snapshot: { kind: 'timeline', timeline: before.value } },
          },
        });
      }),
    }),
  ];
}
