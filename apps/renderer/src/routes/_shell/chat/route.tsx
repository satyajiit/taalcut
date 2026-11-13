// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createFileRoute, Outlet } from '@tanstack/react-router';

/** The chat area. Your conversations are in the main sidebar (shell/recent-chats.tsx), not a column here. */
export const Route = createFileRoute('/_shell/chat')({
  component: ChatLayout,
});

function ChatLayout() {
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <Outlet />
    </div>
  );
}
