// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Child process for the crash test. Runs the crash script on a file-backed
 * log and kills itself with SIGKILL (kill -9: no cleanup, no flush) at the
 * requested point:
 *   after-log     right after the turn asking to rename c2 is in the log, before it runs
 *   after-commit  right after the c2 rename is committed, before the log records it
 *
 *   node --import tsx crash-child.ts <dir> <after-log|after-commit>
 */
import { join } from 'node:path';
import { unwrap } from '@taalcut/core';
import {
  createAgent,
  createFileEventLogStore,
  createScriptedModelClient,
  type EventLogStore,
} from '@taalcut/agent';
import { createToolRegistry } from '@taalcut/tools';
import { CRASH_MESSAGE, crashScript, fileCommands } from './crash-script';
import { clipsModule } from './fixtures';
import { SOUL } from './harness';

const [dir = '.', mode = 'after-log'] = process.argv.slice(2);
const die = () => process.kill(process.pid, 'SIGKILL');

const files = createFileEventLogStore(join(dir, 'log'));
const store: EventLogStore = {
  ...files,
  async append(runId, expectedSeq, events) {
    const written = await files.append(runId, expectedSeq, events);
    const asksForC2 = events.some(
      (e) => e.type === 'tool.requested' && JSON.stringify(e.payload.input).includes('"c2"'),
    );
    if (mode === 'after-log' && asksForC2) die();
    return written;
  },
};

const agent = createAgent({
  models: createScriptedModelClient(crashScript),
  tools: unwrap(createToolRegistry([clipsModule()])),
  log: store,
  soul: SOUL,
  commands: fileCommands(join(dir, 'commands.jsonl'), (command) => {
    if (mode === 'after-commit' && JSON.stringify(command.payload).includes('"c2"')) die();
  }),
  settings: { autonomy: 'autopilot', budget: {} },
});

await agent.run({ conversationId: 'crash', message: CRASH_MESSAGE });
// Reaching this line means the kill point was never hit.
process.exit(3);
