// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import {
  BETA_TERMS,
  createCommandBus,
  createMemoryAuditLogStore,
  createMemorySettingsStore,
  ok,
  systemClock,
  UPDATE_CHANNEL_SETTING,
  UPDATE_COMMANDS,
} from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createUpdateCommands } from '../src/utility/roots/agent-updates';

const person = { source: 'ui', actor: 'user' } as const;

function setup(agreed: boolean) {
  const settings = createMemorySettingsStore();
  const asked: string[][] = [];
  const bus = createCommandBus({ store: createMemoryAuditLogStore(), clock: systemClock });
  bus.register(
    ...createUpdateCommands({
      settings,
      acknowledgements: {
        has: async (featureId, termsVersion) => {
          asked.push([featureId, termsVersion]);
          return ok(agreed);
        },
      },
    }),
  );
  const channel = async () => {
    const stored = await settings.get(UPDATE_CHANNEL_SETTING);
    return stored.ok ? stored.value : 'unreadable';
  };
  return { bus, channel, asked };
}

describe('updates.setChannel', () => {
  it('needs the beta terms agreed before Beta, and says which', async () => {
    const { bus, channel, asked } = setup(false);
    const refused = await bus.dispatch(UPDATE_COMMANDS.setChannel, { channel: 'beta' }, person);
    expect(refused).toMatchObject({
      ok: false,
      error: { code: 'desktop.beta_terms_required', params: { ...BETA_TERMS } },
    });
    expect(asked).toEqual([[BETA_TERMS.featureId, BETA_TERMS.termsVersion]]);
    expect(await channel()).toBeNull();
    // Stable needs no terms.
    expect((await bus.dispatch(UPDATE_COMMANDS.setChannel, { channel: 'stable' }, person)).ok).toBe(true);
    expect(await channel()).toBe('stable');
  });

  it('is undoable back to the previous choice, including "the build\'s own"', async () => {
    const { bus, channel } = setup(true);
    expect((await bus.dispatch(UPDATE_COMMANDS.setChannel, { channel: 'beta' }, person)).ok).toBe(true);
    expect((await bus.dispatch(UPDATE_COMMANDS.setChannel, { channel: 'stable' }, person)).ok).toBe(true);
    expect(await channel()).toBe('stable');
    expect((await bus.undo(null, person)).ok).toBe(true);
    expect(await channel()).toBe('beta');
    expect((await bus.undo(null, person)).ok).toBe(true);
    expect(await channel()).toBeNull();
    expect((await bus.redo(null, person)).ok).toBe(true);
    expect(await channel()).toBe('beta');
  });

  it('writes nothing for an unchanged choice', async () => {
    const { bus } = setup(true);
    await bus.dispatch(UPDATE_COMMANDS.setChannel, { channel: 'stable' }, person);
    const again = await bus.dispatch(UPDATE_COMMANDS.setChannel, { channel: 'stable' }, person);
    expect(again).toMatchObject({ ok: true, value: { undoable: false } });
  });

  it('refuses the agent and MCP clients: only a person at this Mac picks the channel', async () => {
    const { bus, channel } = setup(true);
    for (const origin of [
      { source: 'agent', actor: 'agent:run' },
      { source: 'mcp', actor: 'mcp:session' },
    ] as const) {
      const refused = await bus.dispatch(UPDATE_COMMANDS.setChannel, { channel: 'stable' }, origin);
      expect(refused).toMatchObject({ ok: false, error: { code: 'core.command_source_refused' } });
    }
    expect(await channel()).toBeNull();
  });

  it("goes back to the build's own channel with null, and undo brings the choice back", async () => {
    const { bus, channel } = setup(true);
    await bus.dispatch(UPDATE_COMMANDS.setChannel, { channel: 'stable' }, person);
    const own = await bus.dispatch(UPDATE_COMMANDS.setChannel, { channel: null }, person);
    expect(own.ok).toBe(true);
    expect(await channel()).toBeNull();
    expect((await bus.undo(null, person)).ok).toBe(true);
    expect(await channel()).toBe('stable');
    // The old internal inverse is gone: setChannel's payload names null itself (contract round P3-3).
    const removed = await bus.dispatch('updates.restoreChannel', { channel: null }, person);
    expect(removed.ok).toBe(false);
  });
});
