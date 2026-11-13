// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Child process for the invalidation crash test. Opens the library at <db path>, which the test indexed with one
 * cut at 150, and indexes it again with vision.shots' version risen and new cuts. When the pipeline stores the new
 * shots and takes vision.shots' digest (inside that transaction, before the readers are reset), the process
 * SIGKILLs itself: a crash between a stage's write and its digest.
 *
 *   node --import tsx invalidation-child.ts <db path>
 */
import { createEventBus, systemClock, unwrap } from '@taalcut/core';
import { createIndexingPipeline, openDatabase, openVectorIndex, sqliteVecPath } from '../../src/index';
import { say } from './child-output';
import { createTestQueue, runPipeline } from './harness';
import { readingStages, risen } from './reading-stages';

const [path] = process.argv.slice(2);
if (!path) throw new Error('usage: invalidation-child.ts <db path>');
const db = unwrap(openDatabase({ path, extensions: [sqliteVecPath()], integrityCheck: 'off' }));
const vectors = unwrap(openVectorIndex(db, { name: 'stub', dimensions: 8 }));
const events = createEventBus({ clock: systemClock });
const reading = readingStages(db, vectors, { cuts: [90, 200], text: {}, silent: false });
const stages = risen(reading.stages, ['vision.shots']).map((stage) =>
  stage.stage === 'vision.shots'
    ? {
        ...stage,
        stores: () => {
          say('killed');
          process.kill(process.pid, 'SIGKILL');
          return null;
        },
      }
    : stage,
);
const queue = createTestQueue(db, events, reading.handlers);
const pipeline = createIndexingPipeline({ db, queue, events, stages, vectors: () => vectors, log: () => {} });
await pipeline.start({ poll: false });
await runPipeline(pipeline, queue);
say('finished');
