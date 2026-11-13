// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * An error's `detail` (developer text: a URL, a path, a copied cause) stays
 * in Taalcut's processes. Payload schemas a window sees drop it, and a port
 * served without `exposeDetail` (a window's) drops it from everything it
 * sends, thrown or not; process-to-process ports keep it.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  agentRunFinishedSchema,
  connectRpc,
  eventIterator,
  implementContract,
  ipc,
  jobSnapshotSchema,
  newId,
  publicJobSnapshotSchema,
  recoveryReportSchema,
  serveRpc,
  taalcutEventSchema,
  withoutDetails,
  type JobSnapshot,
  type TaalcutError,
} from '@taalcut/core';
import { channel } from './helpers/ports';

const failed: TaalcutError = {
  code: 'jobs.download_failed',
  messageKey: 'errors.jobs.download_failed',
  retryable: true,
  detail: 'HTTP 404 from https://models.example/private/x.gguf',
};
const { detail: _detail, ...shown } = failed;

const job: JobSnapshot = {
  id: newId<'Job'>(),
  kind: 'components.install',
  state: 'failed',
  priority: 'normal',
  resource: 'network',
  projectId: null,
  idempotencyKey: null,
  parentId: null,
  attempt: 3,
  maxAttempts: 3,
  progress: null,
  error: failed,
  createdAt: 1,
  updatedAt: 2,
  startedAt: 1,
  finishedAt: 2,
  nextAttemptAt: null,
};

describe('payload schemas a window sees', () => {
  it('drop detail from events, job snapshots and the recovery report; the job store keeps it', () => {
    const runId = newId<'AgentRun'>();
    expect(agentRunFinishedSchema.parse({ runId, status: 'failed', error: failed })).toEqual({
      runId,
      status: 'failed',
      error: shown,
    });
    const event = taalcutEventSchema.parse({
      type: 'job.stateChanged',
      at: 3,
      payload: {
        jobId: job.id,
        kind: job.kind,
        projectId: null,
        from: 'running',
        to: 'failed',
        attempt: 3,
        error: failed,
      },
    });
    expect(event.type === 'job.stateChanged' && event.payload.error).toEqual(shown);
    expect(publicJobSnapshotSchema.parse(job).error).toEqual(shown);
    expect(jobSnapshotSchema.parse(job).error).toEqual(failed);

    const report = recoveryReportSchema.parse({
      restoredFromBackup: {
        reason: 'corrupt',
        detail: 'quick_check: database disk image is malformed at /Users/x/Library/library.db',
        quarantinedPath: null,
        restoredFrom: { path: '/b/1.db', createdAt: 1, schemaVersion: 4, reason: 'daily' },
      },
      unfinishedRuns: [],
      reclaimedJobs: [],
      lastCommands: [],
      needsAttention: true,
    });
    expect(report.restoredFromBackup).not.toHaveProperty('detail');
  });
});

describe('withoutDetails', () => {
  it('drops detail from every error inside a value, and returns a value without one unchanged', () => {
    const value = {
      jobs: [{ error: failed }, { error: null }],
      card: { fix: { error: failed } },
      when: new Date(0),
    };
    expect(withoutDetails(value)).toEqual({
      jobs: [{ error: shown }, { error: null }],
      card: { fix: { error: shown } },
      when: new Date(0),
    });
    expect(value.jobs[0]!.error).toBe(failed);
    const clean = { jobs: [{ error: shown }], n: 1 };
    expect(withoutDetails(clean)).toBe(clean);
    expect(withoutDetails(failed)).toEqual(shown);
    expect(withoutDetails('text')).toBe('text');
  });
});

const looseContract = {
  report: ipc.output(z.unknown()),
  reports: ipc.output(eventIterator(z.unknown())),
};

function serve(exposeDetail: boolean) {
  const os = implementContract(looseContract);
  const router = os.router({
    report: os.report.handler(() => ({ job: { error: failed } })),
    reports: os.reports.handler(async function* () {
      yield { error: failed };
      yield [failed];
    }),
  });
  const { port1, port2 } = channel();
  serveRpc(router, port1, { context: {}, exposeDetail });
  return connectRpc(looseContract, port2, { peer: 'main' }).client;
}

async function all(stream: AsyncIterable<unknown>) {
  const items: unknown[] = [];
  for await (const item of stream) items.push(item);
  return items;
}

describe('a port served without exposeDetail', () => {
  it('drops detail from errors inside outputs and streamed items, whatever the schema', async () => {
    const page = serve(false);
    expect(await page.report()).toEqual({ job: { error: shown } });
    expect(await all(await page.reports())).toEqual([{ error: shown }, [shown]]);
  });

  it('keeps it between processes', async () => {
    const process = serve(true);
    expect(await process.report()).toEqual({ job: { error: failed } });
    expect(await all(await process.reports())).toEqual([{ error: failed }, [failed]]);
  });
});
