// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { err, newId, ok, type RecoveryReport, type RunSummary } from '@taalcut/core';
import { describe, expect, it, vi } from 'vitest';
import { createRecoveryState, watchAgentRestarts } from '../src/main/composition/run-recovery';
import type { SupervisorEvent } from '../src/main/utility/supervisor';

const run = (status: RunSummary['status']): RunSummary => ({
  runId: newId<'AgentRun'>(),
  conversationId: null,
  status,
  lastSeq: 3,
  startedAt: 1,
  updatedAt: 2,
});

const launch = (overrides: Partial<RecoveryReport> = {}): RecoveryReport => ({
  restoredFromBackup: null,
  unfinishedRuns: [],
  reclaimedJobs: [],
  lastCommands: [],
  needsAttention: false,
  ...overrides,
});

const BACKUP: RecoveryReport['restoredFromBackup'] = {
  reason: 'corrupt',
  detail: 'quick_check failed',
  quarantinedPath: '/q/library.db',
  restoredFrom: { path: '/b/1.db', createdAt: 1, schemaVersion: 3, reason: 'pre-migration' },
};

function setup(initial: RecoveryReport, runs: RunSummary[]) {
  const emit = vi.fn();
  const log = vi.fn();
  const read = vi.fn(() => ok({ unfinishedRuns: runs, lastCommands: [] }));
  const state = createRecoveryState({ initial, read, events: { emit }, log });
  return { state, emit, log, read };
}

describe('recovery state', () => {
  it('serves the launch report until it is seen', () => {
    const { state } = setup(launch({ unfinishedRuns: [run('paused')], needsAttention: true }), []);
    expect(state.report().needsAttention).toBe(true);
    state.seen();
    expect(state.report()).toMatchObject({ needsAttention: false, unfinishedRuns: [{ status: 'paused' }] });
  });

  it('after an agent crash cut a run off, offers the runs again and tells the windows', () => {
    const interrupted = run('running');
    const waiting = run('paused');
    const { state, emit } = setup(launch(), [interrupted, waiting]);
    state.seen();
    state.agentRestarted();
    expect(state.report()).toMatchObject({
      needsAttention: true,
      unfinishedRuns: [{ runId: interrupted.runId }, { runId: waiting.runId }],
    });
    expect(emit).toHaveBeenCalledExactlyOnceWith('recovery.changed', {
      reason: 'agent-restarted',
      unfinishedRuns: 2,
    });
  });

  it('stays quiet when no run was running: paused runs wait for the user anyway', () => {
    const { state, emit } = setup(launch(), [run('paused')]);
    state.agentRestarted();
    expect(state.report()).toMatchObject({ needsAttention: false, unfinishedRuns: [] });
    expect(emit).not.toHaveBeenCalled();
  });

  it('keeps an unseen launch report’s restore and reclaimed jobs, and drops a seen one’s', () => {
    const job = {
      id: newId<'Job'>(),
      kind: 'media.probe',
      projectId: null,
      state: 'queued',
      progress: null,
    } as const;
    const unseen = setup(launch({ restoredFromBackup: BACKUP, reclaimedJobs: [job], needsAttention: true }), [
      run('running'),
    ]);
    unseen.state.agentRestarted();
    expect(unseen.state.report()).toMatchObject({ restoredFromBackup: BACKUP, reclaimedJobs: [job] });

    const seen = setup(launch({ restoredFromBackup: BACKUP, reclaimedJobs: [job], needsAttention: true }), [
      run('running'),
    ]);
    seen.state.seen();
    seen.state.agentRestarted();
    expect(seen.state.report()).toMatchObject({
      restoredFromBackup: null,
      reclaimedJobs: [],
      needsAttention: true,
    });
  });

  it('logs a failed read and keeps the report', () => {
    const emit = vi.fn();
    const log = vi.fn();
    const initial = launch({ unfinishedRuns: [run('running')], needsAttention: true });
    const state = createRecoveryState({
      initial,
      read: () => err({ code: 'library.db_busy' } as never),
      events: { emit },
      log,
    });
    state.agentRestarted();
    expect(state.report()).toEqual(initial);
    expect(emit).not.toHaveBeenCalled();
    expect(log.mock.calls[0]?.[0]).toMatch(/agent restarted: library.db_busy/);
  });
});

describe('watchAgentRestarts', () => {
  it('fires when the agent starts again after an unexpected exit, and only then', () => {
    const listeners = new Set<(event: SupervisorEvent) => void>();
    const supervisor = {
      on(listener: (event: SupervisorEvent) => void) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
    const send = (event: SupervisorEvent) => listeners.forEach((listener) => listener(event));
    const onRestart = vi.fn();
    const stop = watchAgentRestarts(supervisor, onRestart);

    send({ type: 'started', name: 'agent', restarts: 0 });
    send({ type: 'exited', name: 'agent', code: 0, expected: true });
    send({ type: 'started', name: 'agent', restarts: 0 });
    send({ type: 'exited', name: 'jobs', code: 9, expected: false });
    send({ type: 'started', name: 'jobs', restarts: 1 });
    expect(onRestart).not.toHaveBeenCalled();

    send({ type: 'exited', name: 'agent', code: 9, expected: false });
    send({ type: 'restart-scheduled', name: 'agent', delayMs: 100, attempt: 0 });
    send({ type: 'started', name: 'agent', restarts: 1 });
    send({ type: 'started', name: 'agent', restarts: 1 });
    expect(onRestart).toHaveBeenCalledOnce();

    stop();
    send({ type: 'exited', name: 'agent', code: 9, expected: false });
    send({ type: 'started', name: 'agent', restarts: 2 });
    expect(onRestart).toHaveBeenCalledOnce();
  });
});
