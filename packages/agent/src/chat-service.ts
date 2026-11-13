// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The chat service (P1-H3 backend): conversations, sending a message as a run, streaming it as core's `agent.*`
 * events, stopping it, and answering approval and consent cards. The run log is the source of truth: history is the
 * conversation's user messages plus each linked run's log, translated the same way as the live stream. Assistant text
 * is also stored as messages (one per model turn that wrote text) so the conversation store has it, including for
 * runs this service didn't start but that belong to a conversation (runs resumed at start-up).
 */
import {
  CancelledError,
  createSerialQueue,
  err,
  newId,
  NotFoundError,
  ok,
  type ConversationId,
  type MessageId,
  type RunId,
} from '@taalcut/core';
import type { Agent, AgentFeedEvent, StartRequest } from './agent-types';
import { linkedProject, messageExtras, withExtras, type LinkProject } from './chat-message-extras';
import { answerInChat } from './chat-pending';
import { RunTranslator } from './chat-translate';
import type { ChatEvent, ChatHistoryEvent, ChatService, UserMessageEvent } from './chat-types';
import { RunFinished } from './errors';
import { createCoverUpdates } from './chat-cover-updates';
import {
  createChatTitling,
  provisionalTitle,
  type ChatTitlingDeps,
  type ConversationTitler,
} from './chat-titles';
import { commentIds, createChatComments, type ChatCommentsPort } from './comments/chat-comments';
import { TERMINAL_EVENTS, type EventOf } from './events';
import type { ConversationStore, StoredMessagePart } from './ports';

export interface ChatServiceDeps {
  readonly agent: Agent;
  readonly conversations: ConversationStore;
  /** Settings for runs started from the chat. Default: the agent's own. */
  readonly runSettings?: Pick<StartRequest, 'autonomy' | 'budget' | 'localOnly'>;
  /** Names a chat after its first exchange (createConversationTitler); without one, its first message cut short. */
  readonly titles?: ConversationTitler;
  /** A chat's title changed (see ChatTitlingDeps.onChanged). */
  readonly onConversationChanged?: ChatTitlingDeps['onChanged'];
  /** A generated chat title is stored; lets the composition name its automatically created project too. */
  readonly onConversationNamed?: ChatTitlingDeps['onNamed'];
  /** Live completions, once before chat fan-out; history reads and stream priming never call this. */
  readonly onToolFinished?: (event: Extract<ChatEvent, { type: 'agent.toolFinished' }>) => void;
  /**
   * For a chat in no project yet (one the editor's dock started for a project nobody wrote in): moves it into
   * the project its message's chips name (a clip's or range's timeline), before the run starts, so the run and
   * the project's page share the chat. Resolves that project, or null (no chip names one, or it couldn't link:
   * the message goes on unlinked).
   */
  readonly linkProject?: LinkProject;
  /** EDT1-CMT: what a message's comments are read from and marked with (comments/chat-comments.ts). */
  readonly comments?: ChatCommentsPort;
  readonly now?: () => number;
}

const textOf = (parts: readonly StoredMessagePart[]) =>
  parts.flatMap((p) => (p.type === 'text' ? [p.text] : [])).join('');

/** An async stream of one run's chat events; ends after `agent.runFinished`. */
class RunQueue implements AsyncIterable<ChatEvent> {
  private readonly items: ChatEvent[] = [];
  private waiting: ((result: IteratorResult<ChatEvent>) => void) | undefined;
  private ended = false;
  constructor(private readonly onClose: () => void) {}

  push(event: ChatEvent): void {
    if (this.ended) return;
    if (this.waiting) {
      this.waiting({ value: event, done: false });
      this.waiting = undefined;
    } else this.items.push(event);
    if (event.type === 'agent.runFinished') this.end();
  }

  end(): void {
    if (this.ended) return;
    this.ended = true;
    this.onClose();
    if (this.waiting && this.items.length === 0) this.waiting({ value: undefined, done: true });
  }

  [Symbol.asyncIterator](): AsyncIterator<ChatEvent> {
    return {
      next: () => {
        const item = this.items.shift();
        if (item) return Promise.resolve({ value: item, done: false });
        if (this.ended) return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve) => (this.waiting = resolve));
      },
      return: () => {
        this.end();
        return Promise.resolve({ value: undefined, done: true });
      },
    };
  }
}

