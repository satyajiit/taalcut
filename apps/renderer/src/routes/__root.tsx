// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { GlobalLoader, KaatuPresenceProvider, Toaster, useTrackedLoading } from '@taalcut/ui';
import { createRootRoute, Outlet, useRouterState } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { PhoneFlowProvider } from '../features/library/phone/session/phone-flow';
import { FeedbackDialog } from '../features/feedback/feedback-dialog';
import { useCompanionEvents } from '../features/kaatu/companion-events';
import { useShowKaatu } from '../features/kaatu/kaatu-preference';
import { PaletteMount } from '../features/palette/palette-mount';
import { UpdateHost } from '../features/updates/update-host';
import { RecoveryPrompt } from '../recovery/recovery-prompt';
import { AppWindowBar } from '../shell/app-window-bar';
import { PageArrival } from '../shell/nav/page-arrival';
import { NotFound } from '../shell/not-found';
import { RouteError } from '../shell/route-error';
import { ToolbarSlotsProvider } from '../shell/toolbar';

export const Route = createRootRoute({
  component: Root,
  notFoundComponent: NotFound,
  errorComponent: RouteError,
});

/**
 * Every page, under the window bar (our title bar and toolbar: traffic
 * controls, the mark, the page's title and actions), with the global loader
 * along the top edge and the toasts under the bar (PRD R32), the
 * crash-recovery prompt when the last session ended badly (P1-D5), and ⌘K
 * (inside the router, so its commands can navigate), and Send feedback (P2-X7). Kaatu shows or hides everywhere
 * by the Show Kaatu preference, and the companion watches the app's work from here (UX4).
 */
function Root() {
  const navigating = useRouterState({ select: (state) => state.status === 'pending' });
  const working = useTrackedLoading();
  const [title, setTitle] = useState<HTMLElement | null>(null);
  const [actions, setActions] = useState<HTMLElement | null>(null);
  const slots = useMemo(() => ({ title, actions }), [title, actions]);
  const [kaatu] = useShowKaatu();
  useCompanionEvents();
  return (
    <KaatuPresenceProvider value={kaatu}>
      <ToolbarSlotsProvider value={slots}>
        <div className="flex h-full flex-col">
          <AppWindowBar titleSlot={setTitle} actionsSlot={setActions} />
          <div className="relative min-h-0 flex-1">
            <PhoneFlowProvider>
              <Outlet />
            </PhoneFlowProvider>
          </div>
        </div>
        <GlobalLoader active={navigating || working} />
        {/* The new page's name, read out as it opens; a page opened anew takes focus on its main area. */}
        <PageArrival />
        <RecoveryPrompt />
        <Toaster />
        <PaletteMount />
        <FeedbackDialog />
        <UpdateHost />
      </ToolbarSlotsProvider>
    </KaatuPresenceProvider>
  );
}
