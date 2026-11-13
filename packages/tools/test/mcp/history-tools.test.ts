// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * taalcut_redo can't apply a destructive command again (security review SB-37): as a tool call it would have
 * waited for the in-app approval, which a redo would skip. Other redos and every undo go to the bus as before.
 */
import { describe, expect, it } from 'vitest';
import { newId, ok, type CommandBus, type CommandInfo, type HistoryState } from '@taalcut/core';
import { historyTools } from '../../src/mcp-gateway/history-tools';

const origin = { source: 'mcp', actor: 'mcp:session' } as const;

function fakeBus(state: HistoryState, commands: readonly CommandInfo[]) {
  const applied: string[] = [];
  const bus: Pick<CommandBus, 'undo' | 'redo' | 'history' | 'list'> = {
    history: async () => ok(state),
    list: () => [...commands],
    undo: async () => {
      applied.push('undo');
      return ok(state.undo ? { id: newId<'Command'>(), name: state.undo, projectId: null } : null);
    },
    redo: async () => {
      applied.push('redo');
      return ok(state.redo ? { id: newId<'Command'>(), name: state.redo, projectId: null } : null);
    },
  };
  const tools = new Map(historyTools(bus).map((tool) => [tool.def.name, tool]));
  return { applied, tools };
}

const commands: CommandInfo[] = [
  { name: 'timeline.swapClip', sideEffect: 'write', labelKey: 'commands.timeline.swapClip' },
  { name: 'timeline.removeSlot', sideEffect: 'destructive', labelKey: 'commands.timeline.removeSlot' },
];

describe('taalcut_redo and taalcut_undo', () => {
  it('refuses to redo a destructive command and applies nothing', async () => {
    const { applied, tools } = fakeBus({ undo: null, redo: 'timeline.removeSlot' }, commands);
    const redone = await tools.get('taalcut_redo')?.run({ projectId: newId<'Project'>() }, origin);
    expect(redone?.ok === false && redone.error).toMatchObject({
      code: 'mcp.person_only',
      params: { command: 'timeline.removeSlot' },
    });
    expect(applied).toEqual([]);
  });

  it("refuses to redo an agent turn's group, which may hold a destructive command (EDT1)", async () => {
    const { applied, tools } = fakeBus(
      { undo: null, redo: 'timeline.swapClip', redoGroup: 'turn:run' },
      commands,
    );
    const redone = await tools.get('taalcut_redo')?.run({ projectId: newId<'Project'>() }, origin);
    expect(redone?.ok === false && redone.error.code).toBe('mcp.person_only');
    expect(applied).toEqual([]);
  });

  it('redoes a write and undoes anything, through the bus', async () => {
    const { applied, tools } = fakeBus({ undo: 'timeline.removeSlot', redo: 'timeline.swapClip' }, commands);
    const projectId = newId<'Project'>();
    expect(await tools.get('taalcut_redo')?.run({ projectId }, origin)).toEqual(
      ok({ command: 'timeline.swapClip' }),
    );
    expect(await tools.get('taalcut_undo')?.run({ projectId }, origin)).toEqual(
      ok({ command: 'timeline.removeSlot' }),
    );
    expect(applied).toEqual(['redo', 'undo']);
  });
});
