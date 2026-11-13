// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * HFW1-UI: the files viewer's reads (appContract.workspace): a project's revisions and head, read again after every
 * change on the bus (a restore, its ⌘Z, the AI writing files), and one file's text by its sha256 (a file's content
 * never changes under its sha256, so it is read once per file).
 */
import type { ProjectId, WorkspaceFileText, WorkspaceListing } from '@taalcut/core';
import { useBackend } from '../../../backend/backend';
import { useBackendEvents } from '../../../backend/use-events';
import { useRpcQuery, type Reloadable } from '../../../backend/use-rpc';

export function useWorkspaceListing(projectId: ProjectId): Reloadable<WorkspaceListing> {
  const backend = useBackend();
  const listing = useRpcQuery(
    (signal) => backend.workspace.list({ projectId }, { signal }),
    [backend, projectId],
  );
  useBackendEvents(['command.changed'], () => listing.reload());
  return listing;
}

export function useFileText(
  projectId: ProjectId,
  sha256: string | null,
): Reloadable<WorkspaceFileText | null> {
  const backend = useBackend();
  return useRpcQuery(
    (signal) => (sha256 ? backend.workspace.read({ projectId, sha256 }, { signal }) : Promise.resolve(null)),
    [backend, projectId, sha256],
  );
}
