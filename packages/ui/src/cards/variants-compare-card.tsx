// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: variants compare card (P3-V3, U1) · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.3 · a step panel, unboxed on the canvas: the step's head ("Your variants", Step 3 of 4, its
 *   status), "Making variant 2 of 3" while the run works, then VariantsCompareView over the original and its
 *   variants; Open goes to the editor at that video, Render and Render all send one render.exportBatch (presets
 *   and captions from the project's export settings), Compare side by side opens the editor's compare view
 * states: making (bones for the rest, Render all off) · ready · rendering · short · a variant deleted · changed by
 *   you (the tile's teal mark; the step's when the step says so) · error/success: the view's lines
 * pre-emit critique: P4 H5 E4 S5 R5 V4 */
import { useLingui } from '@lingui/react/macro';
import type { CardOf, Result } from '@taalcut/core';
import { newBatchId } from '../variants/batch-id';
import type { CompareVariant } from '../variants/variant-tile';
import { shortLine, variantLabel } from '../variants/variant-words';
import { VariantsCompareView } from '../variants/variants-compare-view';
import { useCardActions } from './card-actions';
import { StepHeader } from './step-header';

export function VariantsCompareCard({ card }: { card: CardOf<'variantsCompare'> }) {
  const { t, i18n } = useLingui();
  const actions = useCardActions();
  const variants: CompareVariant[] = [
    {
      timelineId: card.baseTimelineId,
      revision: card.baseRevision,
      label: variantLabel(i18n, null),
      difference: null,
    },
    ...card.variants.map((variant) => ({
      timelineId: variant.timelineId,
      revision: variant.revision,
      label: variantLabel(i18n, variant.index),
      difference: variant,
    })),
  ];
  const making = card.status === 'making' ? Math.max(0, card.asked - card.variants.length) : 0;
  const title = t`Your variants`;
  const next = i18n.number(card.variants.length + 1);
  const asked = i18n.number(card.asked);

  // Unset presets and captions come from the project's export settings (render's batch command).
  const exportBatch = (chosen: readonly CompareVariant[]): Promise<Result<unknown> | undefined> =>
    actions.dispatch?.('render.exportBatch', {
      batchId: newBatchId(),
      items: chosen.map((variant) => ({ projectId: card.projectId, timelineId: variant.timelineId })),
      mode: 'export',
      notify: false,
    }) ?? Promise.resolve(undefined);

  return (
    <article
      data-slot="smart-card"
      data-card-type="variantsCompare"
      data-status={card.status}
      aria-label={title}
      className="flex max-w-[52rem] flex-col gap-3"
    >
      <StepHeader title={title} step={card.step} />
      {making > 0 ? (
        <p className="m-0 text-sm text-ink-2 tabular-nums">{t`Making variant ${next} of ${asked}…`}</p>
      ) : null}
      <VariantsCompareView
        projectId={card.projectId}
        variants={variants}
        making={making}
        short={card.short ? shortLine(i18n, card.short) : null}
        {...(actions.navigate
          ? {
              onOpen: (variant: CompareVariant) =>
                actions.navigate?.({
                  to: 'timeline',
                  projectId: card.projectId,
                  timelineId: variant.timelineId,
                }),
              onCompare: () =>
                actions.navigate?.({
                  to: 'timeline',
                  projectId: card.projectId,
                  timelineId: card.baseTimelineId,
                  compare: card.castId,
                }),
            }
          : {})}
        {...(actions.dispatch
          ? {
              onRender: (variant: CompareVariant) => exportBatch([variant]),
              onRenderAll: () => exportBatch(variants),
            }
          : {})}
      />
    </article>
  );
}
