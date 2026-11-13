// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What run.started records: the request, the conversation so far (earlier runs' turns fitted to the history
 * budget, and its latest flow), and the Phase 3 facts read once at the start (the soul's dials, what the
 * message pointed at). Everything a later turn, a resume or a replay needs comes from this one event.
 */
import type { RunId } from '@taalcut/core';
import { contentHash } from '@taalcut/tools';
import { DEFAULT_BUDGET, type AgentDeps, type StartRequest } from './agent-types';
import type { EventPayloads, HistoryTurn, RunHistory } from './events';
import { DEFAULT_HISTORY_TOKENS, fitHistory, historyTurn } from './history';
import { recallMemory } from './memory/recall';
import type { Phase3Deps } from './phase3-deps';

type Started = EventPayloads['run.started'];

/** The conversation so far, from the earlier runs' logs, fitted to the history budget; and its latest flow. */
export async function earlierRuns(
  deps: Pick<AgentDeps, 'log' | 'settings'>,
  runIds: readonly RunId[],
): Promise<Pick<Started, 'history' | 'lastFlow' | 'reasoning'>> {
  const turns: { at: number; turn: HistoryTurn }[] = [];
  let lastFlow: { at: number; flowId: string; projectId?: string } | undefined;
  let lastReasoning: { at: number; reasoning: NonNullable<Started['reasoning']> } | undefined;
  for (const id of runIds) {
    const events = await deps.log.read(id);
    if (!events.ok) continue;
    const turn = historyTurn(id, events.value);
    if (turn) turns.push({ at: events.value[0]?.at ?? 0, turn });
    const started = events.value.find((e) => e.type === 'run.started');
    if (
      started?.type === 'run.started' &&
      started.payload.reasoning !== undefined &&
      (!lastReasoning || started.at >= lastReasoning.at)
    )
      lastReasoning = { at: started.at, reasoning: started.payload.reasoning };
    const flow = events.value.findLast((e) => e.type === 'flow.started');
    if (flow?.type === 'flow.started' && (!lastFlow || flow.at > lastFlow.at))
      lastFlow = {
        at: flow.at,
        flowId: flow.payload.cardFlowId,
        ...(flow.payload.projectId ? { projectId: flow.payload.projectId } : {}),
      };
  }
  // In the order they started, whatever order the conversation lists them in.
  turns.sort((a, b) => a.at - b.at);
  const history: RunHistory = fitHistory(
    turns.map((t) => t.turn),
    deps.settings?.historyTokens ?? DEFAULT_HISTORY_TOKENS,
  );
  return {
    ...(history.turns.length > 0 || history.trimmed ? { history } : {}),
    ...(lastFlow
      ? {
          lastFlow: {
            flowId: lastFlow.flowId,
            ...(lastFlow.projectId ? { projectId: lastFlow.projectId } : {}),
          },
        }
      : {}),
    ...(lastReasoning ? { reasoning: lastReasoning.reasoning } : {}),
  };
}

/** run.started's payload for a request. */
export async function startPayload(deps: AgentDeps, request: StartRequest): Promise<Started> {
  const settings = deps.settings ?? {};
  const { reasoning: earlierReasoning, ...before } = await earlierRuns(deps, request.earlierRuns ?? []);
  // Any of them on is on: a request can't loosen the Settings switch (P3-B10).
  const localOnly = Boolean(request.localOnly || deps.phase3?.localOnly?.now() || settings.localOnly);
  const reasoning =
    request.reasoning ?? (request.effort === undefined ? earlierReasoning : undefined);
  return {
    conversationId: request.conversationId,
    ...(request.projectId ? { projectId: request.projectId } : {}),
    message: request.message,
    autonomy: request.autonomy ?? settings.autonomy ?? 'before-render',
    budget: request.budget ?? settings.budget ?? DEFAULT_BUDGET,
    localOnly,
    soulVersion: deps.soul.version,
    catalogueHash: contentHash(deps.tools.catalogue()),
    ...before,
    ...(request.effort ? { effort: request.effort } : {}),
    ...(reasoning ? { reasoning } : {}),
    ...(request.start ? { start: request.start } : {}),
    ...(request.selections?.length ? { selections: [...request.selections] } : {}),
    // EDT1-CMT: the batch, as the chat service read it.
    ...(request.comments ? { comments: request.comments } : {}),
    ...(await phase3Start(deps, request, localOnly)),
  };
}

