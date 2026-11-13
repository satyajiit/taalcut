// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  appContract,
  defineCommand,
  implementContract,
  LIBRARY_COMMANDS,
  libraryCommandPayloads,
  newId,
  NotFoundError,
  ok,
  toRpcError,
  type AnyCommand,
  type JobId,
  type PublicJobSnapshot,
} from '@taalcut/core';

export function createFakeRelink() {
  const jobs = new Map<JobId, PublicJobSnapshot>();
  const os = implementContract({ get: appContract.jobs.get });
  const commands: AnyCommand[] = [
    defineCommand({
      name: LIBRARY_COMMANDS.findMissing,
      payload: libraryCommandPayloads[LIBRARY_COMMANDS.findMissing],
      sideEffect: 'read',
      project: () => null,
      handle: async () => {
        const id = newId<'Job'>();
        jobs.set(id, {
          id,
          kind: 'library.findMissingFiles',
          state: 'succeeded',
          priority: 'high',
          resource: 'io',
          projectId: null,
          idempotencyKey: null,
          parentId: null,
          attempt: 1,
          maxAttempts: 1,
          progress: null,
          error: null,
          output: { candidates: [], searched: 0 },
          createdAt: Date.now(),
          updatedAt: Date.now(),
          startedAt: Date.now(),
          finishedAt: Date.now(),
          nextAttemptAt: null,
        });
        return ok({ result: { jobId: id } });
      },
    }),
    defineCommand({
      name: LIBRARY_COMMANDS.relinkLocations,
      payload: libraryCommandPayloads[LIBRARY_COMMANDS.relinkLocations],
      sideEffect: 'write',
      project: () => null,
      handle: async ({ items }) => ok({ result: { relinked: items.length } }),
    }),
  ];
  return {
    commands,
    router: {
      jobs: os.router({
        get: os.get.handler(({ input }) => {
          const job = jobs.get(input.id);
          if (!job) throw toRpcError(NotFoundError({ entity: 'job', id: input.id }));
          return job;
        }),
      }),
    },
  };
}
