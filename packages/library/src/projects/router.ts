// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** `appContract.projects` (owner agent): the projects list, one project, and a timeline's saved versions. */
import { implementContract, projectsContract, unwrapRpc } from '@taalcut/core';
import type { ProjectsService } from './service';

const page = (input: { readonly limit: number; readonly cursor?: string | undefined }) => ({
  limit: input.limit,
  ...(input.cursor !== undefined ? { cursor: input.cursor } : {}),
});

export function projectsRouter(service: ProjectsService) {
  const os = implementContract(projectsContract);
  return os.router({
    list: os.list.handler(async ({ input }) =>
      unwrapRpc(await service.list({ archived: input.archived, ...page(input) })),
    ),
    get: os.get.handler(async ({ input }) => unwrapRpc(await service.get(input.projectId))),
    versions: os.versions.handler(async ({ input }) =>
      unwrapRpc(await service.versions({ timelineId: input.timelineId, ...page(input) })),
    ),
  });
}
