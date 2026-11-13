// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What Settings uses from core: the usage and traces routers over their
 * ports, the typed settings store, settings.setTheme (undoable, stored in
 * the settings store, committing with its audit row) and
 * settings.openSignInWarning (a ui.action, not a change), the UI commands
 * with their shortcuts, and the new catalogue entries (reasoning, ui.action).
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  AREA_COMMANDS,
  connectRpc,
  createCommandBus,
  createEventBus,
  createMemoryAuditLogStore,
  createMemorySettingsStore,
  createSettingsCommands,
  createUiCommands,
  defineSetting,
  uiCommandShortcut,
  newId,
  NotFoundError,
  err,
  ok,
  serveRpc,
  shortcutSchema,
  systemClock,
  taalcutEventSchema,
  THEME_SETTING,
  tracesContract,
  tracesRouter,
  usageContract,
  usageRouter,
  type CommandContext,
  type SettingsStore,
  type TaalcutEvent,
  type Trace,
  type TraceStore,
  type UsageStore,
} from '@taalcut/core';
import { channel } from './helpers/ports';

const runId = newId<'AgentRun'>();

const trace: Trace = {
  runId,
  conversationId: null,
  status: 'succeeded',
  message: 'Make a reel',
  startedAt: 1,
  endedAt: 9,
  spans: [
    {
      spanId: 'run',
      parentSpanId: null,
      kind: 'run',
      name: 'Make a reel',
      startedAt: 1,
      endedAt: 9,
      status: 'ok',
      events: [],
    },
  ],
  gaps: [],
};

describe('usage and traces routers', () => {
  it('serve their ports with the contract defaults, and typed errors', async () => {
    const asked: unknown[] = [];
    const usage: UsageStore = {
      list: async (input) => {
        asked.push(input);
        return ok({
          records: [],
          totals: {
            calls: 0,
            localCalls: 0,
            inputTokens: 0,
            outputTokens: 0,
            cachedInputTokens: 0,
            costUsd: 0,
          },
        });
      },
    };
    const traces: TraceStore = {
      recordRun: async () => ok(undefined),
      recordSpan: async () => ok(undefined),
      runs: async () => ok([]),
      get: async (input) => (input.runId === runId ? ok(trace) : err(NotFoundError({ entity: 'run' }))),
    };
    const a = channel();
    serveRpc(usageRouter(usage), a.port1, { context: {} });
    const b = channel();
    serveRpc(tracesRouter(traces), b.port1, { context: {} });
    const usageClient = connectRpc(usageContract, a.port2, { peer: 'agent' }).client;
    const tracesClient = connectRpc(tracesContract, b.port2, { peer: 'agent' }).client;

    expect((await usageClient.list({ module: 'vision' })).totals.calls).toBe(0);
    expect(asked).toEqual([{ limit: 100, module: 'vision' }]);
    expect(await tracesClient.runs({})).toEqual([]);
    expect(await tracesClient.get({ runId })).toEqual(trace);
    await expect(tracesClient.get({ runId: newId<'AgentRun'>() })).rejects.toMatchObject({
      data: { code: 'core.not_found' },
    });
  });
});

describe('settings store (memory reference)', () => {
  it('returns defaults, validates, and resets', async () => {
    const settings = createMemorySettingsStore();
    const count = defineSetting('test.count', z.int().nonnegative(), 3);
    expect(await settings.get(count)).toEqual({ ok: true, value: 3 });
    expect(await settings.set(count, 5)).toEqual({ ok: true, value: 5 });
    const bad = await settings.set(count, -1);
    expect(!bad.ok && bad.error).toMatchObject({ code: 'core.validation', params: { field: 'test.count' } });
    expect(await settings.get(count)).toEqual({ ok: true, value: 5 });
    await settings.reset(count);
    expect(await settings.get(count)).toEqual({ ok: true, value: 3 });
    expect(() => defineSetting('Bad Key', z.string(), '')).toThrow();
    expect(() => defineSetting('test.x', z.string().min(2), '')).toThrow();
  });
});

