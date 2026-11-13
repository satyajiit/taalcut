// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Tool review findings 1 and 3, seen from the agent. A write whose command
 * was applied but whose answer was unusable is logged with its idempotency
 * key, so a repeat in the same run gets the error back instead of applying the
 * command again, even from a new agent process reading the same log. The
 * command bus gets each attempt's signal.
 */
import { defineTool, defineToolModule, NO_TOOL_RETRY, ok, unwrap, type ToolModule } from '@taalcut/core';
import { createMemoryEventLogStore, type CommandDispatcher } from '@taalcut/agent';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { clipsModule } from './support/fixtures';
import { call, harness, ofType, plan, recordingCommands, turns } from './support/harness';

const ask = { conversationId: 'c', message: 'Save a note, then delete c1.' };

/** notes.save applies its command and then answers in the wrong shape: a bug in the tool. */
function notesModule(): ToolModule {
  return defineToolModule({
    id: 'notes',
    tools: [
      defineTool({
        name: 'notes.save',
        version: '1.0.0',
        description: 'Saves a note on a clip. Undoable.',
        input: z.object({ text: z.string() }),
        output: z.object({ saved: z.boolean() }),
        costClass: 'local',
        sideEffect: 'write',
        command: 'notes.save',
        timeoutMs: 1_000,
        retry: NO_TOOL_RETRY,
        idempotencyKey: (input) => input.text,
        run: async (input, ctx) => {
          const done = await ctx.dispatch(input);
          return done.ok ? ok({ saved: 'yes' } as never) : done;
        },
      }),
    ],
  });
}

/** Counts every dispatch, applied or refused, and keeps the meta it was given. */
function countingCommands() {
  const { commands, applied } = recordingCommands();
  const metas: Parameters<CommandDispatcher['dispatch']>[2][] = [];
  const counting: CommandDispatcher = {
    dispatch: (command, payload, meta) => (metas.push(meta), commands.dispatch(command, payload, meta)),
  };
  return { commands: counting, applied, metas };
}

const modules = () => [clipsModule(), notesModule()];
const save = { toolCalls: [call('notes_save', { text: 'hi' })] };

describe('a write whose answer was lost', () => {
  it('is not dispatched again when the model repeats it in the same run', async () => {
    const { commands, metas } = countingCommands();
    const h = harness({
      modules: modules(),
      deps: { commands },
      script: turns(plan('Save'), save, save, { text: 'The note could not be confirmed.' }),
    });
    const outcome = unwrap(await h.agent.run(ask));
    const failed = ofType(await h.events(outcome.runId), 'tool.failed').map((e) => e.payload);
    expect(failed.map((p) => p.error.code)).toEqual(['tools.invalid_output', 'tools.invalid_output']);
    expect(failed[0]?.idempotencyKey).toBe(`${outcome.runId}:notes.save:hi`);
    expect(metas).toHaveLength(1);
    expect(metas[0]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('is not dispatched again by a new agent that resumes the run from the log', async () => {
    const store = createMemoryEventLogStore();
    const { commands, applied, metas } = countingCommands();
    // Turns count the assistant messages in the history, so both agents follow one script.
    const delete1 = { toolCalls: [call('clips_deleteClip', { id: 'c1' })] };
    const script = turns(plan('Save, then delete'), save, delete1, save, { text: 'Done.' });
    const first = harness({
      store,
      modules: modules(),
      deps: { commands },
      script,
    });
    const paused = unwrap(await first.agent.run(ask));
    expect(paused).toMatchObject({ status: 'paused', pending: [{ kind: 'tool' }] });

    // Another process (fresh executor, fresh memory) picks the run up after the user approves.
    const second = harness({ store, modules: modules(), deps: { commands }, script });
    const requestId = paused.pending[0]!.requestId;
    const done = unwrap(await second.agent.answer(paused.runId, { requestId, decision: 'approve' }));
    expect(done.status).toBe('completed');
    expect(metas.map((m) => m.tool)).toEqual(['notes.save', 'clips.deleteClip']);
    expect(applied.map((a) => a.command)).toEqual(['notes.save', 'clips.deleteClip']);
    const failed = ofType(await second.events(done.runId), 'tool.failed');
    expect(failed.map((e) => e.payload.error.code)).toEqual(['tools.invalid_output', 'tools.invalid_output']);
  });
});
