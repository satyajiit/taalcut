// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The log lines that say which build of each variant group the download picked on this machine, and why the more
 * preferred ones don't run here (ADR 0002: a fallback is logged with its reason), the owner's terms not accepted
 * among them (LNX1-TRM). Pure: the set writes them when a download starts.
 */
import { machineFit, type MachineDescription } from '../machine-fit';
import type { ComponentEntry, ComponentManifest, HardwareTier } from '../manifest';
import { findComponent, selectArtifact } from '../selection';
import { termsReason, type TermsHold } from '../terms';

/** The terms that hold a component back (terms.ts termsHolds), or none. */
export type TermsRule = (id: string) => TermsHold | undefined;

/** What decides the set: the hardware tier, and whether a component it lists runs here at all. */
export interface MachineFit {
  readonly tier: HardwareTier;
  /**
   * This machine, which each component's `requires` is checked against (machineFit): a CUDA build needs an NVIDIA
   * GPU with a new enough driver. Absent: a component that requires anything doesn't fit.
   */
  readonly machine?: MachineDescription;
  /** A further rule by id, one the manifest can't state yet. Default: none. */
  readonly runsHere?: (id: string) => boolean;
}

/**
 * Why `component` isn't fetched here (no build, the caller's rule, its `requires`, then its owner's terms or a
 * dependency's not accepted), or undefined when it is.
 */
export function misfit(
  component: ComponentEntry,
  platform: string,
  fit: MachineFit,
  terms?: TermsRule,
): string | undefined {
  if (!selectArtifact(component, platform)) return `no build for ${platform}`;
  if (fit.runsHere && !fit.runsHere(component.id)) return 'not on this machine';
  const fits = machineFit(component, fit.machine);
  if (!fits.fits) return fits.reason;
  const hold = terms?.(component.id);
  return hold ? termsReason(hold) : undefined;
}

/** One line per variant group the tier lists: `[components] <base>: <chosen> (<skipped>: <reason>; …)`. */
export function describeChoices(
  manifest: ComponentManifest,
  tier: HardwareTier,
  platform: string,
  fit: MachineFit,
  terms?: TermsRule,
): string[] {
  return manifest.components
    .filter((base) => base.tiers.includes(tier) && (base.variants?.length ?? 0) > 0)
    .map((base) => {
      const group = [...(base.variants ?? []).flatMap((id) => findComponent(manifest, id) ?? []), base];
      const skipped: string[] = [];
      for (const member of group) {
        const reason = misfit(member, platform, fit, terms);
        if (reason === undefined) {
          const why = skipped.length > 0 ? ` (${skipped.join('; ')})` : '';
          return `[components] ${base.id}: ${member.id}${why}`;
        }
        skipped.push(`${member.id}: ${reason}`);
      }
      return `[components] ${base.id}: none runs here (${skipped.join('; ')})`;
    });
}