export function createChatService(deps: ChatServiceDeps): ChatService & { close(): void } {
  const { agent, conversations } = deps;
  const now = deps.now ?? Date.now;
  const translators = new Map<RunId, RunTranslator>();
  const followers = new Map<RunId, Set<RunQueue>>();
  /** Sends waiting for their run.started, by conversation. */
  const starting = new Map<string, RunQueue>();
  /** The answers being stored, in order. Every call in a store answers with a Result. */
  const persisting = createSerialQueue();
  const comments = createChatComments(deps.comments, agent);

  const follow = (runId: RunId, queue: RunQueue) => {
    const set = followers.get(runId) ?? new Set();
    set.add(queue);
    followers.set(runId, set);
  };
  const publish = (runId: RunId, events: readonly ChatEvent[]) => {
    for (const event of events) {
      if (event.type === 'agent.toolFinished') deps.onToolFinished?.(event);
      for (const queue of followers.get(runId) ?? []) queue.push(event);
    }
  };

  /** The conversation of a run this service didn't start: one that lists the run (a chat run resumed at start-up). */
  const owners = new Map<RunId, Promise<ConversationId | undefined>>();
  const ownerOf = (runId: RunId): Promise<ConversationId | undefined> => {
    const known = translators.get(runId)?.conversationId;
    if (known) return Promise.resolve(known);
    const owner =
      owners.get(runId) ??
      (async () => {
        const log = await agent.events(runId);
        const started = log.ok ? log.value[0] : undefined;
        if (started?.type !== 'run.started') return undefined;
        const id = started.payload.conversationId as ConversationId;
        const stored = await conversations.get(id);
        return stored.ok && stored.value.runs.some((r) => r.runId === runId) ? id : undefined;
      })();
    owners.set(runId, owner);
    return owner;
  };
  const coverUpdates = createCoverUpdates(conversations, ownerOf, deps.onConversationChanged);

  /** Stores what the model said as an assistant message (the id is the model call's, so twice is once). */
  const persist = (event: EventOf<'model.responded'>) => {
    const owner = ownerOf(event.runId);
    void persisting.run(async () => {
      const conversationId = await owner;
      if (!conversationId) return;
      await conversations.appendMessage({
        id: event.payload.modelCallId as MessageId,
        conversationId,
        role: 'assistant',
        parts: [{ type: 'text', text: event.payload.text }],
        runId: event.runId,
      });
    });
  };

  const title = deps.titles
    ? createChatTitling({
        conversations,
        titles: deps.titles,
        ...(deps.onConversationChanged ? { onChanged: deps.onConversationChanged } : {}),
        ...(deps.onConversationNamed ? { onNamed: deps.onConversationNamed } : {}),
      })
    : undefined;
  /** A run stopped: once its answers are stored, its chat may get a title (not in `persisting`: no one waits on it). */
  const maybeTitle = (runId: RunId, options?: { readonly paused?: boolean }) => {
    if (!title) return;
    const owner = ownerOf(runId);
    void persisting.settled().then(async () => {
      const conversationId = await owner;
      if (conversationId) await title(conversationId, options);
    });
  };

  const unsubscribe = agent.subscribe((event: AgentFeedEvent) => {
    if (!('runId' in event)) return; // Cards: the chat builds its own from the log.
    if (event.type === 'run.started') {
      const queue = starting.get(event.payload.conversationId);
      if (queue) {
        starting.delete(event.payload.conversationId);
        translators.set(event.runId, new RunTranslator(event.runId, now));
        follow(event.runId, queue);
      }
    }
    const translator = translators.get(event.runId);
    if ('seq' in event) {
      if (translator) publish(event.runId, translator.logged(event));
      coverUpdates(event);
      if (event.type === 'model.responded' && event.payload.text) persist(event);
      if (event.type === 'run.paused') maybeTitle(event.runId, { paused: true });
      else if (TERMINAL_EVENTS.includes(event.type)) maybeTitle(event.runId);
      if (TERMINAL_EVENTS.includes(event.type)) owners.delete(event.runId);
    } else if (translator) publish(event.runId, translator.delta(event));
  });

  /** A translator that has seen the run's log so far, for a run this service didn't start. */
  async function prime(runId: RunId): Promise<{ terminal: boolean }> {
    const events = await agent.events(runId);
    const log = events.ok ? events.value : [];
    if (!translators.has(runId)) {
      const translator = new RunTranslator(runId, now);
      for (const event of log) translator.logged(event);
      translators.set(runId, translator);
    }
    // Saved-file receipts may arrive after a terminal event, without reopening the run.
    return { terminal: log.some((event) => TERMINAL_EVENTS.includes(event.type)) };
  }

  function queueFor(signal: AbortSignal, onAbort: () => void): RunQueue {
    const stop = () => onAbort();
    const queue = new RunQueue(() => {
      for (const set of followers.values()) set.delete(queue);
      signal.removeEventListener('abort', stop);
    });
    signal.addEventListener('abort', stop, { once: true });
    return queue;
  }

  async function history(runIds: readonly RunId[], users: readonly UserMessageEvent[]) {
    const segments: { at: number; rank: number; events: ChatHistoryEvent[] }[] = users.map((u) => ({
      at: u.at,
      rank: 0,
      events: [u],
    }));
    for (const runId of runIds) {
      const log = await agent.events(runId);
      if (!log.ok || log.value.length === 0) continue;
      withExtras(segments, log.value[0]!);
      const translator = new RunTranslator(runId, now);
      segments.push({
        at: log.value[0]!.at,
        rank: 1,
        events: log.value.flatMap((e) => translator.logged(e)),
      });
    }
    return segments.sort((a, b) => a.at - b.at || a.rank - b.rank).flatMap((s) => s.events);
  }

  return {
    async listConversations() {
      await persisting.settled();
      return conversations.list();
    },

    async getConversation(id) {
      await persisting.settled();
      const stored = await conversations.get(id);
      if (!stored.ok) {
        if (!NotFoundError.is(stored.error)) return stored;
        const at = now();
        return ok({ conversation: { id, title: '', createdAt: at, updatedAt: at }, history: [] });
      }
      const users = stored.value.messages
        .filter((m) => m.role === 'user')
        .map((m): UserMessageEvent => ({
          type: 'user.message',
          at: m.createdAt,
          payload: { messageId: m.id, conversationId: id, text: textOf(m.parts) },
        }));
      const runIds = stored.value.runs.map((r) => r.runId);
      return ok({ conversation: stored.value.conversation, history: await history(runIds, users) });
    },

    async send(
      { conversationId, text, effort, reasoning, start, selections, editorContext, comments: sent },
      { signal },
    ) {
      if (signal.aborted) return err(CancelledError());
      const batch = await comments.open(sent); // EDT1-CMT: before anything is stored.
      if (!batch.ok) return batch;
      const at = now();
      const known = await conversations.get(conversationId);
      if (!known.ok) {
        if (!NotFoundError.is(known.error)) return known;
        const created = await conversations.create({
          id: conversationId,
          title: provisionalTitle(text),
        });
        if (!created.ok) return created;
      }
      const messageId = newId<'Message'>();
      const stored = await conversations.appendMessage({
        id: messageId,
        conversationId,
        role: 'user',
        parts: [{ type: 'text', text }],
      });
      if (!stored.ok) return stored;
      // The time the store gave the message, so history and the live answer agree.
      const storedAt = (stored.value as { createdAt?: unknown } | undefined)?.createdAt;
      const extras = messageExtras({ start, selections, editorContext });
      const userMessage: UserMessageEvent = {
        type: 'user.message',
        at: typeof storedAt === 'number' ? storedAt : at,
        payload: { messageId, conversationId, text, ...extras, ...commentIds(batch.value) },
      };

      const run: { id?: RunId } = {};
      // Closing a window detaches its feed. Only the explicit Stop action cancels the durable run.
      const queue = queueFor(signal, () => queue.end());
      // The conversation so far goes with the message: the run's prompt starts with its earlier turns.
      const earlierRuns = known.ok ? known.value.runs.map((r) => r.runId) : [];
      // FIX-ASK: words that answer the gaps question the chat's run waits on carry that run on instead (EDT1-CMT: not
      // a message with comments, which starts its own run).
      const carried = await answerInChat(agent, batch.value ? [] : earlierRuns, text, async (id) => {
        await prime(id);
        follow(id, queue);
        return () => queue.end();
      });
      if (carried) return ok({ runId: (run.id = carried), userMessage, events: queue });
      starting.set(conversationId, queue);
      const projectId =
        (known.ok ? known.value.conversation.projectId : undefined) ??
        (await linkedProject(deps.linkProject, conversationId, extras)) ??
        batch.value?.projectId;
      const started = await agent.start({
        conversationId,
        message: text,
        earlierRuns,
        ...deps.runSettings,
        ...(effort ? { effort } : {}),
        ...(reasoning ? { reasoning } : {}),
        ...(projectId ? { projectId } : {}),
        ...extras,
        ...(batch.value ? { comments: batch.value } : {}),
      });
      starting.delete(conversationId);
      if (!started.ok) {
        queue.end();
        return started;
      }
      const runId = (run.id = started.value);
      const linked = await conversations.linkRun(conversationId, runId);
      if (!linked.ok) return linked;
      if (signal.aborted) queue.end();
      return ok({ runId, userMessage, events: queue });
    },

    async decideApproval({ runId, approvalId, decision, remember, answer }) {
      await prime(runId);
      const answered = await agent.answer(runId, {
        requestId: approvalId,
        decision,
        ...(remember ? { remember } : {}),
        ...(answer ? { answer } : {}),
      });
      return answered.ok ? ok(undefined) : answered;
    },

    follow(runId, { signal }) {
      const queue = queueFor(signal, () => queue.end());
      void prime(runId).then(({ terminal }) =>
        terminal || signal.aborted ? queue.end() : follow(runId, queue),
      );
      return queue;
    },

    async stop(runId) {
      // Live here: aborted, and resolves once the run has logged its end. Otherwise run.cancelled is logged.
      const stopped = await agent.cancel(runId);
      // Cancel says an unknown run has finished; to the chat it is not found.
      if (!stopped.ok)
        return RunFinished.is(stopped.error) ? err(NotFoundError({ entity: 'run', id: runId })) : stopped;
      const { status } = stopped.value;
      return ok({ runId, status: status === 'completed' ? 'succeeded' : status });
    },

    close() {
      unsubscribe();
      comments.close();
      for (const set of followers.values()) for (const queue of set) queue.end();
    },
  };
}
