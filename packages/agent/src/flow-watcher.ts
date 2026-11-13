// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The flow watcher (SPEC section 13, "the agent doesn't wait"): on each
 * command a person ran on a flow's project, it re-reads what the finished
 * steps handed off; anything whose version moved is logged as
 * `flow.inputChanged`, and the step's card is sent again marked "You changed
 * this". A running run takes the change at its next step. An export approval
 * whose timeline moved past the card's revision is closed as stale at once
 * (the card shows "updating"), flow step or the model's own call, so a grant
 * can't export what the card didn't show; after a quiet moment the run goes
 * back through the Reviewer and asks again under the same card. Paused on
 * anything else, the change waits.
 */
import type { CardOf, EntityRef } from '@taalcut/core';
import { staleEvents, staleExports } from './export-approvals';
import type { RefVersions } from './ports';
import type { EventInput, RunLog } from './run-log';
import type { RunState } from './run-state';
import { handoffCard } from './skill-cards';
import type { SkillRegistry } from './skills';
import { knownVersions, refKey } from './state-flow';
import { pendingApprovals } from './state';

/** A command.changed event as the watcher needs it. */
export interface CommandChange {
  readonly id: string;
  readonly projectId: string | null;
  readonly source: string;
}

export interface FlowWatcherDeps {
  readonly refs: RefVersions;
  readonly skills: SkillRegistry;
  /** The runs this agent holds (live or opened). */
  readonly runs: () => Iterable<RunLog>;
  /** Continues a paused run (its stale approval is closed). */
  readonly resume: (log: RunLog) => void;
  /** How long a change must settle before a waiting export approval is closed as stale. Default 1.5 s. */
  readonly staleAfterMs?: number;
}

export interface FlowWatcher {
  noteCommand(change: CommandChange): Promise<void>;
  /**
   * Checks one run's export approvals now (before a grant: the watcher may not
   * have heard of the edit yet). True when it closed one as stale; only then is
   * what moved the person's change (FIX-RUN).
   */
  recheck(log: RunLog, why: string): Promise<boolean>;
  close(): void;
}

const isOpen = (state: RunState) => state.status === 'running' || state.status === 'paused';

/** The newest refs that moved since the run last saw them, and the steps that handed them off. */
async function changes(state: RunState, refs: RefVersions) {
  const known = knownVersions(state);
  const moved: EntityRef[] = [];
  for (const [key, version] of known) {
    const [entity, id] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
    const current = await refs.version({ entity, id });
    if (current.ok && current.value !== undefined && current.value > version)
      moved.push({ entity: entity as EntityRef['entity'], id, version: current.value });
  }
  const keys = new Set(moved.map(refKey));
  const stepIds = (state.plan ?? [])
    .filter((s) => s.handedOff?.refs.some((r) => keys.has(refKey(r))))
    .map((s) => s.id);
  return { moved, stepIds };
}

/** The export approval a paused run waits on, if that is what it waits on. */
function waitingExport(state: RunState) {
  if (state.status !== 'paused') return undefined;
  const step = state.plan?.find((s) => s.tool && s.status === 'doing' && s.toolCallId);
  if (!step) return undefined;
  const approval = pendingApprovals(state).find(
    (a) => a.request.kind === 'tool' && a.request.toolCallIds.includes(step.toolCallId!),
  );
  return approval ? { step, approval } : undefined;
}

export function createFlowWatcher(deps: FlowWatcherDeps): FlowWatcher {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const staleAfter = deps.staleAfterMs ?? 1_500;

  /** After the quiet moment: a flow export still waiting (one with no card to compare) closes; the run goes on. */
  async function closeStale(log: RunLog): Promise<void> {
    timers.delete(log.runId);
    const waiting = waitingExport(log.state);
    if (waiting) {
      const card = Object.values(log.state.cards).find(
        (c): c is CardOf<'exportApproval'> =>
          c.type === 'exportApproval' && c.approvalId === waiting.approval.request.requestId,
      );
      const updating: EventInput[] = card ? [['card.sent', { card: { ...card, status: 'updating' } }]] : [];
      const written = await log.append(
        ['approval.denied', { requestId: waiting.approval.request.requestId, reason: 'stale' }],
        ...updating,
      );
      if (!written.ok) return;
    }
    deps.resume(log);
  }

  function later(log: RunLog): void {
    clearTimeout(timers.get(log.runId));
    timers.set(
      log.runId,
      setTimeout(() => void closeStale(log), staleAfter),
    );
  }

  /**
   * `byPerson`: what moved is the person's change (flow.inputChanged), so the later steps run again. A command says
   * so by its source; a recheck can't tell who moved a ref, so it says so only when an export card went stale (only
   * a person edits while the card waits). Anything else is the flow's own work: the gaps step's edits, or a newer
   * template version the Analyst made (FIX-RUN: answering the variants question ran the Librarian twice).
   */
  async function check(log: RunLog, commandId: string, byPerson?: boolean): Promise<boolean> {
    const stale = await staleExports(log.state, deps.refs);
    const { moved, stepIds } =
      (byPerson ?? stale.length > 0) ? await changes(log.state, deps.refs) : { moved: [], stepIds: [] };
    if (moved.length === 0 && stale.length === 0) return false;
    if (moved.length > 0) {
      const logged = await log.append(['flow.inputChanged', { stepIds, refs: moved, commandId }]);
      if (!logged.ok) return false;
      await refreshCards(log, stepIds);
    }
    // Closed now, not after the quiet moment, so the grant can't land in between.
    if (stale.length > 0 && !(await log.append(...stale.flatMap(staleEvents))).ok) return false;
    if (stale.length > 0 || waitingExport(log.state)) later(log);
    return stale.length > 0;
  }

  async function refreshCards(log: RunLog, stepIds: readonly string[]): Promise<void> {
    for (const step of log.state.plan ?? []) {
      if (!stepIds.includes(step.id) || !step.skill || !step.handedOff) continue;
      const skill = deps.skills.get(step.skill);
      if (!skill) continue;
      const card = await handoffCard(
        { log, signal: new AbortController().signal },
        step,
        skill,
        step.handedOff.output,
        true,
      );
      if (card) await log.append(['card.sent', { card, stepId: step.id }]);
    }
  }

  return {
    async noteCommand(change) {
      // The agent's own edits are the flow working, not the user changing it.
      if (change.source === 'agent' || !change.projectId) return;
      for (const log of deps.runs()) {
        const state = log.state;
        const projectId = state.flow?.projectId ?? state.started?.projectId;
        if (projectId !== change.projectId || !isOpen(state)) continue;
        await check(log, change.id, true);
      }
    },
    recheck: (log, why) => (isOpen(log.state) ? check(log, why) : Promise.resolve(false)),
    close() {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    },
  };
}
