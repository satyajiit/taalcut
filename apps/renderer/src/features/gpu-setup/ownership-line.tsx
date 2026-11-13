// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: a component's ownership line · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.5 · LNX1-TRM: wherever a part under its owner's terms is listed (Settings › Models, About's
 *   installed parts), one small ink-3 line says whose it is, who licenses it to the person, and that Taalcut only
 *   installed it because they asked: "© NVIDIA Corporation · licensed to you by NVIDIA · installed by Taalcut at
 *   your request". The owner's names are the manifest's, kept out of translation.
 * states: installed (the whole line) · not installed (the first two) · n/a hover, focus (not a control)
 * pre-emit critique: P4 H4 E4 S5 R5 V4 · slop subset: pass (1-7, 10-19, 22-27, 37-38a, 40-41, 46-49)
 */
import { Trans } from '@lingui/react/macro';
import { cn } from '@taalcut/ui';
import { ownerBrand, type TermsComponent } from './nvidia-terms';

export function OwnershipLine({ component, className }: { component: TermsComponent; className?: string }) {
  const owner = <span translate="no">{component.terms.owner}</span>;
  const brand = <span translate="no">{ownerBrand(component.terms.owner)}</span>;
  const installed = component.status === 'installed' || component.status === 'update-available';
  return (
    <span data-slot="ownership" className={cn('text-xs text-ink-3', className)}>
      {installed ? (
        <Trans>
          © {owner} · licensed to you by {brand} · installed by Taalcut at your request
        </Trans>
      ) : (
        <Trans>
          © {owner} · licensed to you by {brand}
        </Trans>
      )}
    </span>
  );
}
