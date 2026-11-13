// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { callRpc } from '@taalcut/core';
import { createThemeEngine, localStorageStore, type HostPlatform } from '@taalcut/ui';
import { createMemoryHistory } from '@tanstack/react-router';
import { act, render } from '@testing-library/react';
import { App } from '../src/app';
import { themeTarget } from '../src/backend/fake/expose';
import { createFakeBackend, type FakeBackendOptions } from '../src/backend/fake/fake-backend';
import { createTestServices } from '../src/services/create';
import type { CommandDispatcher } from '../src/services/provider';
import { activateLocale } from '../src/i18n/i18n';
import type { Locale } from '../src/i18n/locales';
import { createAppRouter } from '../src/router';

/** The whole app at `path`, on the fake backend, with the deprecation watcher's date fixed, wired as Electron is (a chat's fixes on the backend's bus). `phase2`: an empty library or none of the templates; `phase2b`: privacy, onboarding and the build's channel; `make`: no projects; `phase3`: language, updates, MCP, limits and the phone on a cable; `usageHistory` and `usageMode`: Settings › Usage's month and its states. `locale`: the language it opens in; `platform`: the OS it runs on (LNX1). */
export async function renderApp(
  path: string,
  options: Pick<
    FakeBackendOptions,
    'phase2' | 'phase2b' | 'make' | 'phase3' | 'usageHistory' | 'usageMode' | 'plugins' | 'interfaceSounds'
  > = {},
  locale: Locale = 'en',
  platform: HostPlatform = 'mac',
) {
  await activateLocale(locale, platform);
  const engine = createThemeEngine({ store: localStorageStore() });
  await engine.init();
  const fake = createFakeBackend({
    theme: themeTarget(engine),
    today: () => '2026-10-12',
    signInDelayMs: 0,
    ...options,
  });
  const router = createAppRouter(createMemoryHistory({ initialEntries: [path] }));
  const services = {
    ...createTestServices({ latencyMs: 0, speed: 0 }, platform),
    // As in Electron (services/main.ts): a chat card's fix is a command on the bus the backend's commands use.
    commands: {
      dispatch: (input: Parameters<CommandDispatcher['dispatch']>[0]) =>
        callRpc(fake.client.commands.dispatch({ ...input, payload: input.payload })),
    },
  };
  await act(async () => {
    render(<App engine={engine} router={router} backend={fake.client} services={services} />);
    await router.load();
  });
  return { router, engine, controls: fake.controls, client: fake.client, chat: services.chat };
}
