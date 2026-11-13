// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Starter templates as the templates service serves them (P3-B3): `templates.starters` (best fit for the library
 * first) and `template.addStarter`, which forks one into the store under the id the caller made, named by the
 * starter's id with `starter` provenance (the window shows the starter's name in its language); its inverse is
 * `template.discard`. An archived fork under that id comes back; a live one is a conflict. `failing` makes the
 * read fail, for the picker's error state.
 */
import {
  ConflictError,
  defineCommand,
  err,
  NotFoundError,
  ok,
  TEMPLATE_COMMANDS,
  templateCommandPayloads,
  toRpcError,
  type AnyCommand,
  type AppLocale,
  type StarterSummary,
} from '@taalcut/core';
import type { FakeTemplates } from '../templates/fake-templates';
import { STARTER_PLANS, starterLocale, starterTemplatePlan, startersFor } from './starter-data';

export interface FakeStartersOptions {
  /** The read fails (the picker shows its error and Try again). */
  readonly failing?: boolean;
}

export function createFakeStarters(
  templates: FakeTemplates,
  library: () => { clips: number },
  options: FakeStartersOptions = {},
) {
  let forks = 0;
  const addStarter = defineCommand({
    name: TEMPLATE_COMMANDS.addStarter,
    payload: templateCommandPayloads[TEMPLATE_COMMANDS.addStarter],
    sideEffect: 'write',
    project: () => null,
    handle({ starterId, templateId }) {
      const plan = STARTER_PLANS.find((each) => each.id === starterId);
      if (!plan) return err(NotFoundError({ entity: 'starter', id: starterId }));
      const existing = templates.summary(templateId);
      if (existing && !existing.archived) return err(ConflictError({ entity: 'template', id: templateId }));
      if (existing) templates.setMeta(templateId, { archived: false });
      else {
        forks += 1;
        templates.adopt(templateId, starterTemplatePlan(plan, 900 + forks, plan.id), plan.formatId, {
          // The service records the starter's own language, or English for the ones every language has.
          provenance: { kind: 'starter', starterId: plan.id, locale: starterLocale(plan) },
        });
      }
      return ok({
        result: { templateId, version: 1 },
        inverse: { name: TEMPLATE_COMMANDS.discard, payload: { projectId: null, templateId } },
      });
    },
  });
  const discard = defineCommand({
    name: TEMPLATE_COMMANDS.discard,
    payload: templateCommandPayloads[TEMPLATE_COMMANDS.discard],
    sideEffect: 'write',
    internal: true,
    project: () => null,
    handle({ templateId }) {
      templates.discard(templateId);
      return ok({ result: null });
    },
  });
  return {
    commands: (): AnyCommand[] => [addStarter, discard],
    list(input: { readonly locale: AppLocale; readonly forLibrary: boolean }): StarterSummary[] {
      if (options.failing) throw toRpcError(NotFoundError({ entity: 'starters', id: 'bundled' }));
      return startersFor(library(), input);
    },
  };
}

export type FakeStarters = ReturnType<typeof createFakeStarters>;
