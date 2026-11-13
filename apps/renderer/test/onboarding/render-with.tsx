// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { toRpcError, type TaalcutError } from '@taalcut/core';
import { createThemeEngine, localStorageStore } from '@taalcut/ui';
import { createMemoryHistory } from '@tanstack/react-router';
import { act, render } from '@testing-library/react';
import { App } from '../../src/app';
import type { Backend } from '../../src/backend/contract';
import { themeTarget } from '../../src/backend/fake/expose';
import { createFakeBackend, type FakeBackendOptions } from '../../src/backend/fake/fake-backend';
import { activateLocale } from '../../src/i18n/i18n';
import { createAppRouter } from '../../src/router';
import { createTestServices } from '../../src/services/create';
import type { AppServices } from '../../src/services/provider';

/**
 * A read that fails `times` times with `error` (or forever), then answers as the fake does; `delayMs` slows it;
 * `answer` changes what it answers (a state the fake doesn't reach by itself, such as a download that failed).
 */
export interface Hold {
  readonly error?: TaalcutError;
  readonly times?: number;
  /** Fails while this says so, in place of `times` (a read opened by more than one screen). */
  readonly failWhile?: () => boolean;
  readonly delayMs?: number;
  readonly answer?: (value: unknown) => unknown;
}

/**
 * The fake client with some procedures failing or slowed (`'onboarding.state'`, `'system.components'`): the fake
 * backend can't fail its own reads, so the failure is put between the page and it.
 */
function holding(client: Backend, holds: Readonly<Record<string, Hold>>): Backend {
  const counts = new Map<string, number>();
  const wrapGroup = (group: string, target: object) =>
    new Proxy(target, {
      get(inner, key, receiver) {
        const value: unknown = Reflect.get(inner, key, receiver);
        const name = `${group}.${String(key)}`;
        const hold = holds[name];
        if (!hold || typeof value !== 'function') return value;
        return async (...args: unknown[]) => {
          if (hold.delayMs) await new Promise((resolve) => setTimeout(resolve, hold.delayMs));
          const seen = (counts.get(name) ?? 0) + 1;
          counts.set(name, seen);
          const failing = hold.failWhile ? hold.failWhile() : hold.times === undefined || seen <= hold.times;
          if (hold.error && failing) throw toRpcError(hold.error);
          // Reflect.apply: the client is a path proxy, so `value.apply` would name a procedure called "apply".
          const answered: unknown = await Reflect.apply(value, inner, args);
          return hold.answer ? hold.answer(answered) : answered;
        };
      },
    });
  return new Proxy(client, {
    get(target, key, receiver) {
      const value: unknown = Reflect.get(target, key, receiver);
      const group = String(key);
      const touched = Object.keys(holds).some((name) => name.startsWith(`${group}.`));
      return touched && value && (typeof value === 'object' || typeof value === 'function')
        ? wrapGroup(group, value)
        : value;
    },
  });
}

/** The whole app at `path` on the fake backend, with reads held (failing or slowed) and services swapped. */
export async function renderWith(
  path: string,
  options: Pick<FakeBackendOptions, 'phase2' | 'phase2b' | 'phase3'> = {},
  holds: Readonly<Record<string, Hold>> = {},
  services: Partial<AppServices> = {},
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
  const router = createAppRouter(createMemoryHistory({ initialEntries: [path] }));
  const client = holding(fake.client, holds);
  await act(async () => {
    render(
      <App
        engine={engine}
        router={router}
        backend={client}
        services={{ ...createTestServices(), ...services }}
      />,
    );
    await router.load();
  });
  return { router, controls: fake.controls };
}