describe('settings commands', () => {
  function setup() {
    const settings = createMemorySettingsStore();
    const events = createEventBus({ clock: systemClock });
    const seen: TaalcutEvent[] = [];
    events.onAny((event) => seen.push(event));
    const bus = createCommandBus({ store: createMemoryAuditLogStore(), clock: systemClock });
    bus.register(...createSettingsCommands({ settings, events }).all);
    return { settings, bus, seen };
  }
  const ui = { source: 'ui', actor: 'user' } as const;

  it('settings.setTheme stores the preference and undo puts the old one back', async () => {
    const { settings, bus } = setup();
    const receipt = await bus.dispatch('settings.setTheme', { preference: 'dark' }, ui);
    expect(receipt).toMatchObject({ ok: true, value: { undoable: true, projectId: null } });
    expect(await settings.get(THEME_SETTING)).toEqual({ ok: true, value: 'dark' });
    await bus.undo(null, ui);
    expect(await settings.get(THEME_SETTING)).toEqual({ ok: true, value: 'system' });
    const bad = await bus.dispatch('settings.setTheme', { preference: 'purple' }, ui);
    expect(!bad.ok && bad.error.code).toBe('core.validation');
  });

  it("settings.setTheme hands the store its command's context, so the write commits with the audit row", async () => {
    const memory = createMemorySettingsStore();
    const contexts: (CommandContext | undefined)[] = [];
    const settings: SettingsStore = {
      ...memory,
      set: (setting, value, context) => {
        contexts.push(context);
        return memory.set(setting, value, context);
      },
    };
    const bus = createCommandBus({ store: createMemoryAuditLogStore(), clock: systemClock });
    bus.register(...createSettingsCommands({ settings, events: createEventBus({ clock: systemClock }) }).all);
    const receipt = await bus.dispatch('settings.setTheme', { preference: 'light' }, ui);
    await bus.undo(null, ui);
    expect(contexts).toHaveLength(2);
    expect(contexts[0]).toMatchObject({ commandId: receipt.ok ? receipt.value.id : '', projectId: null });
    expect(contexts[1]).toMatchObject({ projectId: null, source: 'ui' });
  });

  it('settings.openSignInWarning asks the renderer to open the card and changes nothing', async () => {
    const { bus, seen } = setup();
    const payload = { feature: 'signin.claude', termsVersion: '2026-10-12' };
    const receipt = await bus.dispatch('settings.openSignInWarning', payload, ui);
    expect(receipt).toMatchObject({ ok: true, value: { sequence: null, undoable: false } });
    expect(seen).toMatchObject([
      { type: 'ui.action', payload: { action: 'settings.openSignInWarning', args: payload } },
    ]);
  });

  it.each(['settings.openAccounts', 'settings.openModels'])(
    '%s, a fix with no payload, asks the renderer to open its page and changes nothing',
    async (name) => {
      const { bus, seen } = setup();
      const receipt = await bus.dispatch(name, {}, ui);
      expect(receipt).toMatchObject({ ok: true, value: { sequence: null, undoable: false } });
      expect(seen).toMatchObject([{ type: 'ui.action', payload: { action: name } }]);
    },
  );
});

describe('catalogue additions', () => {
  it('has agent.reasoningDelta and ui.action, and the menu shortcuts parse', () => {
    expect(
      taalcutEventSchema.safeParse({ type: 'agent.reasoningDelta', at: 1, payload: { runId, delta: 'Hmm' } })
        .success,
    ).toBe(true);
    expect(
      taalcutEventSchema.safeParse({ type: 'ui.action', at: 1, payload: { action: 'go.library' } }).success,
    ).toBe(true);
    expect(
      taalcutEventSchema.safeParse({ type: 'ui.action', at: 1, payload: { action: 'Not An Id' } }).success,
    ).toBe(false);
  });
});

describe('UI commands', () => {
  it('carry the shortcuts menus and ⌘K show, and ask the window to act without changing anything', async () => {
    const events = createEventBus({ clock: systemClock });
    const seen: TaalcutEvent[] = [];
    events.onAny((event) => seen.push(event));
    const bus = createCommandBus({ store: createMemoryAuditLogStore(), clock: systemClock });
    bus.register(...createUiCommands({ events }).all);
    const shortcuts = Object.fromEntries(
      bus.list().flatMap((command) => (command.shortcut ? [[command.name, command.shortcut]] : [])),
    );
    expect(shortcuts).toEqual({
      'go.make': 'mod+1',
      'go.library': 'mod+2',
      'go.templates': 'mod+3',
      'go.agent': 'mod+4',
      'go.settings': 'mod+,',
      'edit.undo': 'mod+z',
      'edit.redo': 'mod+shift+z',
      'view.sidebar': 'ctrl+mod+s',
      'chat.addSelection': 'mod+shift+a',
    });
    // On a PC (Linux, Windows) ⌃⌘S would be Ctrl+S, Save: the sidebar is Ctrl+B there, the rest as they are.
    const pc = Object.fromEntries(
      bus.list().flatMap((command) => (command.pcShortcut ? [[command.name, command.pcShortcut]] : [])),
    );
    expect(pc).toEqual({ 'view.sidebar': 'mod+b' });
    expect(uiCommandShortcut('view.sidebar', 'mac')).toBe('ctrl+mod+s');
    expect(uiCommandShortcut('view.sidebar', 'pc')).toBe('mod+b');
    expect(uiCommandShortcut('edit.undo', 'pc')).toBe('mod+z');
    expect(uiCommandShortcut('go.projects', 'pc')).toBeUndefined();
    // Reached from menus and ⌘K only.
    const names = bus.list().map((command) => command.name);
    expect(names).toEqual(expect.arrayContaining(['go.projects', 'go.privacy', 'help.feedback']));
    for (const shortcut of Object.values(shortcuts))
      expect(shortcutSchema.safeParse(shortcut).success).toBe(true);
    expect(AREA_COMMANDS).toEqual(['go.make', 'go.library', 'go.templates', 'go.agent']);
    const receipt = await bus.dispatch('go.library', {}, { source: 'shortcut', actor: 'user' });
    expect(receipt).toMatchObject({ ok: true, value: { sequence: null, undoable: false } });
    expect(seen).toMatchObject([{ type: 'ui.action', payload: { action: 'go.library' } }]);
  });
});
