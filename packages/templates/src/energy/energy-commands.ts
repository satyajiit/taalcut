// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** `template.setEnergyCurve` (P3-V12): one new version, undone by `template.setHead`, redo via the change key. */
import {
  defineCommand,
  newId,
  ok,
  TEMPLATE_COMMANDS,
  templateCommandPayloads,
  type SlotId,
  type TemplateEditResult,
} from '@taalcut/core';
import type { TemplateService } from '../store/template-service';
import { applyEnergyCurve, type EnergyIds } from './energy-curve';
import { ENERGY_CONFIG } from './energy-config';

const N = TEMPLATE_COMMANDS;

export function createEnergyCommands(deps: { readonly service: TemplateService; readonly ids?: EnergyIds }) {
  const ids = deps.ids ?? { slot: (): SlotId => newId() };
  const setEnergyCurve = defineCommand({
    name: N.setEnergyCurve,
    payload: templateCommandPayloads[N.setEnergyCurve],
    sideEffect: 'write',
    handle: async (payload, context) => {
      const { projectId, templateId, baseVersion, curve } = payload;
      const outcome = await deps.service.edit(
        {
          templateId,
          baseVersion,
          command: N.setEnergyCurve,
          payload,
          change: (template) => {
            const applied = applyEnergyCurve(template, curve, ids, ENERGY_CONFIG);
            return applied.ok ? ok(applied.value.template) : applied;
          },
        },
        context,
      );
      if (!outcome.ok) return outcome;
      const result: TemplateEditResult = { templateId, version: outcome.value.version };
      return ok({
        result,
        inverse: {
          name: N.setHead,
          payload: { projectId, templateId, version: baseVersion, expectedHead: result.version },
        },
      });
    },
  });
  return { setEnergyCurve, all: [setEnergyCurve] };
}
