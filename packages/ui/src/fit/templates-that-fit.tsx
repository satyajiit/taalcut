// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: templates that fit this footage (on the import card) · genre: atmospheric studio app
 * system: DESIGN.md v0.4 · a titled group under the import's progress, hairline rows, no card in a card
 * states: hidden (no clip searchable yet, or the host can't fit) · loading (the title, three still bones) · empty (no
 *   saved templates: one line) · nothing matched yet (no clip has a vector yet: one line) · none filled (one line)
 *   · default (the best three: FitRow) · error (the cause and Try again in place of the rows) · per row: FitRow's
 *   eight states
 */
import { Trans, useLingui } from '@lingui/react/macro';
import type { FitPool, FitTemplatesResult, SourceId, TaalcutError, TemplateId } from '@taalcut/core';
import { useId, useMemo, useState } from 'react';
import { useCardActions } from '../cards/card-actions';
import { ErrorLine } from '../cards/error-line';
import { SkeletonLines } from '../skeleton/skeleton';
import { FitRow } from './fit-row';
import { useTemplateFit } from './use-template-fit';

/** The import card shows the best three. */
export const FITS_ON_IMPORT = 3;

export interface TemplatesThatFitProps {
  sourceId: SourceId;
  /** The import's clips search can find so far (fit reads their shots). */
  searchable: number;
  /** The import finished: every clip counts now. */
  finished: boolean;
}

/**
 * When to read again while the import runs: each time the searchable clips double (1, 2, 4, 8…), so the answer fills
 * in as clips arrive without a read per clip, and once more when the import finishes.
 */
export const fitRevision = (searchable: number, finished: boolean): string =>
  finished ? 'finished' : `searchable-${Math.floor(Math.log2(Math.max(1, searchable)))}`;

/** Make it: the template's flow in this chat, one at a time; which one is starting, started, or failed and why. */
function useStartFromFit() {
  const { t } = useLingui();
  const { startFlow } = useCardActions();
  const [starting, setStarting] = useState<TemplateId | null>(null);
  const [started, setStarted] = useState<TemplateId | null>(null);
  const [failed, setFailed] = useState<{ readonly id: TemplateId; readonly error: TaalcutError } | null>(
    null,
  );
  const make = startFlow
    ? (id: TemplateId, name: string) => async () => {
        setStarting(id);
        setFailed(null);
        const result = await startFlow(
          { path: 'template', templateId: id },
          t`Make a video with my template “${name}”`,
        );
        setStarting(null);
        if (result.ok) setStarted(id);
        else setFailed({ id, error: result.error });
      }
    : null;
  return { starting, started, failed, make };
}

/** What an answer with nothing to list means: no saved templates, no clip matchable yet, or none filled. */
function EmptyLine({ result }: { result: FitTemplatesResult }) {
  if (result.templates === 0)
    return <Trans>Save a template and this shows how well these clips fill it.</Trans>;
  if (result.poolShots === 0)
    return <Trans>None of these clips can be matched yet. This fills in as they become searchable.</Trans>;
  return <Trans>None of your templates fit these clips yet.</Trans>;
}

/** The answer: the best three the clips fill at all, or the line that says why there are none. */
function FitAnswer({ result, titleId }: { result: FitTemplatesResult; titleId: string }) {
  const { starting, started, failed, make } = useStartFromFit();
  const fits =
    result.poolShots === 0 ? [] : result.fits.filter((fit) => fit.covered > 0).slice(0, FITS_ON_IMPORT);
  if (fits.length === 0)
    return (
      <p className="m-0 px-3 text-sm text-ink-2">
        <EmptyLine result={result} />
      </p>
    );
  return (
    <ul aria-labelledby={titleId} className="m-0 flex list-none flex-col p-0">
      {fits.map((fit) => {
        const id = fit.summary.id;
        return (
          <FitRow
            key={id}
            fit={fit}
            busy={starting === id}
            disabled={starting !== null && starting !== id}
            started={started === id}
            error={failed?.id === id ? failed.error : null}
            onMake={make?.(id, fit.summary.name)}
          />
        );
      })}
    </ul>
  );
}

export function TemplatesThatFit({ sourceId, searchable, finished }: TemplatesThatFitProps) {
  const titleId = useId();
  const ready = searchable > 0 || finished;
  const pool = useMemo<FitPool | null>(() => (ready ? { sourceIds: [sourceId] } : null), [ready, sourceId]);
  const { state, retry } = useTemplateFit(pool, FITS_ON_IMPORT, fitRevision(searchable, finished));
  if (state.kind === 'idle') return null;
  return (
    <section
      data-slot="templates-that-fit"
      aria-labelledby={titleId}
      className="flex flex-col gap-1 border-t border-rule-subtle pt-3"
    >
      <h3 id={titleId} className="m-0 px-3 text-sm font-medium text-ink">
        <Trans>Templates that fit this footage</Trans>
      </h3>
      {state.kind === 'loading' ? <SkeletonLines lines={3} className="px-3" /> : null}
      {state.kind === 'failed' ? <ErrorLine error={state.error} onRetry={retry} className="px-3" /> : null}
      {state.kind === 'ready' ? <FitAnswer result={state.result} titleId={titleId} /> : null}
    </section>
  );
}
