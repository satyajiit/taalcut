// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// The app on the fake backend, as render-app.tsx has it, with one namespace's procedures watched: each call's input
// is kept, then the fake answers as usual (or `answer` stands in for it), so a test can see what reached the backend.
import { createThemeEngine, localStorageStore } from '@taalcut/ui';
import { createMemoryHistory } from '@tanstack/react-router';
import { act, render, waitFor } from '@testing-library/react';
import { expect } from 'vitest';
import { App } from '../../src/app';
import type { Backend } from '../../src/backend/contract';
import { themeTarget } from '../../src/backend/fake/expose';
import { createFakeBackend, type FakeBackendOptions } from '../../src/backend/fake/fake-backend';
import { activateLocale } from '../../src/i18n/i18n';
import { createAppRouter } from '../../src/router';
import { createTestServices } from '../../src/services/create';

export interface Watch {
  readonly namespace: keyof Backend;
  readonly procedure: string;
  /** Stands in for the fake's answer (e.g. a value for the stream); absent: the fake answers. */
  readonly answer?: (input: unknown, fake: () => unknown) => unknown;
}

/** Where a watched procedure's inputs go: `namespace.procedure`. */
export const watchKey = (watch: Watch) => `${watch.namespace}.${watch.procedure}`;

/** The client with each watched procedure's inputs recorded into `calls`, under its `watchKey`. */
export function watched(client: Backend, watches: readonly Watch[], calls: Map<string, unknown[]>): Backend {
  const spiedNamespaces = new Map<PropertyKey, object>();
  for (const watch of watches) {
    const seen: unknown[] = [];
    calls.set(watchKey(watch), seen);
    const namespace: object = spiedNamespaces.get(watch.namespace) ?? client[watch.namespace];
    spiedNamespaces.set(
      watch.namespace,
      new Proxy(namespace, {
        get(target, key, receiver) {
          const value: unknown = Reflect.get(target, key, receiver);
          if (key !== watch.procedure || typeof value !== 'function') return value;
          return (...args: unknown[]) => {
            seen.push(args[0]);
            const fake = () => Reflect.apply(value, target, args);
            return watch.answer ? watch.answer(args[0], fake) : fake();
          };
        },
      }),
    );
  }
  return new Proxy(client, {
    get: (target, key, receiver) => spiedNamespaces.get(key) ?? Reflect.get(target, key, receiver),
  });
}

/** The whole app at `path` on a fake backend whose watched procedures are recorded into the returned `calls`. */
export async function renderWatched(
  path: string,
  watches: Watch | readonly Watch[],
  options: Pick<
    FakeBackendOptions,
    'usageHistory' | 'phase2' | 'phase2b' | 'phase3' | 'plugins' | 'interfaceSounds'
  > = {},
) {
  await activateLocale('en');
  const engine = createThemeEngine({ store: localStorageStore() });
  await engine.init();
  const fake = createFakeBackend({
    theme: themeTarget(engine),
    today: () => '2026-10-12',
    signInDelayMs: 0,
    ...options,
  });
  const calls = new Map<string, unknown[]>();
  const backend = watched(fake.client, Array.isArray(watches) ? watches : [watches], calls);
  const callsTo = (watch: Watch) => calls.get(watchKey(watch)) ?? [];
  const router = createAppRouter(createMemoryHistory({ initialEntries: [path] }));
  await act(async () => {
    render(<App engine={engine} router={router} backend={backend} services={createTestServices()} />);
    await router.load();
  });
  return { router, callsTo, controls: fake.controls, client: fake.client };
}

/** Main's `files.openExternal`: how a window opens a web page in the person's browser. */
export const OPEN_EXTERNAL: Watch = { namespace: 'files', procedure: 'openExternal' };

/**
 * Clicks `link` (its href is `url`) and expects the browser's own navigation cancelled and main asked for exactly
 * `asked` so far, this page last.
 */
export async function expectOpenedThroughMain(
  link: HTMLElement,
  url: string,
  asked: readonly { url: string }[],
  callsTo: (watch: Watch) => unknown[],
) {
  expect(link.getAttribute('href')).toBe(url);
  const click = new MouseEvent('click', { bubbles: true, cancelable: true });
  await act(async () => {
    link.dispatchEvent(click);
  });
  expect(click.defaultPrevented).toBe(true);
  await waitFor(() => expect(callsTo(OPEN_EXTERNAL)).toEqual(asked));
}
