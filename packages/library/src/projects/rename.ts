// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  ConflictError,
  defineCommand,
  err,
  ok,
  PROJECT_COMMANDS,
  projectCommandPayloads,
} from '@taalcut/core';
import type { ProjectCommandKit } from './kit';

export function createRenameProjectCommand(kit: ProjectCommandKit) {
  const { projects } = kit.deps;
  return defineCommand({
    name: PROJECT_COMMANDS.rename,
    payload: projectCommandPayloads[PROJECT_COMMANDS.rename],
    sideEffect: 'write',
    handle: kit.handle(async ({ projectId, name, expectedName, fromConversation }, context) => {
      const before = projects.get(projectId);
      if (!before.ok) return before;
      if (expectedName !== undefined && before.value.name !== expectedName)
        return err(ConflictError({ entity: 'project', id: projectId }));
      if (
        fromConversation !== undefined &&
        context.replay !== 'redo' &&
        (context.source !== 'agent' || context.actor !== 'agent:project-title')
      )
        return err(ConflictError({ entity: 'project', id: projectId }));
      const staged = kit.stage(context, () =>
        projects.rename(projectId, name, {
          ...(expectedName !== undefined ? { expectedName } : {}),
          ...(fromConversation !== undefined ? { fromConversation } : {}),
          commandId: context.commandId,
          ...(context.replay === 'redo' ? { replay: context.replay } : {}),
        }),
      );
      if (!staged.ok) return staged;
      kit.note(context, { projectId, entity: 'project', change: 'updated', ids: [projectId] });
      const result = { projectId, name };
      // An automatic name is audited but is nobody's undo step: the next undo stays the person's or the chat's
      // last change (EDT1). One an older history still holds as a step goes back on the stack when it is redone.
      if (fromConversation !== undefined && context.replay !== 'redo') return ok({ result });
      return ok({
        result,
        inverse: { name: PROJECT_COMMANDS.rename, payload: { projectId, name: before.value.name } },
      });
    }),
  });
}
