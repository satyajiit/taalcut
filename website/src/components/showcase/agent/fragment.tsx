// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: the agent's index fragment · mode: Operate · system: WEB2 Remix Vernacular
 * a small working piece of the agent showcase for /features/: your message with the reel, the run's four steps, and
 *   your cut under the reel's slots with the checks against it; Play the run plays it again
 * states: the chat's own (agent-showcase.tsx: finished in the server HTML, running once asked) · reduced motion: the
 *   finished run at once
 * motion: the run's (check-strip.tsx); reduced motion: none */

import { AppWindow } from '#components/ui/app-window';
import { AgentChat } from './agent-showcase';
import { useAgentRun } from './use-agent-run';

export function AgentFragment() {
  const run = useAgentRun(false);
  return (
    <AppWindow title="Agent" area="agent" size="sm" fit="fluid">
      <AgentChat run={run} compact />
    </AppWindow>
  );
}
