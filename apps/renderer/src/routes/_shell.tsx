// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createFileRoute, Outlet, type ErrorComponentProps } from '@tanstack/react-router';
import { ShellFrame } from '../shell/app-shell';
import { PageError } from '../shell-states/page-error';

/** The app shell (shell/app-shell.tsx): the sidebar, and each page of the four areas beside it. */
export const Route = createFileRoute('/_shell')({
  component: AppShell,
  // A page that fails shows the router's default error view in the shell's own place (router.ts). This is for
  // the shell route itself: the message still sits beside the sidebar. If the sidebar is what failed, drawing
  // it again fails too, and the root's message takes over.
  errorComponent: ShellError,
});

function AppShell() {
  return (
    <ShellFrame>
      <Outlet />
    </ShellFrame>
  );
}

function ShellError(props: ErrorComponentProps) {
  return (
    <ShellFrame>
      <PageError {...props} />
    </ShellFrame>
  );
}
