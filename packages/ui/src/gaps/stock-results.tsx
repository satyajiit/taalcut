// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: stock results (P3-V18 in P3-B8) · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.3 · a gap's stock fix opened in place: up to six 9:16 results in a row of three, "Videos from
 *   Pexels" under them as plain words (the app opens no link the allow-list doesn't name), unboxed on the panel
 * states: loading (six still bones in the grid's shape, "Looking for stock video") · empty ("Nothing for “…”") ·
 *   unavailable (the reason in one line, the settings link) · error (the cause, Try again) · default (the grid) ·
 *   using (that tile spins, the others wait, "Getting the video…") · failed (the cause under the grid, Retry) ·
 *   success (the tile says Used; the gap folds)
 * motion: none of its own (the grid shows at once; the gap's fold is the one motion)
 * pre-emit critique: P5 H4 E4 S5 R5 V4 */
import { useLingui } from '@lingui/react/macro';
import type { Result, StockResult, TaalcutError } from '@taalcut/core';
import { RotateCcw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '#components/button';
import { errorMessage } from '../feedback/error-messages';
import type { StockQuery } from './gap-types';
import { reasonOfError } from './gap-words';
import { StockResultTile } from './stock-result-tile';
import { UnavailableLine } from './unavailable-line';

const SHOWN = 6;

type Search =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly items: readonly StockResult[] }
  | { readonly status: 'error'; readonly error: TaalcutError };

export interface StockResultsProps {
  query: string;
  search: (query: StockQuery) => Promise<Result<{ readonly items: readonly StockResult[] }>>;
  /** Imports one and fills the gap; absent shows the results without Use it. */
  onUse?: (item: StockResult) => Promise<Result<unknown>>;
  onSettings?: (section: 'accounts' | 'models' | 'privacy' | 'usage') => void;
}

function Bones() {
  const { t } = useLingui();
  return (
    <div aria-busy="true" data-slot="stock-loading" className="flex flex-col gap-2">
      <span className="sr-only">{t`Looking for stock video`}</span>
      <div aria-hidden className="grid grid-cols-3 gap-3">
        {Array.from({ length: SHOWN }, (_, index) => (
          <span key={index} className="tc-bone block aspect-[9/16] w-full rounded-md bg-hover" />
        ))}
      </div>
    </div>
  );
}

export function StockResults({ query, search, onUse, onSettings }: StockResultsProps) {
  const { t, i18n } = useLingui();
  const [state, setState] = useState<Search>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [using, setUsing] = useState<string | null>(null);
  const [used, setUsed] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ item: StockResult; error: TaalcutError } | null>(null);
  // A new search per query or Try again, not per render of a caller that rebuilds its handlers.
  const searchRef = useRef(search);
  searchRef.current = search;

  useEffect(() => {
    let live = true;
    setState({ status: 'loading' });
    void searchRef.current({ query, kind: 'video', orientation: 'portrait' }).then((result) => {
      if (!live) return;
      setState(
        result.ok ? { status: 'ready', items: result.value.items } : { status: 'error', error: result.error },
      );
    });
    return () => {
      live = false;
    };
  }, [query, attempt]);

  const use = async (item: StockResult) => {
    if (!onUse || using) return;
    setUsing(item.providerId);
    setFailure(null);
    const result = await onUse(item);
    setUsing(null);
    if (result.ok) setUsed(item.providerId);
    else setFailure({ item, error: result.error });
  };

  if (state.status === 'loading') return <Bones />;
  if (state.status === 'error') {
    const reason = reasonOfError(state.error);
    if (reason)
      return <UnavailableLine kind="stock" reason={reason} {...(onSettings ? { onSettings } : {})} />;
    return (
      <div role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-danger-strong">
        <span className="min-w-0">{errorMessage(i18n, state.error)}</span>
        <Button size="sm" variant="ghost" onClick={() => setAttempt((n) => n + 1)}>
          <RotateCcw aria-hidden />
          {t`Try again`}
        </Button>
      </div>
    );
  }
  const items = state.items.slice(0, SHOWN);
  if (items.length === 0)
    return (
      <p className="m-0 text-sm text-ink-2">
        {t`No stock video for “${query}”. Try filming it, or drop the slot.`}
      </p>
    );
  return (
    <div data-slot="stock-results" className="flex flex-col gap-2">
      <ul aria-label={t`Stock videos`} className="m-0 grid list-none grid-cols-3 gap-3 p-0">
        {items.map((item) => (
          <StockResultTile
            key={`${item.provider}:${item.providerId}`}
            item={item}
            state={used === item.providerId ? 'used' : using === item.providerId ? 'using' : 'idle'}
            disabled={using !== null || used !== null}
            {...(onUse && used === null ? { onUse: () => void use(item) } : {})}
          />
        ))}
      </ul>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-xs text-ink-2">
        <p role="status" className="m-0">
          {using ? t`Getting the video, then putting it in the slot…` : ''}
        </p>
        <p className="m-0">{t`Videos from Pexels`}</p>
      </div>
      {failure ? (
        <div role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-danger-strong">
          <span className="min-w-0">{errorMessage(i18n, failure.error)}</span>
          <Button size="sm" variant="ghost" onClick={() => void use(failure.item)}>
            <RotateCcw aria-hidden />
            {t`Retry`}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
