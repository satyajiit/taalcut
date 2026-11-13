// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Shortcuts and internal commands: what ⌘K shows, and inverses people can't run directly. */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  callRpc,
  commandInfoSchema,
  commandsContract,
  commandsRouter,
  connectRpc,
  defineCommand,
  InternalCommand,
  ok,
  serveRpc,
  shortcutOn,
  unwrap,
} from '@taalcut/core';
import { setupBus, UI } from './helpers/bus';
import { channel } from './helpers/ports';

/** A setting with a public `set` and an internal `restore` that is its inverse. */
function themeCommands() {
  let theme = 'light';
  const inverse = (before: string) => ({ name: 'theme.restore', payload: { theme: before } });
  const set = defineCommand({
    name: 'theme.set',
    payload: z.object({ theme: z.string() }),
    sideEffect: 'write',
    shortcut: 'mod+shift+t',
    handle: ({ theme: next }) => {
      const before = theme;
      theme = next;
      return ok({ result: next, inverse: inverse(before) });
    },
  });
  const restore = defineCommand({
    name: 'theme.restore',
    payload: z.object({ theme: z.string() }),
    sideEffect: 'write',
    internal: true,
    handle: ({ theme: next }) => {
      const before = theme;
      theme = next;
      return ok({ result: next, inverse: inverse(before) });
    },
  });
  return { set, restore, current: () => theme };
}

describe('command bus: shortcuts and internal commands', () => {
  it('lists shortcuts and marks internal commands so ⌘K can hide them', () => {
    const { bus } = setupBus();
    const { set, restore } = themeCommands();
    bus.register(set, restore);
    const listed = bus.list();
    expect(listed).toEqual([
      {
        name: 'project.rename',
        sideEffect: 'write',
        labelKey: 'commands.project.rename',
        needsPayload: true,
      },
      {
        name: 'theme.restore',
        sideEffect: 'write',
        labelKey: 'commands.theme.restore',
        internal: true,
        needsPayload: true,
      },
      {
        name: 'theme.set',
        sideEffect: 'write',
        labelKey: 'commands.theme.set',
        shortcut: 'mod+shift+t',
        needsPayload: true,
      },
    ]);
    for (const info of listed) expect(commandInfoSchema.parse(info)).toEqual(info);
  });

  it('marks a command whose payload refuses {} as needing one, so ⌘K leaves it to its page', () => {
    const { bus } = setupBus();
    bus.register(
      defineCommand({
        name: 'view.refresh',
        payload: z.object({}),
        sideEffect: 'read',
        handle: () => ok({ result: null }),
      }),
      defineCommand({
        name: 'view.open',
        payload: z.object({ id: z.string() }),
        sideEffect: 'read',
        handle: () => ok({ result: null }),
      }),
    );
    const listed = new Map(bus.list().map((info) => [info.name, info]));
    expect(listed.get('view.refresh')?.needsPayload).toBeUndefined();
    expect(listed.get('view.open')?.needsPayload).toBe(true);
    for (const info of listed.values()) expect(commandInfoSchema.parse(info)).toEqual(info);
  });

  it('refuses an internal command from people, while undo and redo still run it', async () => {
    const { bus, store } = setupBus();
    const theme = themeCommands();
    bus.register(theme.set, theme.restore);
    for (const source of ['ui', 'shortcut', 'mcp'] as const) {
      const refused = await bus.dispatch('theme.restore', { theme: 'dark' }, { source, actor: 'user' });
      expect(!refused.ok && InternalCommand.is(refused.error), source).toBe(true);
      expect(!refused.ok && refused.error.params).toEqual({ name: 'theme.restore' });
    }
    expect(store.entries()).toHaveLength(0);
    expect(theme.current()).toBe('light');

    unwrap(await bus.dispatch(theme.set, { theme: 'dark' }, UI));
    expect(unwrap(await bus.undo(null, UI))).toMatchObject({ name: 'theme.set' }); // runs theme.restore
    expect(theme.current()).toBe('light');
    unwrap(await bus.redo(null, UI));
    expect(theme.current()).toBe('dark');
    // Code in the owning process (source 'agent') may still dispatch it.
    unwrap(await bus.dispatch(theme.restore, { theme: 'light' }, { source: 'agent', actor: 'agent:r1' }));
    expect(theme.current()).toBe('light');
  });

  it('refuses it over IPC too, and lists the new fields there', async () => {
    const { bus } = setupBus();
    const theme = themeCommands();
    bus.register(theme.set, theme.restore);
    const { port1, port2 } = channel();
    serveRpc(commandsRouter(bus), port1, { context: {} });
    const { client } = connectRpc(commandsContract, port2, { peer: 'agent' });
    expect((await client.list()).find((c) => c.name === 'theme.restore')).toMatchObject({ internal: true });
    const refused = await callRpc(client.dispatch({ name: 'theme.restore', payload: { theme: 'x' } }));
    expect(!refused.ok && refused.error.code).toBe('core.internal_command');
  });

  it('rejects malformed shortcuts and an internal command with a shortcut as wiring bugs', () => {
    const base = {
      name: 'x.y',
      payload: z.object({}),
      sideEffect: 'write' as const,
      handle: () => ok({ result: 1 }),
    };
    expect(() => defineCommand({ ...base, shortcut: 'Cmd+K' })).toThrow(/Invalid shortcut/);
    expect(() => defineCommand({ ...base, shortcut: 'mod+k', internal: true })).toThrow(/internal/);
    expect(defineCommand({ ...base, shortcut: 'mod+,' }).shortcut).toBe('mod+,');
    expect(defineCommand(base).internal).toBe(false);
    // A PC binding replaces a shortcut; alone, or malformed, it is a wiring bug too.
    expect(() => defineCommand({ ...base, pcShortcut: 'mod+b' })).toThrow(/Invalid PC shortcut/);
    expect(() => defineCommand({ ...base, shortcut: 'ctrl+mod+s', pcShortcut: 'Ctrl+B' })).toThrow(
      /Invalid PC shortcut/,
    );
    expect(() => defineCommand({ ...base, pcShortcut: 'mod+b', internal: true })).toThrow(/PC shortcut/);
  });

  it('binds a PC by its pcShortcut where it has one, and lists it, over IPC too', async () => {
    const { bus } = setupBus();
    bus.register(
      defineCommand({
        name: 'view.panel',
        payload: z.object({}),
        sideEffect: 'read',
        shortcut: 'ctrl+mod+p',
        pcShortcut: 'mod+b',
        handle: () => ok({ result: null }),
      }),
    );
    const info = bus.list().find((c) => c.name === 'view.panel');
    expect(info).toMatchObject({ shortcut: 'ctrl+mod+p', pcShortcut: 'mod+b' });
    expect(commandInfoSchema.parse(info)).toEqual(info);
    expect(info && [shortcutOn(info, 'mac'), shortcutOn(info, 'pc')]).toEqual(['ctrl+mod+p', 'mod+b']);
    expect(shortcutOn({ shortcut: 'mod+z' }, 'pc')).toBe('mod+z');
    expect(shortcutOn({}, 'mac')).toBeUndefined();
    const { port1, port2 } = channel();
    serveRpc(commandsRouter(bus), port1, { context: {} });
    const { client } = connectRpc(commandsContract, port2, { peer: 'agent' });
    expect((await client.list()).find((c) => c.name === 'view.panel')).toMatchObject({ pcShortcut: 'mod+b' });
  });
});
