// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Child process for the resume test. Indexes the library at <db path> with
 * the stub stages, reporting each finished job on stdout, and SIGKILLs itself
 * inside vision.embed for <asset id>, after the vectors were written but
 * before the job completed: a quit in the middle of a stage.
 *
 *   node --import tsx index-child.ts <db path> <asset id>
 */
import { createEventBus, systemClock, unwrap } from '@taalcut/core';
import { createIndexingPipeline, openDatabase, openVectorIndex, sqliteVecPath } from '../../src/index';
import { say } from './child-output';
import { createTestQueue, runPipeline } from './harness';
import { KINDS, stubStages } from './stages';

const [path, target] = process.argv.slice(2);
const db = unwrap(openDatabase({ path: path!, extensions: [sqliteVecPath()], integrityCheck: 'off' }));
const vectors = unwrap(openVectorIndex(db, { name: 'stub', dimensions: 8 }));
const events = createEventBus({ clock: systemClock });
const stub = stubStages(db, { vectors });
const embed = stub.handlers[KINDS.embed.kind]!;
stub.handlers[KINDS.embed.kind] = async (input, jobId) => {
  const result = await embed(input, jobId);
  if ((input as { assetId: string }).assetId === target) {
    say('killed');
    process.kill(process.pid, 'SIGKILL');
  }
  return result;
};
const queue = createTestQueue(db, events, stub.handlers);
events.on('job.stateChanged', ({ payload }) => {
  if (payload.to === 'succeeded') say(`done ${payload.kind}`);
});
const pipeline = createIndexingPipeline({ db, queue, events, stages: stub.stages, log: () => {} });
await pipeline.start({ poll: false });
await runPipeline(pipeline, queue);
say('finished');
