// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What the end-to-end tests need from whatever answers the renderer: make the
 * next model call for a job, and list the commands on the bus. Today that is
 * the in-page fake (window.taalcutFake). When main serves the real contracts,
 * add a driver here (for example one that asks a dev-only RPC to run a
 * recorded model call) and pick it with TAALCUT_E2E_BACKEND; the specs don't change.
 */
import type { Page } from '@playwright/test';

export interface CallReceipt {
  readonly module: string;
  readonly provider: string;
  readonly model: string;
  readonly reasoning: string;
}

export interface BackendDriver {
  /** Runs the next model call for a job, exactly as the agent would, and says which model it used. */
  nextCall(page: Page, module: string): Promise<CallReceipt>;
  /**
   * Every command registered on the command bus that people can pick (not `internal`), by name, with whether it
   * needs a payload its page supplies (the bus's `needsPayload`).
   */
  commands(page: Page): Promise<{ name: string; needsPayload?: true }[]>;
  /** Commands the bus ran on behalf of the person, oldest first. */
  dispatched(page: Page): Promise<{ name: string; source: string }[]>;
  /** What main's app menu does: sends the page a `ui.action` event. */
  menu(page: Page, action: string): Promise<void>;
  /** Runs a command on the bus as the agent would (an error's fix, say); resolves with whether it ran. */
  agentDispatch(page: Page, name: string, payload: unknown): Promise<boolean>;
  /**
   * What main does when the agent process comes back after a crash: offers the
   * cut-off run again and tells the page with `recovery.changed`. Safe to repeat.
   */
  agentRestarted(page: Page): Promise<void>;
}

/** The part of src/backend/fake's FakeControls the driver uses (window.taalcutFake). */
interface FakeHandle {
  call(module: string): CallReceipt | { code: string };
  bus: {
    list(): { name: string; internal?: true; needsPayload?: true }[];
    dispatch(
      name: string,
      payload: unknown,
      origin: { source: string; actor: string },
    ): Promise<{ ok: boolean }>;
  };
  events: { emit(type: string, payload: unknown): void };
  dispatched: { name: string; source: string }[];
}
type WithFake = {
  taalcutFake?: FakeHandle;
  /** src/services/create.ts: the fake recovery report. */
  taalcutFakeRecovery?: { agentRestarted(): number };
};

const fake: BackendDriver = {
  async nextCall(page, module) {
    const receipt = await page.evaluate((m) => (window as unknown as WithFake).taalcutFake?.call(m), module);
    if (!receipt || !('model' in receipt))
      throw new Error(`no call for ${module}: ${JSON.stringify(receipt)}`);
    return receipt;
  },
  commands: (page) =>
    page.evaluate(
      () =>
        (window as unknown as WithFake).taalcutFake?.bus
          .list()
          .filter((c) => !c.internal)
          .map(({ name, needsPayload }) => ({ name, ...(needsPayload ? { needsPayload } : {}) })) ?? [],
    ),
  dispatched: (page) =>
    page.evaluate(() => [...((window as unknown as WithFake).taalcutFake?.dispatched ?? [])]),
  menu: (page, action) =>
    page.evaluate(
      (a) => (window as unknown as WithFake).taalcutFake?.events.emit('ui.action', { action: a }),
      action,
    ),
  agentDispatch: (page, name, payload) =>
    page.evaluate(
      async ([n, p]) => {
        const result = await (window as unknown as WithFake).taalcutFake?.bus.dispatch(n, p, {
          source: 'agent',
          actor: 'agent:e2e',
        });
        return result?.ok === true;
      },
      [name, payload] as const,
    ),
  agentRestarted: (page) =>
    page.evaluate(() => {
      const w = window as unknown as WithFake;
      const unfinishedRuns = w.taalcutFakeRecovery?.agentRestarted() ?? 0;
      w.taalcutFake?.events.emit('recovery.changed', { reason: 'agent-restarted', unfinishedRuns });
    }),
};

const DRIVERS: Record<string, BackendDriver> = { fake };

export const backend: BackendDriver = DRIVERS[process.env.TAALCUT_E2E_BACKEND ?? 'fake'] ?? fake;
