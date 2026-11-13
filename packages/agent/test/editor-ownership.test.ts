// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  createCommandBus,
  createManualClock,
  createMemoryAuditLogStore,
  newId,
  ok,
  unwrap,
} from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { call, harness, plan, turns } from './support/harness';
import { createRunFinalization } from '../src/editor/run-finalization';

const projectId = newId<'Project'>();
const bus = () => createCommandBus({ store: createMemoryAuditLogStore(), clock: createManualClock(0) });

describe('editor ownership lifecycle', () => {
  it('Stop while an action pauses still cancels, finalizes once, and unlocks', async () => {
    const commands = bus();
    const s = harness({
      script: turns(plan('Delete'), { toolCalls: [call('clips_deleteClip', { id: 'c1' })] }),
      settings: { autonomy: 'every-step' },
      deps: { editing: commands.editing },
    });
    const stopped = Promise.withResolvers<void>();
    const finishing = Promise.withResolvers<void>();
    const finish = Promise.withResolvers<void>();
    let finalizations = 0;
    s.agent.onFinalize!(async () => {
      finalizations += 1;
      finishing.resolve();
      await finish.promise;
      return ok(undefined);
    });
    s.agent.subscribe((event) => {
      if (event.type === 'run.paused')
        void s.agent.cancel(event.runId).then((result) => {
          expect(unwrap(result).status).toBe('cancelled');
          stopped.resolve();
        });
    });
    const runId = unwrap(
      await s.agent.start({ conversationId: newId<'Conversation'>(), projectId, message: 'Delete c1' }),
    );
    await finishing.promise;
    expect(commands.editing.snapshot(projectId)).toMatchObject({ runId, phase: 'stopping' });
    finish.resolve();
    await stopped.promise;
    expect(commands.editing.snapshot(projectId).phase).toBe('idle');
    expect((await s.events(runId))[0]).toMatchObject({ payload: { editingProjectId: projectId } });
    unwrap(await s.agent.cancel(runId));
    expect(finalizations).toBe(1);
  });

  it('settles executing writes before cleanup and keeps late tool admission revoked', async () => {
    const commands = bus();
    const runId = newId<'AgentRun'>();
    await commands.editing.acquire(projectId, runId);
    const finalization = createRunFinalization(commands.editing);
    const entered = Promise.withResolvers<void>();
    const finished = Promise.withResolvers<void>();
    finalization.subscribe(async () => {
      entered.resolve();
      await finished.promise;
      return ok(undefined);
    });
    const pending = finalization.finish(runId);
    await entered.promise;
    expect(commands.editing.snapshot(projectId).phase).toBe('stopping');
    expect(commands.editing.check([projectId], { source: 'agent', actor: `agent:${runId}` }).ok).toBe(false);
    finished.resolve();
    expect((await pending).ok).toBe(true);
    expect(commands.editing.snapshot(projectId).phase).toBe('idle');
  });
});
