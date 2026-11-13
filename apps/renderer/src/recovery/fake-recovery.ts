// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* eslint-disable lingui/no-unlocalized-strings -- fake report data: paths, names and identifiers */

import {
  ok,
  type CommandId,
  type ConversationId,
  type JobId,
  type ProjectCommands,
  type ProjectId,
  type RecoveryReport,
  type RunId,
} from '@taalcut/core';
import type { RecoveryClient } from './client';

/**
 * The recovery prompt's fake backend: one fixed report per scenario at
 * launch, chosen with `{ "recovery": "<scenario>" }` in localStorage
 * `taalcut.fake`, and later the agent-restart re-offer main makes
 * (agentRestarted, as in apps/desktop's run-recovery.ts).
 */
export const RECOVERY_SCENARIOS = ['none', 'restored', 'missing', 'unfinished', 'everything'] as const;
export type RecoveryScenario = (typeof RECOVERY_SCENARIOS)[number];

export function isRecoveryScenario(value: unknown): value is RecoveryScenario {
  return (RECOVERY_SCENARIOS as readonly unknown[]).includes(value);
}

const T0 = Date.UTC(2026, 9, 12, 8, 0);
const PROJECT = '01K7C5M6Q8R9S0T1V2W3X4P001' as ProjectId;
/** The seeded "Trip to Goa reel" conversation, so resuming opens something real. */
const TRIP_CONVERSATION = '01K7C5M6Q8R9S0T1V2W3X4Y5Z6' as ConversationId;
export const FAKE_UNFINISHED_RUN = '01K7C5M6Q8R9S0T1V2W3X4R001' as RunId;
/** The run an agent-process crash cuts off mid-session (agentRestarted). */
export const FAKE_INTERRUPTED_RUN = '01K7C5M6Q8R9S0T1V2W3X4R002' as RunId;

const LAST_COMMANDS: ProjectCommands[] = [
  {
    projectId: PROJECT,
    projectName: 'Trip to Goa reel',
    commands: [
      { name: 'timeline.trimClip', sequence: 41 },
      { name: 'timeline.moveClip', sequence: 42 },
      { name: 'timeline.setMusic', sequence: 43 },
    ].map((command, index) => ({
      ...command,
      id: `01K7C5M6Q8R9S0T1V2W3X4C00${index}` as CommandId,
      createdAt: T0 - (3 - index) * 60_000,
      source: 'ui' as const,
      actor: 'user',
      undone: false,
    })),
  },
];

function reportFor(scenario: RecoveryScenario): RecoveryReport {
  const missing = scenario === 'missing';
  const restored = missing || scenario === 'restored' || scenario === 'everything';
  const unfinished = scenario === 'unfinished' || scenario === 'everything';
  return {
    restoredFromBackup: restored
      ? {
          reason: missing ? 'missing' : 'corrupt',
          detail: missing ? 'library.db not found' : 'quick_check: database disk image is malformed',
          quarantinedPath: missing
            ? null
            : '~/Library/Application Support/Taalcut/library.db.corrupt-1760256000000',
          restoredFrom: {
            path: '~/Library/Application Support/Taalcut/backups/library.db.1760169600000.v5.daily.bak',
            createdAt: T0 - 18 * 3_600_000,
            schemaVersion: 5,
            reason: 'daily',
          },
        }
      : null,
    unfinishedRuns: unfinished
      ? [
          {
            runId: FAKE_UNFINISHED_RUN,
            conversationId: TRIP_CONVERSATION,
            status: 'running',
            lastSeq: 17,
            startedAt: T0 - 5 * 60_000,
            updatedAt: T0 - 60_000,
          },
        ]
      : [],
    reclaimedJobs: unfinished
      ? [
          {
            id: '01K7C5M6Q8R9S0T1V2W3X4J001' as JobId,
            kind: 'media.proxy',
            projectId: PROJECT,
            state: 'queued',
            progress: 0.4,
          },
          {
            id: '01K7C5M6Q8R9S0T1V2W3X4J002' as JobId,
            kind: 'vision.index',
            projectId: null,
            state: 'failed',
            progress: null,
          },
        ]
      : [],
    lastCommands: LAST_COMMANDS,
    needsAttention: restored || unfinished,
  };
}

export interface FakeRecovery extends RecoveryClient {
  resumed(): readonly RunId[];
  /**
   * What main does when the agent process comes back after a crash: the run it
   * was driving is offered again (an unseen launch report keeps its restore
   * and jobs). Returns the number of unfinished runs, for `recovery.changed`.
   */
  agentRestarted(): number;
}

export function createFakeRecoveryClient(scenario: RecoveryScenario = 'none'): FakeRecovery {
  let current = reportFor(scenario);
  let seen = false;
  const resumed: RunId[] = [];
  const settle = () => {
    seen = true;
    current = { ...current, needsAttention: false };
  };
  const interrupted = {
    runId: FAKE_INTERRUPTED_RUN,
    conversationId: TRIP_CONVERSATION,
    status: 'running' as const,
    lastSeq: 9,
    startedAt: T0,
    updatedAt: T0 + 60_000,
  };
  return {
    report: async () => ok(current),
    agentRestarted() {
      // Every run still `running` in its log, the cut-off one included; resumed ones are going again.
      const runs = [...current.unfinishedRuns, interrupted].filter(
        (run, index, all) =>
          !resumed.includes(run.runId) && all.findIndex((other) => other.runId === run.runId) === index,
      );
      current = {
        ...(seen
          ? { restoredFromBackup: null, reclaimedJobs: [] }
          : { restoredFromBackup: current.restoredFromBackup, reclaimedJobs: current.reclaimedJobs }),
        unfinishedRuns: runs,
        lastCommands: current.lastCommands,
        needsAttention: true,
      };
      seen = false;
      return runs.length;
    },
    async resumeRuns(runIds) {
      resumed.push(...runIds);
      settle();
      return ok(undefined);
    },
    async dismiss() {
      settle();
      return ok(undefined);
    },
    resumed: () => resumed,
  };
}