/** The Phase 3 facts a run starts with. A port that isn't composed adds nothing. */
async function phase3Start(
  deps: AgentDeps,
  request: StartRequest,
  localOnly: boolean,
): Promise<Pick<Started, 'soul' | 'pointers' | 'pointerNote' | 'router' | 'memory' | 'editor'>> {
  const dials = deps.phase3?.soulDials ? await deps.phase3.soulDials() : undefined;
  const router = deps.phase3?.router ? await deps.phase3.router.setting() : undefined;
  const context = request.editorContext;
  const pointed = await deps.phase3?.pointers?.resolve({
    message: request.message,
    earlierRuns: request.earlierRuns ?? [],
    log: deps.log,
    ...(request.start ? { start: request.start } : {}),
    ...(request.selections?.length ? { selections: request.selections } : {}),
    // EDT1: a docked message means the timeline on screen.
    ...(context ? { timelineId: context.timelineId } : {}),
  });
  const editor = deps.phase3?.editor;
  const brief =
    context && editor
      ? (editor.replay ?? (await editor.brief({ message: request.message, context })))
      : undefined;
  return {
    ...(dials ? { soul: { version: deps.soul.version, dials } } : {}),
    ...(pointed ? { pointers: pointed.pointers, pointerNote: pointed.note } : {}),
    // The router's mode for the whole run; off is the Phase 2 log, unchanged.
    ...(router && router.mode !== 'off' ? { router } : {}),
    ...(await memoryStart(deps, request, localOnly)),
    ...(brief ? { editor: brief } : {}),
  };
}

/** LRN1-MEM: what the run remembers, recalled once for its scopes and message (memory/recall.ts). */
async function memoryStart(
  deps: AgentDeps,
  request: StartRequest,
  localOnly: boolean,
): Promise<Pick<Started, 'memory'>> {
  const memory = deps.phase3?.memory;
  if (!memory) return {};
  if (memory.replay) return { memory: memory.replay };
  const skillModules = (deps.skills?.list() ?? []).map((skill) => skill.module ?? 'agent');
  const recalled = await recallMemory(memory, {
    message: request.message,
    localOnly,
    modules: [...new Set(['agent' as const, ...skillModules])],
    ...(request.projectId ? { projectId: request.projectId } : {}),
    ...(request.start ? { start: request.start } : {}),
    ...(request.selections?.length ? { selections: request.selections } : {}),
  });
  return { memory: recalled };
}

/**
 * Replay starts the run again from its logged request: its Phase 3 facts must be the logged ones, not what
 * the settings say today, or the replayed prompt would drift (a dial changed since).
 */
export function loggedPhase3(phase3: Phase3Deps | undefined, started: Started): Phase3Deps {
  const { soulDials: _today, pointers: _now, memory: today, editor: live, ...rest } = phase3 ?? {};
  const logged = started.soul?.dials;
  const { pointers, pointerNote, memory, editor } = started;
  return {
    ...rest,
    // EDT1: the editor brief as logged; the store's timeline today would change the prompt.
    ...(live && editor ? { editor: { ...live, replay: editor } } : {}),
    // What the run recalled then: memory edited since must not change the replayed prompt.
    ...(today && memory ? { memory: { ...today, replay: memory } } : {}),
    ...(logged ? { soulDials: async () => logged } : {}),
    // What the message pointed at, as resolved then: the stores may have moved on since.
    ...(pointers && pointerNote
      ? { pointers: { resolve: async () => ({ pointers, note: pointerNote }) } }
      : {}),
  };
}
