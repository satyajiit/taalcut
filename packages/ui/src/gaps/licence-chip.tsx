// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: licence chip (P3-V18 in P3-B8) · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.3 · a stock result's licence in words, a soft-wash chip: neutral when nothing is owed,
 *   info when the licence asks for a credit ("CC BY: credit needed"); a bundled sound's too (EAR1, D22: "Code-made"
 *   for an SFX-bank sound, MIT, rendered from code, a fitted one included; "CC0" for a CC0 pack's)
 * states: not interactive (no hover or focus) · default only
 * pre-emit critique: P5 H5 E5 S5 R5 V4 */
import { useLingui } from '@lingui/react/macro';
import { Chip } from '#components/badge';
import { LICENCE_LABELS, type ChipLicence } from './gap-words';

export function LicenceChip({ licence, className }: { licence: ChipLicence; className?: string }) {
  const { i18n } = useLingui();
  return (
    <Chip
      data-slot="licence-chip"
      data-licence={licence}
      tone={licence === 'CC-BY-4.0' ? 'info' : 'neutral'}
      {...(className ? { className } : {})}
    >
      {i18n._(LICENCE_LABELS[licence])}
    </Chip>
  );
}
