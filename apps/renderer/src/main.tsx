// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// First, in the entry chunk: zod's eval probe must be off before any chunk
// builds a schema (zod reads the setting when a schema is created).
import './csp/zod-jitless';
// Fonts ship inside the app (Fontsource): no font requests to the web.
import './fonts/fonts.css';
import './app.css';
import { connectToMain, themeBridgeOverRpc } from '@taalcut/core';
import { createThemeEngine, defaultThemeStore } from '@taalcut/ui';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app';
import { activateLocale } from './i18n/i18n';
import { initialLocale } from './i18n/use-locale';
import { createAppRouter } from './router';
import { forwardWindowErrors } from './services/window-errors';

async function start(): Promise<void> {
  // The theme is already right on screen (Electron: nativeTheme and the window
  // background; browser: theme-boot.js). init() syncs the engine with it.
  // Electron: the page's one port to main (theme, commands, events…). A plain browser has none.
  const main = await connectToMain(window);
  if (!main.ok) console.error('No connection to the main process', main.error);
  const client = main.ok && main.value ? main.value.client : null;
  // Uncaught errors and rejections go to main, which sends them only when crash reports are on (P2-X5).
  if (client) forwardWindowErrors(window, client.crashes);
  const theme = client ? themeBridgeOverRpc(client.theme) : null;
  const engine = createThemeEngine({ store: defaultThemeStore(theme) });
  // Electron: every service and the backend are core's contracts over that port.
  // A plain browser (the dev server, the renderer's end-to-end tests): in-page
  // fakes, the backend one served over a MessageChannel. Each loads as its own
  // chunk, alongside the theme and the catalogue.
  const [services, backend] = await Promise.all([
    client
      ? import('./services/main').then((module) => module.createMainServices(client))
      : import('./services/create').then((module) => module.createPreviewServices()),
    client ?? import('./backend/fake/expose').then((module) => module.startPreviewBackend(engine)),
    engine.init(),
  ]);
  // The language main resolved (P3-L2), before the first render, as the theme is: nothing flashes English.
  await activateLocale(await initialLocale(backend, client !== null), services.platform);
  const root = document.getElementById('root');
  if (!root) throw new Error('index.html has no #root element');
  createRoot(root).render(
    <StrictMode>
      <App engine={engine} router={createAppRouter()} backend={backend} services={services} />
    </StrictMode>,
  );
}

void start();
