// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { describe, expect, it } from 'vitest';
import { mergeReports } from '../src/recovery/client';
import {
  createFakeRecoveryClient,
  FAKE_INTERRUPTED_RUN,
  FAKE_UNFINISHED_RUN,
} from '../src/recovery/fake-recovery';

async function report(client: ReturnType<typeof createFakeRecoveryClient>) {
  const result = await client.report();
  if (!result.ok) throw new Error('no report');
  return result.value;
}

describe('recovery re-offers', () => {
  it('an agent restart offers the cut-off run, keeping an unseen launch report', async () => {
    const client = createFakeRecoveryClient('everything');
    const launch = await report(client);
    expect(client.agentRestarted()).toBe(2);
    const fresh = await report(client);
    expect(fresh.needsAttention).toBe(true);
    expect(fresh.restoredFromBackup).not.toBeNull();
    expect(fresh.unfinishedRuns.map((run) => run.runId)).toEqual([FAKE_UNFINISHED_RUN, FAKE_INTERRUPTED_RUN]);

    // The open prompt shows the union, once each.
    const merged = mergeReports(launch, fresh);
    expect(merged.unfinishedRuns.map((run) => run.runId)).toEqual([
      FAKE_UNFINISHED_RUN,
      FAKE_INTERRUPTED_RUN,
    ]);
    expect(merged.reclaimedJobs).toHaveLength(launch.reclaimedJobs.length);
    expect(merged.restoredFromBackup).toEqual(launch.restoredFromBackup);
  });

  it('after the report was seen, a restart offers only the runs, and not resumed ones', async () => {
    const client = createFakeRecoveryClient('everything');
    expect((await client.resumeRuns([FAKE_UNFINISHED_RUN])).ok).toBe(true);
    expect((await report(client)).needsAttention).toBe(false);
    expect(client.agentRestarted()).toBe(1);
    const fresh = await report(client);
    expect(fresh.restoredFromBackup).toBeNull();
    expect(fresh.reclaimedJobs).toEqual([]);
    expect(fresh.unfinishedRuns.map((run) => run.runId)).toEqual([FAKE_INTERRUPTED_RUN]);
  });
});
