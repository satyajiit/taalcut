// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  CancelledError,
  err,
  newId,
  NotFoundError,
  ok,
  ProcessRestartedError,
  TimeoutError,
  type ChatEvent,
  type ChatHistoryEvent,
  type ChatService,
  type ConversationId,
  type ConversationSummary,
  type MessageId,
  type RunId,
  type TaalcutError,
  type ToolRunId,
  type UserMessageEvent,
} from '@taalcut/core';
import { isRecoveryScenario, type RecoveryScenario } from '../recovery/fake-recovery';
import type { CommandDispatcher } from '../services/provider';
import { createFlowEngine, flowFor } from './fake-flow';
import { editScript } from './fake-design-script';
import { commentScript } from './fake-comment-script';
import { frameInspectionScript } from './fake-frame-inspection-script';
import { fakePointers, withPointers } from './fake-pointers';
import { reaskSeeded } from './fake-reask';
import { eventQueue, holdWhen, pause, settle, withLevel, type Follower } from './fake-run-kit';
import { answerScript, scriptFor, type Beat } from './fake-script';
import { seedConversations } from './fake-seed';
import { workspaceInspectionScript } from './fake-workspace-script';
import { RUN_FINISHED } from './transcript';

/**
 * An in-renderer ChatService driven by scripted agent events, for the
 * plain-browser preview and tests (Electron talks to the agent's, over main's
 * port). It keeps conversations in memory (seeded), honours the AbortSignal,
 * and can be slowed down to show skeletons or sped up for tests. Answering an
 * approval, consent or cost estimate resumes its run; `follow` streams it;
 * `stop` cancels a playing or paused run by id.
 */

export interface FakeOptions {
  /** Delay before list and get answer, like an IPC round trip to a busy process. */
  latencyMs?: number;
  /** Multiplies the script's pace: 2 runs twice as fast. 0 means no waiting at all. */
  speed?: number;
  /** Command names whose dispatch fails (an error card's fix that doesn't work). */
  failCommands?: readonly string[];
  /** What the fake recovery client reports at launch (src/recovery/fake-recovery.ts). */
  recovery?: RecoveryScenario;
  /** 'cap': a flow stops at the project's budget before casting (P2-X1). */
  budget?: 'cap';
  /**
   * A run holds after this event type until stopped. An optional occurrence suffix (agent.toolStarted:12)
   * selects a later event; without it the first match holds. Used for stable mid-run browser checks.
   */
  holdAfter?: string;
  now?: () => number;
}

/** localStorage key holding FakeOptions as JSON, for the end-to-end tests and manual demos. */
export const FAKE_OPTIONS_KEY = 'taalcut.fake';

export function fakeOptionsFromStorage(): FakeOptions {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(FAKE_OPTIONS_KEY) ?? '{}');
    if (!parsed || typeof parsed !== 'object') return {};
    const { latencyMs, speed, failCommands, recovery, budget, holdAfter } = parsed as Record<string, unknown>;
    return {
      ...(typeof latencyMs === 'number' ? { latencyMs } : {}),
      ...(typeof speed === 'number' ? { speed } : {}),
      ...(Array.isArray(failCommands) ? { failCommands: failCommands.map(String) } : {}),
      ...(isRecoveryScenario(recovery) ? { recovery } : {}),
      ...(budget === 'cap' ? { budget } : {}),
      ...(typeof holdAfter === 'string' ? { holdAfter } : {}),
    };
  } catch {
    return {};
  }
}

interface Stored {
  summary: ConversationSummary;
  history: ChatHistoryEvent[];
  /** Opened by its link only (fake-seed.ts's review demo): never listed. */
  hidden?: true;
}

/** The fake chat, plus what only a fake can do. */
export interface FakeChatClient extends ChatService {
  commands: CommandDispatcher;
  /**
   * Gives a conversation a new title, as the agent does after the first
   * exchange (which then announces it with library.changed, entity
   * conversation). Tests send that event themselves. False for an unknown id.
   */
  rename(id: ConversationId, title: string): boolean;
  /**
   * The flow watcher (agent SPEC section 13): you changed something a flow made while its run waits on the
   * export approval, so the run checks the video again and asks again under the same card.
   */
  noteEdit(): void;
  /**
   * The next `times` loads, sends or answers fail as if the agent had just restarted (UX round 1's failed answer,
   * message and chat): nothing is stored, so Try again works.
   */
  failNext(what: FakeFailure, times?: number): void;
}

/** What `failNext` can make fail. */
export type FakeFailure = 'load' | 'send' | 'answer';

