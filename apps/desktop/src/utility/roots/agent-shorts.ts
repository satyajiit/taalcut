// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  defineToolModule,
  err,
  ok,
  ProjectBudgetStoreToken,
  ValidationError,
  type Container,
  type ShortsRequest,
  type ToolModule,
} from '@taalcut/core';
import { createShortsCache, createShortsRunStore } from '@taalcut/library';
import { createShortsCoordinator, createShortsService, shortsToolModule } from '@taalcut/shorts';
import { LibraryDatabaseToken, ModelProfilesToken } from '../../shared/tokens';
import { approvedToolModels } from './agent-tool-models';
import { LocalOnlyFlagToken } from './agent-local-only-flag';
import { shortComposer } from './shorts-compose';
import { createShortPublishPack } from './shorts-publish-pack';
import { shortsSource } from './shorts-source';
import { shortsImportToolModule } from './shorts-import';
import { shortsProjectTool } from './shorts-project';
import { resolveShortRequest } from './shorts-request';

export function shortsAgentToolModule(container: Container): ToolModule {
  const db = container.resolve(LibraryDatabaseToken);
  const runs = createShortsRunStore(db);
  const coordinator = createShortsCoordinator();
  const placement = () =>
    container.has(LocalOnlyFlagToken) && container.resolve(LocalOnlyFlagToken).get()
      ? ('local' as const)
      : ('cloud' as const);
  const beforeModel = async (request: ShortsRequest) => {
    if (placement() === 'local' || !container.has(ProjectBudgetStoreToken)) return ok(undefined);
    const budget = await container.resolve(ProjectBudgetStoreToken).get(request.projectId);
    if (!budget.ok) return budget;
    return budget.value.cap && budget.value.spent.micros >= budget.value.cap.micros
      ? err(
          ValidationError(
            { field: 'shorts.budget' },
            { detail: 'The project model budget has been reached' },
          ),
        )
      : ok(undefined);
  };
  const editorial = shortsToolModule({
    placement: placement(),
    get: (id) => runs.get(id),
    resultCard: async (run, context) => {
      if (run.status !== 'ready') return ok(undefined);
      const pack = await createShortPublishPack(container, run);
      return pack.ok ? ok({ ...pack.value, runId: context.runId }) : pack;
    },
    service: (ctx) => {
      const service = createShortsService({
        source: shortsSource(container),
        models: approvedToolModels(container, ctx),
        cache: createShortsCache(db),
        runs,
        coordinator,
        placement,
        beforeModel,
        modelKey: () =>
          JSON.stringify(
            ['agent', 'vision'].map((module) =>
              container.resolve(ModelProfilesToken).effective(module as 'agent' | 'vision'),
            ),
          ),
        compose: shortComposer(container, ctx),
      });
      return {
        ...service,
        async generate(request, options = {}) {
          const resolved = await resolveShortRequest(container, request);
          if (!resolved.ok) return resolved;
          return service.generate(resolved.value, {
            ...options,
            progress: (run) => {
              options.progress?.(run);
              const stages: Record<string, number> = {
                evidence: 0.05,
                selecting: 0.15,
                verifying: 0.4,
                composing: 0.55,
                complete: 1,
              };
              ctx.reportProgress(stages[run.stage] ?? 0);
            },
          });
        },
      };
    },
  });
  const intake = shortsImportToolModule(container, { localOnly: placement() === 'local' });
  return defineToolModule({
    id: 'shorts',
    tools: [shortsProjectTool(container), ...intake.tools, ...editorial.tools],
  });
}
