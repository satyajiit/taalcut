// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * appContract.chat, served by the agent process from a ChatService
 * (@taalcut/agent's createChatService). Procedure names match the renderer's
 * ChatClient, and chatClientOverRpc turns the oRPC client back into a
 * ChatService, so the renderer's swap from its fake is one line.
 *
 * `send` is one streaming call: first `send.started` (the run id and the
 * stored user message), then the run's `agent.*` events until it stops.
 * Cancelling the call stops the run; `stop` stops it by id once that call is
 * gone (after an approval answer, or a reload).
 */
import '../basics/zod-config';
import { z } from 'zod';
import { CancelledError, ValidationError } from '../basics/errors';
import { idSchema, type RunId } from '../basics/ids';
import { err, ok } from '../basics/result';
import { agentEventSchema } from '../events/catalogue';
import { eventIterator, implementContract, ipc, type RpcClient } from '../ipc/contract';
import { callRpc, fromRpcError, unwrapRpc } from '../ipc/errors';
import { mapIteratorErrors } from '../ipc/iterators';
import {
  approvalDecisionSchema,
  conversationRecordSchema,
  conversationSummarySchema,
  runStoppedSchema,
  userMessageEventSchema,
  type ChatEvent,
  type ChatService,
} from './chat-types';
import { messageExtrasShape } from './chat-start';
import { chatEffortSchema, chatThinkingSchema } from './effort';

export const sendStartedSchema = z.object({
  type: z.literal('send.started'),
  runId: idSchema<'AgentRun'>(),
  userMessage: userMessageEventSchema,
});

export const chatSendItemSchema = z.discriminatedUnion('type', [
  sendStartedSchema,
  ...agentEventSchema.options,
]);

export const chatContract = {
  listConversations: ipc.output(z.array(conversationSummarySchema)),
  /** An id never used is a new, empty conversation. */
  getConversation: ipc.input(z.object({ id: idSchema<'Conversation'>() })).output(conversationRecordSchema),
  send: ipc
    .input(
      z.object({
        conversationId: idSchema<'Conversation'>(),
        text: z.string().min(1).max(100_000),
        /** How hard the agent thinks for this message. Absent: the model's own level (its profile's). */
        effort: chatEffortSchema.optional(),
        /** The exact level picked for this message (one of the model's). Replaces `effort` when both are set. */
        reasoning: chatThinkingSchema.optional(),
        ...messageExtrasShape,
      }),
    )
    .output(eventIterator(chatSendItemSchema)),
  /** Resolves when the run stops again (finished, or paused on its next question). */
  decideApproval: ipc.input(approvalDecisionSchema).output(z.void()),
  /** A run's events from now until it next stops, e.g. after an approval. */
  follow: ipc.input(z.object({ runId: idSchema<'AgentRun'>() })).output(eventIterator(agentEventSchema)),
  /** Stops the run (idempotent); answers its status once stopped. */
  stop: ipc.input(z.object({ runId: idSchema<'AgentRun'>() })).output(runStoppedSchema),
};

const never = new AbortController().signal;

export function chatRouter(service: ChatService) {
  const os = implementContract(chatContract);
  return os.router({
    listConversations: os.listConversations.handler(async () => unwrapRpc(await service.listConversations())),
    getConversation: os.getConversation.handler(async ({ input }) => {
      const record = unwrapRpc(await service.getConversation(input.id));
      return { conversation: record.conversation, history: [...record.history] };
    }),
    send: os.send.handler(async function* ({ input, signal }) {
      const stream = unwrapRpc(await service.send(input, { signal: signal ?? never }));
      yield { type: 'send.started' as const, runId: stream.runId, userMessage: stream.userMessage };
      yield* stream.events;
    }),
    decideApproval: os.decideApproval.handler(async ({ input }) =>
      unwrapRpc(await service.decideApproval(input)),
    ),
    follow: os.follow.handler(async function* ({ input, signal }) {
      yield* service.follow(input.runId, { signal: signal ?? never });
    }),
    stop: os.stop.handler(async ({ input }) => unwrapRpc(await service.stop(input.runId))),
  });
}

/** What the renderer's chat needs: the contract's client as a ChatService (every method returns a Result). */
export function chatClientOverRpc(client: RpcClient<typeof chatContract>): ChatService {
  const events = (iterator: AsyncIterator<ChatEvent>): AsyncIterable<ChatEvent> =>
    mapIteratorErrors(iterator, fromRpcError);
  return {
    listConversations: () => callRpc(client.listConversations()),
    getConversation: (id) => callRpc(client.getConversation({ id })),
    async send({ selections, comments, ...input }, { signal }) {
      const request = {
        ...input,
        ...(selections ? { selections: [...selections] } : {}),
        ...(comments ? { comments: [...comments] } : {}),
      };
      const stream = await callRpc(client.send(request, { signal }));
      if (!stream.ok) return stream;
      const first = await callRpc(stream.value.next());
      if (!first.ok) return first;
      if (first.value.done) return err(CancelledError());
      const started = first.value.value;
      if (started.type !== 'send.started') {
        await stream.value.return?.();
        return err(ValidationError(undefined, { detail: `send began with ${started.type}` }));
      }
      // Every later item is an agent.* event (the contract's schema checked it).
      const rest = stream.value as AsyncIterator<ChatEvent>;
      return ok({ runId: started.runId as RunId, userMessage: started.userMessage, events: events(rest) });
    },
    decideApproval: (input) => callRpc(client.decideApproval(input)),
    follow(runId, { signal }) {
      const iterator: AsyncIterator<ChatEvent> = {
        next: async () => {
          const stream = await client.follow({ runId }, { signal });
          const inner = stream as AsyncIterator<ChatEvent>;
          iterator.next = () => inner.next();
          iterator.return = (value) => inner.return?.(value) ?? Promise.resolve({ done: true, value });
          return inner.next();
        },
      };
      return events(iterator);
    },
    stop: (runId) => callRpc(client.stop({ runId })),
  };
}
