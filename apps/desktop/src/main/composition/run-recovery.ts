// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The crash-recovery report main serves (appContract.recovery), kept current
 * after launch (P1-D5). At launch it is the report the library built when
 * main opened it. Later, the agent process can crash on its own while main
 * keeps running: the supervisor restarts it, but the runs it was driving
 * stopped partway and nothing would pick them up until the next launch. So
 * when the agent starts again after an unexpected exit, main reads the
 * unfinished runs and last commands again the way the launch path does, and
 * if a run was interrupted (still `running` in its log) it offers the report
 * again and tells every window with `recovery.changed`, so the renderer shows
 * the same Resume / Not now prompt. Electron-free; unit-tested.
 */
import type { EventBus, RecoveryReport, Result } from '@taalcut/core';
import type { SupervisorEvent } from '../utility/supervisor';

/** The launch path's run recovery (buildRecoveryReport without reclaiming jobs): runs and commands. */
export type ReadRunRecovery = () => Result<Pick<RecoveryReport, 'unfinishedRuns' | 'lastCommands'>>;

export interface RecoveryState {
  /** What recovery.report answers: needsAttention is false once the report has been seen. */
  report(): RecoveryReport;
  /** Resume or Not now: don't offer this report again. */
  seen(): void;
  /** The agent was restarted after a crash: re-read the runs and offer them if one was interrupted. */
  agentRestarted(): void;
}

export function createRecoveryState(deps: {
  readonly initial: RecoveryReport;
  readonly read: ReadRunRecovery;
  readonly events: Pick<EventBus, 'emit'>;
  readonly log?: (message: string) => void;
}): RecoveryState {
  const log = deps.log ?? ((message: string) => console.warn(message));
  let current = deps.initial;
  let wasSeen = false;

  return {
    report: () => ({ ...current, needsAttention: current.needsAttention && !wasSeen }),
    seen() {
      wasSeen = true;
    },
    agentRestarted() {
      const fresh = deps.read();
      if (!fresh.ok) {
        log(`[recovery] runs not read again after the agent restarted: ${fresh.error.code}`);
        return;
      }
      // Paused runs wait for the user, crash or not; only a running one was cut off.
      if (!fresh.value.unfinishedRuns.some((run) => run.status === 'running')) return;
      // An unseen launch report keeps its restore and reclaimed jobs; a seen one is done with.
      const kept = wasSeen
        ? { restoredFromBackup: null, reclaimedJobs: [] }
        : { restoredFromBackup: current.restoredFromBackup, reclaimedJobs: current.reclaimedJobs };
      current = {
        ...kept,
        unfinishedRuns: fresh.value.unfinishedRuns,
        lastCommands: fresh.value.lastCommands,
        needsAttention: true,
      };
      wasSeen = false;
      deps.events.emit('recovery.changed', {
        reason: 'agent-restarted',
        unfinishedRuns: current.unfinishedRuns.length,
      });
    },
  };
}

/** Calls `onRestart` each time the agent process starts again after an unexpected exit. */
export function watchAgentRestarts(
  supervisor: { on(listener: (event: SupervisorEvent) => void): () => void },
  onRestart: () => void,
): () => void {
  let crashed = false;
  return supervisor.on((event) => {
    if (event.name !== 'agent') return;
    if (event.type === 'exited' && !event.expected) crashed = true;
    if (event.type === 'started' && crashed) {
      crashed = false;
      onRestart();
    }
  });
}
