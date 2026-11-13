// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: the template picker's order · genre: atmospheric studio app · system: DESIGN.md v0.4
 * a quiet select over the saved templates: Newest first, or best fit for one source's clips (an import, a folder,
 *   the phone); in fit order each row also says how many of its slots the clips fill
 * states: hidden (no sources, or the host can't fit) · default (Newest first) · hover, focus, active (the Select's)
 *   · loading (the select busy, the list keeps its order) · error (the cause and Try again under it, the list newest
 *   first) · success (the list in fit order) · disabled (a start in flight)
 */
import { useLingui } from '@lingui/react/macro';
import type { FitPool, SourceId, SourceView, TemplateFit, TemplateId } from '@taalcut/core';
import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { useCardData, type TemplateChoice } from '../cards/card-data';
import { ErrorLine } from '../cards/error-line';
import { Select } from '../components/select';
import { FitFacts } from './fit-row';
import { useTemplateFit, type TemplateFitState } from './use-template-fit';

/** Every saved template the picker lists is scored; the result holds at most this many. */
const FIT_LIMIT = 50;
/** The newest sources offered. */
const SOURCES_OFFERED = 8;

export interface FitOrder {
  readonly sources: readonly SourceView[];
  readonly sourceId: SourceId | null;
  readonly choose: (sourceId: SourceId | null) => void;
  readonly state: TemplateFitState;
  readonly retry: () => void;
  /** Saved templates in fit order (fitted ones first, best first; the rest as they came), or as they came. */
  readonly order: (saved: readonly TemplateChoice[]) => readonly TemplateChoice[];
  /** The fit of one saved template, in fit order. */
  readonly fitOf: (id: TemplateId) => TemplateFit | undefined;
}

export function useFitOrder(): FitOrder {
  const data = useCardData();
  const [sources, setSources] = useState<readonly SourceView[]>([]);
  const [sourceId, choose] = useState<SourceId | null>(null);

  useEffect(() => {
    let live = true;
    if (!data.fitTemplates || !data.sources) return;
    data.sources().then(
      (found) =>
        live && setSources([...found].sort((a, b) => b.createdAt - a.createdAt).slice(0, SOURCES_OFFERED)),
      // No sources to offer: the picker stays newest first.
      () => live && setSources([]),
    );
    return () => {
      live = false;
    };
  }, [data]);

  const pool = useMemo<FitPool | null>(() => (sourceId ? { sourceIds: [sourceId] } : null), [sourceId]);
  const { state, retry } = useTemplateFit(pool, FIT_LIMIT);
  const fits = useMemo(
    () =>
      new Map(state.kind === 'ready' ? state.result.fits.map((fit) => [fit.summary.id, fit] as const) : []),
    [state],
  );
  const rank = useMemo(
    () =>
      new Map(
        state.kind === 'ready' ? state.result.fits.map((fit, index) => [fit.summary.id, index] as const) : [],
      ),
    [state],
  );

  const order = (saved: readonly TemplateChoice[]) => {
    if (fits.size === 0) return saved;
    const at = (choice: TemplateChoice) =>
      choice.kind === 'template'
        ? (rank.get(choice.id) ?? Number.POSITIVE_INFINITY)
        : Number.POSITIVE_INFINITY;
    // A stable sort: templates fit didn't return keep their newest-first order after the fitted ones.
    return [...saved].sort((a, b) => at(a) - at(b));
  };
  return { sources, sourceId, choose, state, retry, order, fitOf: (id) => fits.get(id) };
}

export function FitOrderSelect({ order, disabled }: { order: FitOrder; disabled: boolean }) {
  const { t } = useLingui();
  const id = useId();
  if (order.sources.length === 0) return null;
  const NEWEST = '';
  return (
    <div data-slot="fit-order" className="flex flex-col gap-1 px-3">
      <label htmlFor={id} className="text-xs font-medium text-ink-3">
        {t`Sort by`}
      </label>
      <Select
        id={id}
        value={order.sourceId ?? NEWEST}
        disabled={disabled}
        aria-busy={order.state.kind === 'loading' || undefined}
        wrapperClassName="max-w-80"
        onChange={(event) => {
          const picked = order.sources.find((source) => source.id === event.target.value);
          order.choose(picked ? picked.id : null);
        }}
      >
        <option value={NEWEST}>{t`Newest first`}</option>
        {order.sources.map((source) => {
          const name = source.name;
          return (
            <option key={source.id} value={source.id}>
              {t`Best fit for ${name}`}
            </option>
          );
        })}
      </Select>
      {order.state.kind === 'failed' ? <ErrorLine error={order.state.error} onRetry={order.retry} /> : null}
    </div>
  );
}

export interface SavedByFitProps {
  saved: readonly TemplateChoice[];
  /** The list's accessible name. */
  label: string;
  /** A start in flight: the sort waits. */
  disabled: boolean;
  /** One saved template's row; `extra` says how well the chosen source's clips fill it (null when newest first). */
  row: (choice: TemplateChoice, extra: ReactNode) => ReactNode;
}

/** The picker's saved templates under their sort: newest first, or best fit for one source with the facts per row. */
export function SavedByFit({ saved, label, disabled, row }: SavedByFitProps) {
  const fit = useFitOrder();
  return (
    <>
      <FitOrderSelect order={fit} disabled={disabled} />
      <ul
        aria-label={label}
        aria-busy={fit.state.kind === 'loading' || undefined}
        className="m-0 flex list-none flex-col p-0"
      >
        {fit.order(saved).map((choice) => {
          const fitted = choice.kind === 'template' ? fit.fitOf(choice.id) : undefined;
          return row(choice, fitted ? <FitFacts fit={fitted} /> : null);
        })}
      </ul>
    </>
  );
}
