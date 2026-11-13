// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The project commands (P2-X3) on core's bus, with core's names and payloads
 * (PROJECT_COMMANDS): create, rename, archive, unarchive and the saved-
 * version commands (versions.ts). Handlers read now and stage their writes
 * on the command unit of work, so a change commits with its audit row, undo
 * and redo included. Ids a command creates derive from its command id, so
 * redo (which runs the original command again under its id) recreates the
 * same rows.
 *
 * create, archive and unarchive belong to the app-wide history (the
 * /projects list); the rest to the project's own.
 */
import {
  DEFAULT_PROJECT_CAP_SETTING,
  defineCommand,
  ok,
  PROJECT_COMMANDS,
  projectCommandPayloads,
  type AnyCommand,
  type CommitAnnouncer,
  type CommittedChange,
  type ProjectId,
} from '@taalcut/core';
import { createProjectCommandKit, type ProjectCommandDeps } from './kit';
import { createRenameProjectCommand } from './rename';
import { createVersionCommands } from './versions';

export type { ProjectCommandDeps, ProjectCommandKit } from './kit';

export function createProjectCommands(deps: ProjectCommandDeps) {
  const kit = createProjectCommandKit(deps);
  const { announcer } = kit;
  const { projects } = deps;
  const appWide = () => null;
  const project = (projectId: ProjectId, change: CommittedChange['change']): CommittedChange => ({
    projectId,
    entity: 'project',
    change,
    ids: [projectId],
  });

  const create = defineCommand({
    name: PROJECT_COMMANDS.create,
    payload: projectCommandPayloads[PROJECT_COMMANDS.create],
    sideEffect: 'write',
    project: appWide,
    handle: kit.handle(async ({ name, projectId }, context) => {
      const id = projectId ?? (context.commandId as string as ProjectId);
      const result = { projectId: id, name };
      const inverse = { name: PROJECT_COMMANDS.archive, payload: { projectId: id } };
      const existing = projects.get(id);
      if (existing.ok) {
        // Redo of a create that undo archived: the same project comes back.
        if (existing.value.archivedAt === null) return ok({ result });
        const staged = kit.stage(context, () => projects.unarchive(id));
        const renamed = staged.ok ? kit.stage(context, () => projects.rename(id, name)) : staged;
        if (!renamed.ok) return renamed;
        kit.note(context, project(id, 'updated'));
        return ok({ result, inverse });
      }
      const cap = deps.settings
        ? await deps.settings.get(DEFAULT_PROJECT_CAP_SETTING)
        : ok(DEFAULT_PROJECT_CAP_SETTING.defaultValue);
      if (!cap.ok) return cap;
      const staged = kit.stage(context, () => projects.create({ id, name, budgetCap: cap.value }));
      if (!staged.ok) return staged;
      kit.note(context, project(id, 'created'));
      return ok({ result, inverse });
    }),
  });

  const rename = createRenameProjectCommand(kit);

  /** Archive and unarchive: each the other's inverse; a no-op (already there) has nothing to undo. */
  const toggle = (archive: boolean) =>
    defineCommand({
      name: archive ? PROJECT_COMMANDS.archive : PROJECT_COMMANDS.unarchive,
      payload: projectCommandPayloads[archive ? PROJECT_COMMANDS.archive : PROJECT_COMMANDS.unarchive],
      sideEffect: 'write',
      project: appWide,
      handle: kit.handle(async ({ projectId }, context) => {
        const before = projects.get(projectId);
        if (!before.ok) return before;
        const result = { projectId, archived: archive };
        if ((before.value.archivedAt !== null) === archive) return ok({ result });
        const staged = kit.stage(context, () =>
          archive ? projects.archive(projectId) : projects.unarchive(projectId),
        );
        if (!staged.ok) return staged;
        kit.note(context, project(projectId, 'updated'));
        const back = archive ? PROJECT_COMMANDS.unarchive : PROJECT_COMMANDS.archive;
        return ok({ result, inverse: { name: back, payload: { projectId } } });
      }),
    });

  const archive = toggle(true);
  const unarchive = toggle(false);
  const versions = createVersionCommands(kit);
  const all: AnyCommand[] = [create, rename, archive, unarchive, ...versions.all];
  return {
    create,
    rename,
    archive,
    unarchive,
    ...versions,
    /** Every project command, for `bus.register(...all)`. */
    all,
    /** Sends `library.changed` for each committed project command (call once with the agent's bus). */
    announce: (
      bus: Parameters<CommitAnnouncer['attach']>[0],
      events: Parameters<CommitAnnouncer['attach']>[1],
    ) => announcer.attach(bus, events),
  };
}
