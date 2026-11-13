// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { Trans, useLingui } from '@lingui/react/macro';
import type { Card, CardOf, CardType, RunId } from '@taalcut/core';
import { PackageOpen } from 'lucide-react';
import type { ComponentType } from 'react';
import { ApprovalCard } from './approval-card';
import { BreakdownCard } from './breakdown-card';
import { BudgetCapCard } from './budget-cap-card';
import { CastBoardCard } from './cast-board-card';
import { useCardActions } from './card-actions';
import { VariantsCompareCard } from './variants-compare-card';
import { RenderBatchCard } from './render-batch-card';
import { GapFixCard } from './gap-fix-card';
import { HubResultsCard } from './hub-results-card';
import { CleanupPlanCard } from './cleanup-plan-card';
import { StyleBatchCard } from './style-batch-card';
import { VoiceoverCard } from './voiceover-card';
import { VoiceConsentCard } from './voice-consent-card';
import { DesignGraphicCard } from './design-graphic-card';
import { ImageTakesCard } from './image-takes-card';
import { ConsentCard } from './consent-card';
import { ErrorLine } from './error-line';
import { ExportApprovalCard } from './export-approval-card';
import { ImportProgressCard } from './import-progress-card';
import { OpeningChoicesCard } from './opening-choices-card';
import { CostEstimateCardView } from './pending-card';
import { PlanCard } from './plan-card';
import { ProgressCard } from './progress-card';
import { QaReportCard } from './qa-report-card';
import { RateLimitCardView } from './rate-limit-card';
import { RenderProgressCard } from './render-progress-card';
import { SourcePickerCard } from './source-picker-card';
import { StepCard } from './step-card';
import { TimelineCard } from './timeline-card';
import { ToolRunCard } from './tool-run-card';
import { MemoryProposalCard } from '../memory/memory-proposal-card';
import { StyleProfileChatCard } from '../profiles/style-profile-chat-card';
import { EditChangesCard } from './edit-changes-card';
import { PublishPackCard } from './publish-pack-card';
import { SoundResultsCard } from './sound-results-card';

const RUN_ERROR_PREFIX = 'run-error:';

/**
 * The agent's error in the chat: one line with the cause and its one fix,
 * dispatched through CardActions (DESIGN.md v0.2, A3: not a card). A fix that
 * works says so in place; one that fails shows its own cause and fix.
 */
export function ErrorCardView({ card }: { card: CardOf<'error'> }) {
  const { t } = useLingui();
  const { runFix, developerMode, report, followUp, busy } = useCardActions();
  const canContinue =
    (card.error.code === 'agent.turn_limit' || card.error.code === 'models.provider_unavailable') &&
    Boolean(followUp) &&
    !busy;
  const runId = (
    card.id.startsWith(RUN_ERROR_PREFIX) ? card.id.slice(RUN_ERROR_PREFIX.length) : card.id
  ) as RunId;
  return (
    <div data-slot="smart-card" data-card-type="error" className="max-w-[65ch]">
      <ErrorLine
        key={card.version}
        error={canContinue ? { ...card.error, retryable: true } : card.error}
        onFix={runFix}
        onRetry={
          canContinue && followUp
            ? () => void followUp(runId, t`Continue from where you stopped.`, [])
            : undefined
        }
        onReport={report}
        showDetail={developerMode}
      />
    </div>
  );
}

export type CardComponent<T extends CardType> = ComponentType<{ card: CardOf<T> }>;

/**
 * One component per card type (P1-H4). The type is a mapped type over core's
 * CardType, so adding a card schema in core fails the build until it has a
 * component here: one place on each side.
 */
export const CARD_COMPONENTS: { readonly [T in CardType]: CardComponent<T> } = {
  plan: PlanCard,
  approval: ApprovalCard,
  consent: ConsentCard,
  costEstimate: CostEstimateCardView,
  error: ErrorCardView,
  progress: ProgressCard,
  toolRun: ToolRunCard,
  // Phase 2: the flow's cards (UI round 2b) and the Make cards (UI round 2a).
  openingChoices: OpeningChoicesCard,
  step: StepCard,
  budgetCap: BudgetCapCard,
  sourcePicker: SourcePickerCard,
  importProgress: ImportProgressCard,
  breakdown: BreakdownCard,
  castBoard: CastBoardCard,
  timeline: TimelineCard,
  renderProgress: RenderProgressCard,
  qaReport: QaReportCard,
  exportApproval: ExportApprovalCard,
  // Phase 3: G8's rate limits (ui-onboarding), then the make flow's cards (ui-make).
  rateLimit: RateLimitCardView,
  variantsCompare: VariantsCompareCard,
  gapFix: GapFixCard,
  hubResults: HubResultsCard,
  cleanupPlan: CleanupPlanCard,
  styleBatch: StyleBatchCard,
  voiceover: VoiceoverCard,
  voiceConsent: VoiceConsentCard,
  motionGraphic: DesignGraphicCard,
  renderBatch: RenderBatchCard,
  imageTakes: ImageTakesCard,
  // Learning round 1 (LRN1-MEM).
  memoryProposal: MemoryProposalCard,
  // Learning round 1 (LRN1-STY).
  styleProfile: StyleProfileChatCard,
  // Editor round 1 (EDT1-CTX).
  editChanges: EditChangesCard,
  // Thumbnail & social publishing pack.
  publishPack: PublishPackCard,
  // Earshot round 1 (EAR1-K2).
  soundResults: SoundResultsCard,
};

/** Renders a parsed card with its component. */
export function CardView({ card }: { card: Card }) {
  const Component = CARD_COMPONENTS[card.type] as CardComponent<typeof card.type>;
  return <Component card={card} />;
}

/**
 * Shown for a card this version can't read (core.card_unsupported, or a
 * payload that failed validation): one plain line instead of breaking the
 * chat. Not a card (DESIGN.md v0.2, A3: only decisions are cards).
 */
export function UnsupportedCard() {
  return (
    <p
      data-slot="smart-card"
      data-card-type="unsupported"
      className="m-0 flex max-w-[65ch] items-start gap-2 text-sm text-ink-2"
    >
      <PackageOpen aria-hidden className="mt-0.5 size-4 shrink-0 text-ink-3" />
      <Trans>
        Part of this chat needs a newer version of Taalcut to show. Everything else in the chat still works.
      </Trans>
    </p>
  );
}
