// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// What the window asks the fake backend, read off the MessagePort between them (the same oRPC messages main gets):
// a spec watches a procedure's path ('/files/openExternal', '/usage/list', '/commands/dispatch') before the page
// loads, then reads each call's input in order. It observes; the fake still answers every call. `fakeCall` drives
// the page fake's controls (sign in, undo) the way a person's other window would.
import type { Page } from '@playwright/test';

declare global {
  interface Window {
    /** Inputs the window sent, by procedure path (this watch's record). */
    __wire?: Record<string, unknown[]>;
  }
}

/** Starts recording the inputs of calls to `paths` on every load of this page. */
export async function watchWire(page: Page, paths: readonly string[]): Promise<void> {
  await page.addInitScript((watched: readonly string[]) => {
    const wire: Record<string, unknown[]> = Object.fromEntries(watched.map((path) => [path, []]));
    window.__wire = wire;
    // The two ways a port posts, each typed on its own (the method is overloaded).
    const withTransfer: (this: MessagePort, message: unknown, transfer: Transferable[]) => void =
      MessagePort.prototype.postMessage;
    const withOptions: (this: MessagePort, message: unknown, options?: StructuredSerializeOptions) => void =
      MessagePort.prototype.postMessage;
    MessagePort.prototype.postMessage = function (
      this: MessagePort,
      data: unknown,
      options?: Transferable[] | StructuredSerializeOptions,
    ) {
      if (typeof data === 'string' && watched.some((path) => data.includes(path))) {
        const message: unknown = JSON.parse(data);
        const request = (message as { p?: { u?: unknown; b?: { json?: unknown } } }).p;
        if (typeof request?.u === 'string') wire[request.u]?.push(request.b?.json);
      }
      if (Array.isArray(options)) withTransfer.call(this, data, options);
      else withOptions.call(this, data, options);
    };
  }, paths);
}

/** The inputs sent to `path` so far, in order. */
export function wireCalls<T = unknown>(page: Page, path: string): Promise<T[]> {
  return page.evaluate((watched) => window.__wire?.[watched] ?? [], path) as Promise<T[]>;
}

/**
 * Calls one of the page fake's controls (`window.taalcutFake`, src/backend/fake/fake-backend.ts FakeControls) by
 * its path, e.g. `fakeCall(page, 'accounts.signIn', ['openai-codex'])`; resolves with what it answered.
 */
export function fakeCall(page: Page, path: string, args: readonly unknown[] = []): Promise<unknown> {
  return page.evaluate(
    async ({ path, args }) => {
      const keys = path.split('.');
      const name = keys.pop() ?? '';
      let owner: unknown = Reflect.get(window, 'taalcutFake');
      for (const key of keys)
        owner = typeof owner === 'object' && owner ? Reflect.get(owner, key) : undefined;
      const method: unknown = typeof owner === 'object' && owner ? Reflect.get(owner, name) : undefined;
      if (typeof method !== 'function') throw new Error(`the fake has no ${path}`);
      // Values only: what crosses back to the test is what JSON keeps.
      return JSON.parse(JSON.stringify((await Reflect.apply(method, owner, args)) ?? null)) as unknown;
    },
    { path, args },
  );
}
