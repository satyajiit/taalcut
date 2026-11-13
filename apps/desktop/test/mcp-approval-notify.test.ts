// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * An external agent's call waiting for the person (P3-V4): a system notification names the session when no window
 * is focused; the built-in agent's approvals, a focused window and an unsupported system post nothing.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  createEventBus,
  err,
  newId,
  ok,
  ProcessRestartedError,
  systemClock,
  type AsyncResult,
  type RunId,
} from '@taalcut/core';
import { mainI18n } from '../src/main/i18n/i18n';
import { startMcpApprovalNotifications } from '../src/main/mcp/approval-notify';
import type { NotificationLike } from '../src/main/render/render-notify';

interface Shown {
  readonly title: string;
  readonly body: string;
  readonly listeners: Map<string, () => void>;
  shows: number;
}

function harness(options: { supported?: boolean; focused?: boolean; failLookup?: boolean } = {}) {
  const events = createEventBus({ clock: systemClock });
  const sessionRun = newId<'AgentRun'>();
  const shown: Shown[] = [];
  const logs: string[] = [];
  const open = vi.fn();
  let focused = options.focused ?? false;
  const sessionOf = async (runId: RunId): AsyncResult<{ name: string } | undefined> => {
    if (options.failLookup) return err(ProcessRestartedError({ process: 'agent' }));
    return ok(runId === sessionRun ? { name: 'Claude Code on this Mac' } : undefined);
  };
  const stop = startMcpApprovalNotifications({
    events,
    i18n: mainI18n('en'),
    isSupported: () => options.supported ?? true,
    windowFocused: () => focused,
    open,
    sessionOf,
    log: (line) => logs.push(line),
    create: (texts) => {
      const entry: Shown = { ...texts, listeners: new Map(), shows: 0 };
      shown.push(entry);
      const notification: NotificationLike = {
        show: () => void (entry.shows += 1),
        on: (event, listener) => entry.listeners.set(event, listener),
      };
      return notification;
    },
  });
  const ask = (runId: RunId) =>
    events.emit('agent.approvalRequested', {
      runId,
      approvalId: 'approval-1',
      tool: 'render.export',
      sideEffect: 'external',
      reason: 'Export the reel',
    });
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  return { shown, logs, open, ask, settle, stop, sessionRun, focus: (value: boolean) => (focused = value) };
}

describe('approval notifications for external agents', () => {
  it('names the session when no window is focused, and a click opens the agent area', async () => {
    const h = harness();
    h.ask(h.sessionRun);
    await h.settle();
    expect(h.shown).toHaveLength(1);
    const [first] = h.shown;
    expect(first).toMatchObject({
      title: 'Claude Code on this Mac is waiting for you',
      body: 'It asked to do something that needs your approval. Open Taalcut to approve or decline it.',
      shows: 1,
    });
    first?.listeners.get('click')?.();
    expect(h.open).toHaveBeenCalledTimes(1);
  });

  it("stays quiet for the built-in agent's runs, a focused window and an unsupported system", async () => {
    const builtIn = harness();
    builtIn.ask(newId<'AgentRun'>());
    const focused = harness({ focused: true });
    focused.ask(focused.sessionRun);
    const unsupported = harness({ supported: false });
    unsupported.ask(unsupported.sessionRun);
    await builtIn.settle();
    expect([builtIn.shown, focused.shown, unsupported.shown]).toEqual([[], [], []]);
  });

  it('stays quiet when focus comes back during the lookup, and logs a failed lookup', async () => {
    const h = harness();
    h.ask(h.sessionRun);
    h.focus(true);
    await h.settle();
    expect(h.shown).toEqual([]);

    const failing = harness({ failLookup: true });
    failing.ask(failing.sessionRun);
    await failing.settle();
    expect(failing.shown).toEqual([]);
    expect(failing.logs).toEqual(['[mcp] approval notification skipped: core.process_restarted']);
  });

  it('stops listening', async () => {
    const h = harness();
    h.stop();
    h.ask(h.sessionRun);
    await h.settle();
    expect(h.shown).toEqual([]);
  });
});
