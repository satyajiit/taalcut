// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: pending-card · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.2 (A3) · states: placeholder only (static bones, not interactive) */

import type { MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
import type { CardOf } from '@taalcut/core';
import { SkeletonLines } from '../skeleton/skeleton';
import { CardFrame } from './card-frame';
import { CostEstimateCard } from './cost-estimate-card';
import { CostEstimateV2Card } from './cost-estimate-v2-card';

/** Phase 2's card types (each now has its component; their titles stay for the stand-in). */
export type Phase2CardType =
  | 'openingChoices'
  | 'step'
  | 'budgetCap'
  | 'sourcePicker'
  | 'importProgress'
  | 'breakdown'
  | 'castBoard'
  | 'timeline'
  | 'renderProgress'
  | 'qaReport'
  | 'exportApproval'
  | 'costEstimate';

/** Phase 3's card types (contract round P3-1): the UI lanes replace each one's stand-in with its card. */
export type Phase3CardType =
  | 'rateLimit'
  | 'variantsCompare'
  | 'gapFix'
  | 'hubResults'
  | 'cleanupPlan'
  | 'styleBatch'
  | 'voiceover'
  | 'voiceConsent'
  | 'motionGraphic'
  | 'renderBatch'
  | 'imageTakes';

/** Card types a PendingCard can stand in for. */
export type PendingCardType = Phase2CardType | Phase3CardType;

const TITLES: Readonly<Record<PendingCardType, MessageDescriptor>> = {
  openingChoices: msg`How do you want to start?`,
  step: msg`A step of your video`,
  budgetCap: msg`Project budget`,
  sourcePicker: msg`Where your footage is`,
  importProgress: msg`Bringing in your footage`,
  breakdown: msg`Reading the reference`,
  castBoard: msg`Picking your clips`,
  timeline: msg`Your timeline`,
  renderProgress: msg`Exporting`,
  qaReport: msg`Quality check`,
  exportApproval: msg`Ready to export`,
  costEstimate: msg`What this step costs`,
  rateLimit: msg`A model reached its limit`,
  variantsCompare: msg`Your versions side by side`,
  gapFix: msg`Filling the gaps`,
  hubResults: msg`Templates from the hub`,
  cleanupPlan: msg`Tidying up the talking`,
  styleBatch: msg`A look for several videos`,
  voiceover: msg`Voiceover`,
  voiceConsent: msg`Your own voice`,
  motionGraphic: msg`Motion graphic`,
  renderBatch: msg`Exporting several videos`,
  imageTakes: msg`Generated images`,
};

/** The ones that ask you to decide get the card frame (DESIGN.md v0.2, A3); the rest are rows. */
const DECISIONS: ReadonlySet<PendingCardType> = new Set([
  'openingChoices',
  'budgetCap',
  'sourcePicker',
  'exportApproval',
  'costEstimate',
  'rateLimit',
  'gapFix',
  'voiceConsent',
  'imageTakes',
]);

/**
 * A neutral stand-in for a card whose component hasn't landed: its title and
 * a few still bones. The UI lane replaces each type's entry in
 * CARD_COMPONENTS with the real card.
 */
export function PendingCard({ card }: { card: CardOf<PendingCardType> }) {
  const { i18n } = useLingui();
  const title = i18n._(TITLES[card.type]);
  const bones = <SkeletonLines lines={2} />;
  if (DECISIONS.has(card.type)) {
    return (
      <CardFrame cardType={card.type} data-pending="" title={title}>
        {bones}
      </CardFrame>
    );
  }
  return (
    <article
      data-slot="smart-card"
      data-card-type={card.type}
      data-pending=""
      aria-label={title}
      className="flex max-w-[42rem] flex-col gap-2"
    >
      <p className="m-0 text-sm font-medium text-ink">{title}</p>
      {bones}
    </article>
  );
}

/** Version 1 is the run budget's card; version 2, a flow step's estimate (P2-X1). */
export function CostEstimateCardView({ card }: { card: CardOf<'costEstimate'> }) {
  return card.version === 1 ? <CostEstimateCard card={card} /> : <CostEstimateV2Card card={card} />;
}
