// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { useNavigate } from '@tanstack/react-router';
import { useBackendEvents } from '../../backend/use-events';

/** Core's UI command for the projects list (UI round 2a), which the agent and MCP can still send. */
export const PROJECTS_ACTION = 'go.projects';

/**
 * The projects list is the Make area's page, and ⌘K lists it once, as Make
 * (go.make). The agent's or an MCP client's go.projects still arrives as a
 * `ui.action`, with no palette item of that id to run, so the shell takes it
 * there itself.
 */
export function useProjectsAction(): void {
  const navigate = useNavigate();
  useBackendEvents(['ui.action'], ({ payload }) => {
    if (payload.action === PROJECTS_ACTION) void navigate({ to: '/projects' });
  });
}
