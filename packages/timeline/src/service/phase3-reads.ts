// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The Phase 3 reads the timelines service serves, each only when what it needs is wired: the gap and shot lists
 * (P3-B8), the registered pro export writers (P3-V5), the cleanup preview (P3-V9) and the energy curve plan
 * (P3-V12). An absent one is left off, and the router answers core.not_implemented for it.
 */
import { ok, type AsyncResult, type Timeline, type TimelineId, type TimelinesService } from '@taalcut/core';
import type { CastingEngine } from '../casting/engine';
import { createCleanupReads, type CleanupReadDeps } from '../cleanup/cleanup-reads';
import type { EnergyCurveApplier } from '../energy/energy-deps';
import { createEnergyReads } from '../energy/plan-energy';
import { createGapReads } from '../gaps/gap-reads';
import type { ExporterRegistry } from '../interchange/registry';
import type { TemplateReader } from './templates';

export interface Phase3ReadDeps {
  readonly read: (timelineId: TimelineId) => AsyncResult<Timeline>;
  readonly engine?: CastingEngine;
  readonly templates?: TemplateReader;
  readonly exporters?: ExporterRegistry;
  readonly cleanup?: Omit<CleanupReadDeps, 'read'>;
  readonly applyEnergyCurve?: EnergyCurveApplier;
}

type Phase3Reads = Pick<
  TimelinesService,
  'gaps' | 'shotList' | 'interchangeFormats' | 'planCleanup' | 'planEnergyCurve'
>;

function energyReads({ read, applyEnergyCurve, templates, engine }: Phase3ReadDeps) {
  if (!applyEnergyCurve || !templates || !engine) return null;
  return createEnergyReads({ read, energy: { applyCurve: applyEnergyCurve, reader: templates }, engine });
}

export function phase3Reads(deps: Phase3ReadDeps): Phase3Reads {
  const gapReads = createGapReads({
    read: deps.read,
    ...(deps.templates ? { templates: deps.templates } : {}),
  });
  const exporters = deps.exporters;
  const cleanup = deps.cleanup ? createCleanupReads({ read: deps.read, ...deps.cleanup }) : null;
  const energy = energyReads(deps);
  return {
    gaps: gapReads.gaps,
    shotList: gapReads.shotList,
    ...(exporters ? { interchangeFormats: async () => ok(exporters.list()) } : {}),
    ...(cleanup ? { planCleanup: cleanup.planCleanup } : {}),
    ...(energy ? { planEnergyCurve: energy.planEnergyCurve } : {}),
  };
}