export function createFakeChatClient(options: FakeOptions = {}): FakeChatClient {
  const latency = options.latencyMs ?? 300;
  const speed = options.speed ?? 1;
  const now = options.now ?? Date.now;
  const store = new Map<string, Stored>(seedConversations().map((seed) => [seed.summary.id, seed]));
  const flows = createFlowEngine({
    ...(options.budget ? { budget: options.budget } : {}),
    lastCommand: () => window.taalcutFake?.dispatched.at(-1)?.name,
  });
  const followers = new Map<RunId, Set<Follower>>();
  /** Runs playing a script now, and how to stop each. */
  const playing = new Map<RunId, AbortController>();
  const stoppable = (runId: RunId, signal?: AbortSignal) => {
    const stopper = new AbortController();
    playing.set(runId, stopper);
    return signal ? AbortSignal.any([signal, stopper.signal]) : stopper.signal;
  };
  const wait = (ms: number, signal?: AbortSignal) =>
    speed === 0 ? Promise.resolve() : pause(ms / speed, signal);
  /** Resolves once the run is stopped (holdAfter's hold). */
  const stopped = (signal: AbortSignal) =>
    signal.aborted
      ? Promise.resolve()
      : new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
  const failures: Record<FakeFailure, number> = { load: 0, send: 0, answer: 0 };
  /** Whether this call fails (failNext), counting it off. */
  const fails = (what: FakeFailure) => {
    if (failures[what] <= 0) return false;
    failures[what] -= 1;
    return true;
  };
  const restarted = () => ProcessRestartedError({ process: 'agent' });

  const conversation = (id: ConversationId): Stored => {
    const existing = store.get(id);
    if (existing) return existing;
    const at = now();
    const created: Stored = { summary: { id, title: '', createdAt: at, updatedAt: at }, history: [] };
    store.set(id, created);
    return created;
  };

  async function* run(beats: readonly Beat[], target: Stored, runId: RunId, signal: AbortSignal) {
    const record = (event: ChatEvent) => {
      // A render the flow announces is a real one in the Make fakes, so Exports and its live card agree.
      if (event.type === 'agent.card' && event.payload.card.type === 'renderProgress')
        window.taalcutFake?.make.renders.track(event.payload.card);
      target.history.push(event);
      target.summary = { ...target.summary, updatedAt: event.at };
      return event;
    };
    const holds = holdWhen(options.holdAfter);
    try {
      for (const beat of beats) {
        await wait(beat.wait, signal);
        if (signal.aborted) {
          yield record({ type: 'agent.runFinished', at: now(), payload: { runId, status: 'cancelled' } });
          return;
        }
        const event = record(beat.event(now()));
        yield event;
        if (holds(event)) await stopped(signal);
      }
    } finally {
      playing.delete(runId);
    }
  }

  return {
    async listConversations() {
      await wait(latency);
      const list = [...store.values()]
        .filter((entry) => entry.history.length > 0 && !entry.hidden)
        .map((entry) => entry.summary);
      return ok(list);
    },

    async getConversation(id) {
      await wait(latency);
      if (fails('load')) return err(restarted());
      const found = store.get(id) ?? conversation(id);
      return ok({ conversation: found.summary, history: [...found.history] });
    },

    async send(
      { conversationId, text, effort, reasoning, start, selections, editorContext, comments },
      { signal },
    ) {
      if (signal.aborted) return err(CancelledError());
      if (fails('send')) {
        await wait(latency);
        return err(restarted());
      }
      const target = conversation(conversationId);
      const at = now();
      const userMessage: UserMessageEvent = {
        type: 'user.message',
        at,
        payload: {
          messageId: newId<'Message'>(),
          conversationId,
          text,
          ...(start ? { start } : {}),
          ...(selections ? { selections: [...selections] } : {}),
          ...(editorContext ? { editorContext } : {}),
          ...(comments?.length ? { comments: [...comments] } : {}),
        },
      };
      // As the agent does (round P3-3): what the words point at, on the stored message and the run's start.
      const pointers = fakePointers(
        text,
        { conversationId, projectId: target.summary.projectId ?? null },
        selections ?? [],
      );
      target.history.push(
        pointers.length ? { ...userMessage, payload: { ...userMessage.payload, pointers } } : userMessage,
      );
      target.summary = {
        ...target.summary,
        title: target.summary.title || text.slice(0, 48),
        updatedAt: at,
      };
      const runId = newId<'AgentRun'>();
      const ids = {
        runId,
        conversationId,
        messageId: newId<'Message'>() as MessageId,
        toolRunId: () => newId<'ToolRun'>() as ToolRunId,
      };
      // "Make this shot shorter" edits the clip it points at; a docked design request (HFW1-UI) goes to the
      // scripted Designer; an opening choice or a typed "make a video…" runs a flow; anything else, the P1 scripts.
      const edit = start ? null : editScript(ids, text, selections ?? [], editorContext);
      const path = start || !edit ? flowFor(text, start) : undefined;
      // EDT1-CMT: "Send N comments to Taalcut" answers each comment (fake-comment-script.ts).
      const script = comments?.length
        ? commentScript(ids, comments)
        : path
          ? flows.start(path, ids)
          : (frameInspectionScript(ids, text) ??
            workspaceInspectionScript(ids, text) ??
            edit ??
            scriptFor(text, ids));
      const beats = withPointers(withLevel(script, { reasoning, effort }), pointers);
      return ok({ runId, userMessage, events: run(beats, target, runId, stoppable(runId, signal)) });
    },

    async decideApproval({ runId, approvalId, decision, remember }) {
      await wait(latency);
      if (fails('answer')) return err(restarted());
      for (const entry of store.values()) {
        const asked = entry.history.find(
          (event) =>
            event.type === 'agent.card' &&
            'approvalId' in event.payload.card &&
            event.payload.card.approvalId === approvalId,
        );
        if (asked?.type !== 'agent.card') continue;
        // As the agent does: no answers for a run that has ended (stopped, say).
        const last = entry.history.findLast(
          (event) => event.type === 'agent.runFinished' && event.payload.runId === runId,
        );
        if (last?.type === 'agent.runFinished' && last.payload.status !== 'paused') {
          const ended: TaalcutError = {
            code: RUN_FINISHED,
            messageKey: `errors.${RUN_FINISHED}`,
            params: { runId },
            retryable: false,
          };
          return err(ended);
        }
        // The run picks up again and updates the card in place (same id), then stops. A flow's card
        // carries on with the flow (casting after the cap, the export after the approval).
        const answerIds = {
          runId,
          conversationId: entry.summary.id,
          messageId: newId<'Message'>() as MessageId,
        };
        const flow = flows.continuation(approvalId);
        const beats = flow
          ? flow(decision, answerIds)
          : answerScript(answerIds, settle(asked.payload.card, decision), decision, remember ?? false);
        const listening = followers.get(runId) ?? new Set<Follower>();
        followers.delete(runId);
        for await (const event of run(beats, entry, runId, stoppable(runId))) {
          for (const follower of listening) follower.push(event);
        }
        for (const follower of listening) follower.end();
        return ok(undefined);
      }
      return err(NotFoundError({ entity: 'approval', id: approvalId }));
    },

    follow(runId, { signal }) {
      const queue = eventQueue(signal);
      const set = followers.get(runId) ?? new Set<Follower>();
      followers.set(runId, set);
      set.add(queue);
      signal.addEventListener('abort', () => set.delete(queue), { once: true });
      return queue.events();
    },

    async stop(runId) {
      await wait(latency);
      const finished = (entry: Stored) =>
        entry.history.findLast(
          (event) => event.type === 'agent.runFinished' && event.payload.runId === runId,
        );
      const entry = [...store.values()].find((candidate) =>
        candidate.history.some((event) => 'runId' in event.payload && event.payload.runId === runId),
      );
      const last = entry && finished(entry);
      if (last?.type === 'agent.runFinished' && last.payload.status !== 'paused')
        return ok({ runId, status: last.payload.status });
      const stopper = playing.get(runId);
      if (stopper) {
        stopper.abort();
        return ok({ runId, status: 'cancelled' as const });
      }
      if (!entry || !last) return err(NotFoundError({ entity: 'run', id: runId }));
      // Paused: it ends here, and anyone following sees it end.
      const event: ChatEvent = {
        type: 'agent.runFinished',
        at: now(),
        payload: { runId, status: 'cancelled' },
      };
      entry.history.push(event);
      entry.summary = { ...entry.summary, updatedAt: event.at };
      for (const follower of followers.get(runId) ?? []) {
        follower.push(event);
        follower.end();
      }
      followers.delete(runId);
      return ok({ runId, status: 'cancelled' as const });
    },

    commands: {
      async dispatch({ name }) {
        await wait(latency);
        if (options.failCommands?.includes(name)) return err(TimeoutError({ ms: 5_000 }));
        return ok({ dispatched: true });
      },
    },

    noteEdit() {
      const conversationOf = (runId: RunId) =>
        [...store.values()].find((entry) =>
          entry.history.some((event) => 'runId' in event.payload && event.payload.runId === runId),
        )?.summary.id;
      const play = (entry: Stored, runId: RunId, beats: Beat[]) => {
        const listening = followers.get(runId) ?? new Set<Follower>();
        followers.delete(runId);
        void (async () => {
          for await (const event of run(beats, entry, runId, stoppable(runId))) {
            for (const follower of listening) follower.push(event);
          }
          for (const follower of listening) follower.end();
        })();
      };
      // A seeded export waiting (the review demo) asks again as a flow's does; found while the flows still hold theirs.
      const seeded = [...store.values()].flatMap((entry) => {
        const isFlows = (approvalId: string) => flows.continuation(approvalId) !== undefined;
        const again = reaskSeeded(entry.summary.id, entry.history, isFlows);
        return again ? [{ entry, ...again }] : [];
      });
      for (const { runId, beats } of flows.edited(conversationOf)) {
        const entry = store.get(conversationOf(runId) ?? '');
        if (entry) play(entry, runId, beats);
      }
      for (const { entry, runId, beats } of seeded) play(entry, runId, beats);
    },

    failNext(what, times = 1) {
      failures[what] += times;
    },

    rename(id, title) {
      const entry = store.get(id);
      if (!entry) return false;
      entry.summary = { ...entry.summary, title: title.trim(), updatedAt: now() };
      return true;
    },
  };
}
