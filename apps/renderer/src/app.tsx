// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { I18nProvider } from '@lingui/react';
import {
  HostPlatformProvider,
  MotionProvider,
  ThemeProvider,
  TooltipProvider,
  type ThemeEngine,
} from '@taalcut/ui';
import { RouterProvider } from '@tanstack/react-router';
import { BackendProvider, type Backend } from './backend/backend';
import { ServicesProvider, type AppServices } from './services/provider';
import { i18n } from './i18n/i18n';
import { LocaleSync } from './i18n/use-locale';
import { FirstExportWatch } from './onboarding/first-export';
import { SoundsProvider } from './features/sounds/sounds-provider';
import type { AppRouter } from './router';

/** Providers around the router. main.tsx builds the pieces; tests build their own. */
export function App({
  engine,
  router,
  backend,
  services,
}: {
  engine: ThemeEngine;
  router: AppRouter;
  backend: Backend;
  services: AppServices;
}) {
  return (
    <I18nProvider i18n={i18n}>
      <ThemeProvider engine={engine}>
        <BackendProvider backend={backend}>
          <ServicesProvider services={services}>
            <HostPlatformProvider platform={services.platform}>
              <SoundsProvider>
                <LocaleSync />
                <FirstExportWatch />
                <TooltipProvider>
                  <MotionProvider>
                    <RouterProvider router={router} />
                  </MotionProvider>
                </TooltipProvider>
              </SoundsProvider>
            </HostPlatformProvider>
          </ServicesProvider>
        </BackendProvider>
      </ThemeProvider>
    </I18nProvider>
  );
}
