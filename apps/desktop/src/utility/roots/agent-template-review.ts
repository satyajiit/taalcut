// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * BRK1-CMD in the agent process: `templates.proposeEdits` ("Tell Taalcut") for the router (agent-templates.ts).
 *
 * The model call goes through this process's ModelClient, resolved at call time (the model stack starts after the
 * router): the `vision` module's chain from the active profile, because the call carries the template's contact
 * sheet; Local only drops the cloud models first; the call log records every attempt, with the project (so its
 * budget counts the spend) and a span id of its own. A project whose cap is spent makes no call.
 *
 * Consent: the frames are the template's contact sheet, a reference reel's frames, which since FIX-CONSENT go to the
 * model without a consent card (making a template sends them). Nothing else of the person's goes: no clip, no
 * library file, only the words they typed. So no standing consent is looked up here, unlike BackgroundModels, which
 * may carry anyone's media.
 */
import { readFile } from 'node:fs/promises';
import {
  err,
  newId,
  NotImplementedError,
  ok,
  ProjectBudgetStoreToken,
  TemplateStoreToken,
  type Container,
  type ProjectBudgetStore,
  type ProjectId,
  type TemplatesService,
} from '@taalcut/core';
import { createProposeEdits, type ProposalModel } from '@taalcut/templates';
import { ModelClientToken } from '../../shared/tokens';

const log = (line: string) => console.warn(`[templates] ${line}`);

/** One review call over the process's ModelClient. Model output is untrusted; templates reads it as data. */
export function modelClientProposals(container: Container): ProposalModel {
  return {
    async complete(request, signal) {
      if (!container.has(ModelClientToken))
        return err(NotImplementedError({ feature: 'templates.proposeEdits' }, { detail: 'No model client' }));
      const result = await container.resolve(ModelClientToken).complete({
        module: 'vision',
        system: request.system,
        messages: [{ role: 'user', content: [...request.content] }],
        maxTokens: request.maxTokens,
        temperature: 0,
        reasoning: 'off',
        trace: { spanId: newId<'Span'>(), ...(request.projectId ? { projectId: request.projectId } : {}) },
        ...(signal ? { signal } : {}),
      });
      if (!result.ok) {
        log(`proposeEdits: the model call failed (${result.error.code})`);
        return result;
      }
      const { text, provider, model, local } = result.value;
      return ok({ text, provider, model, local });
    },
  };
}

/** Whether the project has spent its cap (none set: never). */
export function budgetReached(budgets: ProjectBudgetStore) {
  return async (projectId: ProjectId) => {
    const budget = await budgets.get(projectId);
    if (!budget.ok) return budget;
    const { cap, spent } = budget.value;
    return ok(cap !== null && spent.currency === cap.currency && spent.micros >= cap.micros);
  };
}

/** The router's `templates.proposeEdits`, where the template store is (reads go through `templates`, migrated). */
export function proposeEditsService(
  container: Container,
  templates: Pick<TemplatesService, 'get'>,
): Pick<TemplatesService, 'proposeEdits'> {
  const store = container.resolve(TemplateStoreToken);
  const proposeEdits = createProposeEdits({
    templates,
    model: modelClientProposals(container),
    sheet: async (sha256) => {
      const path = await store.assetPath(sha256);
      return path.ok ? new Uint8Array(await readFile(path.value)) : undefined;
    },
    ...(container.has(ProjectBudgetStoreToken)
      ? { budgetReached: budgetReached(container.resolve(ProjectBudgetStoreToken)) }
      : {}),
  });
  return { proposeEdits };
}
