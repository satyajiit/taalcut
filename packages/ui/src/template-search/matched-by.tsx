// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: what found a template (a search result's last line) · genre: atmospheric studio app
 * system: DESIGN.md v0.4 · one quiet line in ink-2: "Matched by words · meaning · slot 3’s intent: <the intent as the
 *   template wrote it>"; the intent is the template's own words (UserContent, never translated), in ink. The same
 *   line under a result in the search panel and on a row of the Templates page's list while it shows the search
 * states: default · cut with an ellipsis where the row is a fixed height, all of it in the tooltip (UX3) · a slot
 *   match the hit doesn't place ("a slot’s intent") · hover, focus, active, disabled,
 *   loading, error and success are the row's (TemplateSearchPanel's result, the library's row)
 */
import { Trans } from '@lingui/react/macro';
import type { TemplateSearchHit, TemplateSearchMatch, TemplateSearchSlot } from '@taalcut/core';
import { Fragment, useLayoutEffect, useRef } from 'react';
import { cn } from '#lib/cn';
import { UserContent } from '../cards/card-frame';

/** Words first, then the template as a whole, then the slot: the same order on every row. */
const ORDER: Readonly<Record<TemplateSearchMatch, number>> = { words: 0, meaning: 1, slot: 2 };

function Kind({ kind, slot }: { kind: TemplateSearchMatch; slot: TemplateSearchSlot | undefined }) {
  if (kind === 'words') return <Trans>words</Trans>;
  if (kind === 'meaning') return <Trans>meaning</Trans>;
  if (!slot) return <Trans>a slot’s intent</Trans>;
  const number = slot.index + 1;
  const intent = slot.intent || '…';
  return (
    <Trans>
      slot {number}’s intent:{' '}
      <UserContent translate="no" className="text-ink">
        {intent}
      </UserContent>
    </Trans>
  );
}

/**
 * "Matched by words · slot 3’s intent: …": which of search's lists found the template, and the slot it found as the
 * hit places it. `className` sets how it fits its row (the panel wraps it; the library's fixed-height row truncates).
 */
export function MatchedBy({
  hit,
  className,
  tooltip,
}: {
  hit: TemplateSearchHit;
  className?: string;
  /** The line may be cut (the library's fixed-height row): all of it in its tooltip. */
  tooltip?: boolean;
}) {
  const kinds = [...hit.matchedBy].sort((a, b) => ORDER[a] - ORDER[b]);
  const line = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    if (tooltip && line.current) line.current.title = line.current.textContent?.trim() ?? '';
  });
  return (
    <span
      ref={line}
      data-slot="matched-by"
      className={cn('min-w-0 text-sm text-ink-2 [overflow-wrap:anywhere]', className)}
    >
      <Trans>Matched by</Trans>{' '}
      {kinds.map((kind, at) => (
        <Fragment key={kind}>
          {at > 0 ? ' · ' : null}
          <Kind kind={kind} slot={hit.slot} />
        </Fragment>
      ))}
    </span>
  );
}
