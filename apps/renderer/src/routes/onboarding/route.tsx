// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { useLingui } from '@lingui/react/macro';
import { createFileRoute, Outlet } from '@tanstack/react-router';
import { ToolbarTitle } from '../../shell/toolbar';

export const Route = createFileRoute('/onboarding')({
  component: OnboardingLayout,
});

/**
 * First run: a brand moment, full window, without the app's sidebar. Each step's heading is its own; the window bar
 * just says where you are. Each screen lays itself out in the onboarding frame (onboarding-frame.tsx): the steps'
 * sidebar and the actions stand still, and only the content scrolls.
 */
function OnboardingLayout() {
  const { t } = useLingui();
  return (
    <div className="h-full bg-canvas text-ink">
      <ToolbarTitle as="p" title={t`Set up Taalcut`} />
      {/* All of it is the page's main landmark, the sidebar too: the window bar is its one banner. */}
      <main id="main" className="flex h-full min-h-0 flex-col focus:outline-none">
        <Outlet />
      </main>
    </div>
  );
}
