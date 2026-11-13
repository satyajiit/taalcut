// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What the energy curve needs from outside the timeline (P3-V12): the template half (@taalcut/templates'
 * applyEnergyCurve, bound by the composition root to ENERGY_CONFIG) and the template service that versions a
 * template the way `template.setEnergyCurve` does, so redo finds the same version again.
 */
import type { EnergyCurve, EnergySlotMap, Result, SlotId, Template } from '@taalcut/core';
import type { TemplateService } from '@taalcut/templates';
import type { TemplateReader } from '../service/templates';

/**
 * The template re-split by the curve, and per new slot the old slots it came from. `ids` names the new slots
 * (slot-ids.ts: the same for the plan, the command and its redo).
 */
export type EnergyCurveApplier = (
  template: Template,
  curve: EnergyCurve,
  ids: { slot(): SlotId },
) => Result<{ readonly template: Template; readonly slotMap: EnergySlotMap }>;

export interface EnergyDeps {
  readonly applyCurve: EnergyCurveApplier;
  readonly templates: Pick<TemplateService, 'edit'>;
  readonly reader: TemplateReader;
}
