// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Contracts and fake services for the IPC contract tests. */
import { z } from 'zod';
import {
  defineError,
  err,
  eventIterator,
  implementContract,
  ipc,
  ok,
  themeRouter as coreThemeRouter,
  unwrapRpc,
  type ResolvedTheme,
  type ThemePreference,
  type ThemeService,
  type ThemeState,
} from '@taalcut/core';

export const DiskFull = defineError<{ path: string }>('test.ipc_disk_full', {
  fix: { command: 'settings.openStorage', labelKey: 'fix.freeSpace' },
});

/** What a theme service in main looks like, minus Electron. */
export function createFakeTheme(
  system: ResolvedTheme = 'dark',
): ThemeService & { readonly listenerCount: number } {
  let preference: ThemePreference = 'system';
  const listeners = new Set<(state: ThemeState) => void>();
  const state = (): ThemeState => ({ preference, resolved: preference === 'system' ? system : preference });
  return {
    get: state,
    set(next: ThemePreference): ThemeState {
      preference = next;
      for (const listener of listeners) listener(state());
      return state();
    },
    subscribe(listener: (state: ThemeState) => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    get listenerCount() {
      return listeners.size;
    },
  };
}

export type FakeTheme = ReturnType<typeof createFakeTheme>;

/** core's themeRouter over the fake theme. */
export const themeRouter = (theme: FakeTheme) => coreThemeRouter(theme);

/** Namespaces a test's router must have but never calls. */
export function notServed<K extends string>(...keys: K[]): Record<K, never> {
  return Object.fromEntries(keys.map((key) => [key, {}])) as Record<K, never>;
}

/** A test-only contract that exercises cancellation and every error path. */
export const probeContract = {
  hang: ipc.output(z.string()),
  fail: ipc
    .input(z.object({ kind: z.enum(['result', 'throw', 'output']) }))
    .output(z.object({ n: z.number() })),
  count: ipc.input(z.object({ to: z.number().int() })).output(eventIterator(z.number())),
};

export interface ProbeLog {
  aborted: number;
  streamsClosed: number;
}

export function probeRouter(log: ProbeLog) {
  const os = implementContract(probeContract);
  return os.router({
    hang: os.hang.handler(
      ({ signal }) =>
        new Promise<string>((_resolve, reject) => {
          signal?.addEventListener('abort', () => {
            log.aborted += 1;
            reject(signal.reason);
          });
        }),
    ),
    fail: os.fail.handler(({ input }) => {
      if (input.kind === 'result')
        return unwrapRpc(err(DiskFull({ path: '/Volumes/X' }, { detail: 'ENOSPC' })));
      if (input.kind === 'throw') throw new TypeError('boom');
      return unwrapRpc(ok({ n: 'not a number' as unknown as number }));
    }),
    count: os.count.handler(async function* ({ input }) {
      try {
        for (let i = 1; i <= input.to; i++) {
          if (i === 4 && input.to === 4) throw DiskFull({ path: 'stream' });
          yield i;
          await new Promise((resolve) => setTimeout(resolve, 2));
        }
      } finally {
        log.streamsClosed += 1;
      }
    }),
  });
}
