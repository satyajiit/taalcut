// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: compare view (P3-V3) · genre: atmospheric studio app (chrome modern-minimal + the viewer)
 * system: DESIGN.md v0.3 · the editor's body for `?compare=<castId>`: Back to the editor, "Compare side by side"
 *   and how many videos, then the kit's VariantsCompareView at page size over the cast's videos (Original first),
 *   with the app's drivable players so Play the hooks and Play all run from one clock; Open goes to the editor at
 *   that video, Render and Render all send one render.exportBatch each
 * states: loading (bones where the previews go) · ready · error (ErrorCard, Try again) · empty (the videos are gone:
 *   one line and Back) · Back is the kit's Button (default, hover, focus-visible, active; loading/error/success: n/a)
 *   · reduced motion: the view's posters
 * pre-emit critique: P4 H5 E4 S5 R5 V4 */
import { Plural, useLingui } from '@lingui/react/macro';
import { newId, type CastId, type ProjectId } from '@taalcut/core';
import {
  Button,
  CardActionsProvider,
  CardDataProvider,
  ErrorCard,
  VariantPlayerProvider,
  VariantsCompareView,
  type CompareVariant,
  type VariantPlayerProps,
} from '@taalcut/ui';
import { ArrowLeft } from 'lucide-react';
import { useAppCardActions } from '../../../chat/card-actions';
import { useAppCardData } from '../../../chat/card-data';
import { useCastVariants } from './use-cast-variants';
import { VariantPlayer } from './variant-player';

export interface CompareViewProps {
  readonly projectId: ProjectId;
  readonly castId: CastId;
  /** Back to the editor (drops `?compare=`). */
  readonly onClose: () => void;
}

const player = (props: VariantPlayerProps) => <VariantPlayer {...props} />;

/** P3-V3: the variants of one request side by side in the editor (`?compare=<castId>`). */
export function CompareView({ projectId, castId, onClose }: CompareViewProps) {
  const { t } = useLingui();
  const actions = useAppCardActions();
  const data = useAppCardData();
  const { variants, list, ready } = useCastVariants(projectId, castId);

  // Unset presets and captions come from the project's export settings (render's batch command).
  const exportBatch = (chosen: readonly CompareVariant[]) =>
    actions.dispatch
      ? actions.dispatch('render.exportBatch', {
          batchId: newId<'RenderBatch'>(),
          items: chosen.map((variant) => ({ projectId, timelineId: variant.timelineId })),
          mode: 'export',
          notify: false,
        })
      : Promise.resolve(undefined);

  let body;
  if (list.status === 'error' && !list.data)
    body = <ErrorCard error={list.error} onRetry={list.reload} className="max-w-xl" />;
  else if (list.status === 'loading' || (!ready && (list.data?.length ?? 0) > 0))
    body = (
      <div role="status" aria-busy="true" aria-label={t`Loading the videos`} className="flex gap-3">
        {[0, 1, 2].map((index) => (
          <span key={index} aria-hidden className="tc-bone block aspect-[9/16] w-60 rounded-lg bg-hover" />
        ))}
      </div>
    );
  else if (variants.length === 0)
    body = <p className="m-0 text-sm text-ink-2">{t`These videos aren’t here any more.`}</p>;
  else
    body = (
      <CardActionsProvider value={actions}>
        <CardDataProvider value={data}>
          <VariantPlayerProvider render={player}>
            <VariantsCompareView
              projectId={projectId}
              variants={variants}
              size="page"
              {...(actions.navigate
                ? {
                    onOpen: (variant: CompareVariant) =>
                      actions.navigate?.({ to: 'timeline', projectId, timelineId: variant.timelineId }),
                  }
                : {})}
              onRender={(variant) => exportBatch([variant])}
              onRenderAll={() => exportBatch(variants)}
            />
          </VariantPlayerProvider>
        </CardDataProvider>
      </CardActionsProvider>
    );

  return (
    <div data-slot="compare-view" className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="flex flex-col gap-5 px-6 pt-4 pb-10">
        <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Button size="sm" variant="ghost" onClick={onClose}>
            <ArrowLeft aria-hidden />
            {t`Back to the editor`}
          </Button>
          <h2 className="m-0 text-lg font-semibold text-ink">{t`Compare side by side`}</h2>
          {variants.length > 0 ? (
            <span className="text-sm text-ink-2 tabular-nums">
              <Plural value={variants.length} one="# video" other="# videos" />
            </span>
          ) : null}
        </header>
        {body}
      </div>
    </div>
  );
}
