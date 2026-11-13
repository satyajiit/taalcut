// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * HFW1-UI in the agent process: the `workspace` namespace the editor's files viewer reads (core's
 * appContract.workspace), over the library's workspace store (WorkspaceStoreToken). The store is looked up on each
 * call, so the namespace answers core.not_implemented until the library registers it, and works from then on.
 */
import {
  err,
  NotImplementedError,
  workspaceFilesOver,
  workspaceRouter,
  WorkspaceStoreToken,
  type Container,
  type WorkspaceFilesService,
} from '@taalcut/core';

/** appContract.workspace: list a project's workspace revisions, read a file's text. */
export function agentWorkspaceRouter(container: Container) {
  const files = (): WorkspaceFilesService | null =>
    container.has(WorkspaceStoreToken) ? workspaceFilesOver(container.resolve(WorkspaceStoreToken)) : null;
  const missing = () => Promise.resolve(err(NotImplementedError({ feature: 'workspace' })));
  return workspaceRouter({
    list: (input) => files()?.list(input) ?? missing(),
    read: (input) => files()?.read(input) ?? missing(),
  });
}
