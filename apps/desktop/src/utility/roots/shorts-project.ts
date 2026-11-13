// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  ConversationStoreToken,
  err,
  EventBusToken,
  EventLogStoreToken,
  ok,
  parseId,
  ValidationError,
  type Container,
} from '@taalcut/core';
import { createShortsProjectTool, shortProjectOutputSchema } from '@taalcut/shorts';

/** Natural-language requests need a project too; reuse this conversation's project when it already has one. */
export function shortsProjectTool(container: Container) {
  return createShortsProjectTool({
    async run(input, ctx) {
      let conversationId;
      if (ctx.runId && container.has(EventLogStoreToken) && container.has(ConversationStoreToken)) {
        const runs = await container.resolve(EventLogStoreToken).listRuns({ limit: 10_000 });
        if (!runs.ok) return runs;
        conversationId = runs.value.find((run) => run.runId === ctx.runId)?.conversationId ?? undefined;
        if (conversationId) {
          const conversation = await container.resolve(ConversationStoreToken).get(conversationId);
          if (!conversation.ok) return conversation;
          if (conversation.value.conversation.projectId)
            return ok({ projectId: conversation.value.conversation.projectId });
        }
      }
      const identity = parseId<'Project'>(ctx.runId ?? ctx.callId);
      if (!identity.ok) return identity;
      const created = await ctx.dispatch({ ...input, projectId: identity.value });
      if (!created.ok) return created;
      const project = shortProjectOutputSchema.safeParse(created.value);
      if (!project.success) return err(ValidationError({ field: 'shorts.projectReceipt' }));
      if (conversationId) {
        const linked = await container
          .resolve(ConversationStoreToken)
          .setProject(conversationId, project.data.projectId);
        if (!linked.ok) return linked;
        container.resolve(EventBusToken).emit('library.changed', {
          projectId: project.data.projectId,
          entity: 'conversation',
          change: 'updated',
          ids: [conversationId],
        });
      }
      return ok(project.data);
    },
  });
}
