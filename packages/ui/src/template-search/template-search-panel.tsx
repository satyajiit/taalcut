// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: templates that match the search (under the Templates page's search field) · genre:
 *   atmospheric studio app (chrome modern-minimal) · system: DESIGN.md v0.6 (UX3: the rule edge, so it reads over the list in dark)
 * a popover surface under the field, open at once as popovers are: one honest line while search reads words only,
 *   then the results as options, each the template's name as written with its slots and length, and what matched it
 *   (words, meaning, or a slot's intent as the template wrote it)
 * states: empty (no words yet: what you can search by) · loading (three bones) · settling (older results dimmed after
 *   200 ms while new ones load, aria-busy) · error (the cause and Try again) · no match (says so; words only says why
 *   meaning didn't look) · words only (a line over the results) · default (results) · per option: hover and the
 *   keyboard's option (hover surface) · pressed (pressed surface) · success (the template opens) · disabled n/a
 */
import { Plural, Trans, useLingui } from '@lingui/react/macro';
import type { TaalcutError, TemplateId, TemplateSearchHit, TemplateSearchResult } from '@taalcut/core';
import { Info } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '#lib/cn';
import { useFormatters } from '#lib/format';
import { UserContent } from '../cards/card-frame';
import { ErrorLine } from '../cards/error-line';
import { Button } from '../components/button';
import { VERB_ICONS } from '../icons/concepts';
import { SkeletonLines } from '../skeleton/skeleton';
import { toSeconds } from '../templates/slot-words';
import { MatchedBy } from './matched-by';

export type TemplateSearchView =
  | { readonly kind: 'empty' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'failed'; readonly error: TaalcutError }
  | {
      readonly kind: 'ready';
      /** The words these results answer. */
      readonly words: string;
      /** The answer's first results (the Templates page's list holds them all, in the same order). */
      readonly result: TemplateSearchResult;
      /** Newer words or filters are being searched: these results are the last answer. */
      readonly settling: boolean;
    };

export interface TemplateSearchPanelProps {
  readonly view: TemplateSearchView;
  /** The results' listbox (the field's aria-controls). */
  readonly listId: string;
  /** Each result's id (the field's aria-activedescendant). */
  readonly optionId: (index: number) => string;
  /** The keyboard's result, or null. */
  readonly active: number | null;
  readonly onActive: (index: number) => void;
  readonly onOpen: (templateId: TemplateId) => void;
  readonly onRetry: () => void;
}

/**
 * The honest line while search reads words only (no Search model yet): by default "Matching words only…", over the
 * panel's results and over the Templates page's list while it shows the same answer; `status` when it is the whole
 * answer (nothing has the words).
 */
export function TemplateSearchWordsOnly({
  children,
  status,
  className,
}: {
  children?: ReactNode;
  status?: boolean;
  className?: string;
}) {
  return (
    <p
      data-slot="words-only"
      role={status ? 'status' : undefined}
      className={cn('m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-2 text-sm text-ink-2', className)}
    >
      <Info aria-hidden className="mt-0.5 size-4 text-ink-3" />
      {children ?? (
        <Trans>Matching words only. Searching by meaning starts when the Search model is downloaded.</Trans>
      )}
    </p>
  );
}

interface ResultProps {
  readonly hit: TemplateSearchHit;
  readonly id: string;
  readonly active: boolean;
  readonly onActive: () => void;
  readonly onOpen: () => void;
}

function Result({ hit, id, active, onActive, onOpen }: ResultProps) {
  const format = useFormatters();
  const { summary } = hit;
  return (
    <li
      role="option"
      id={id}
      aria-selected={active}
      data-slot="template-search-result"
      // The field keeps focus: the keys and the pointer move the same active result.
      onMouseDown={(event) => event.preventDefault()}
      onMouseMove={onActive}
      onClick={onOpen}
      className={cn(
        'flex cursor-pointer flex-col gap-0.5 rounded-md px-2.5 py-2 active:bg-pressed',
        active && 'bg-hover',
      )}
    >
      <span className="flex min-w-0 items-baseline gap-2">
        <UserContent translate="no" className="truncate text-base font-medium text-ink">
          {summary.name}
        </UserContent>
        <span className="shrink-0 text-sm text-ink-3 tabular-nums">
          <Plural value={summary.slotCount} one="# slot" other="# slots" />
          {' · '}
          {format.duration(toSeconds(summary.duration) * 1000)}
        </span>
      </span>
      <MatchedBy hit={hit} />
    </li>
  );
}

function Results(props: TemplateSearchPanelProps & { view: Extract<TemplateSearchView, { kind: 'ready' }> }) {
  const { t } = useLingui();
  const { view, listId, optionId, active, onActive, onOpen } = props;
  return (
    <ul
      role="listbox"
      id={listId}
      aria-label={t`Matching templates`}
      aria-busy={view.settling || undefined}
      className={cn(
        'm-0 flex list-none flex-col p-0 transition-opacity duration-(--dur-short) ease-(--ease-out)',
        view.settling && 'opacity-60 delay-200',
      )}
    >
      {view.result.hits.map((hit, index) => (
        <Result
          key={hit.summary.id}
          hit={hit}
          id={optionId(index)}
          active={active === index}
          onActive={() => onActive(index)}
          onOpen={() => onOpen(hit.summary.id)}
        />
      ))}
    </ul>
  );
}

function Body(props: TemplateSearchPanelProps) {
  const { t } = useLingui();
  const { view } = props;
  if (view.kind === 'empty')
    return (
      <p className="m-0 px-2.5 py-2 text-sm text-ink-2">
        <Trans>Search by a template’s name, what it’s about, or a shot it needs.</Trans>
      </p>
    );
  if (view.kind === 'loading')
    return (
      <div aria-busy className="px-2.5 py-1.5">
        <SkeletonLines lines={3} />
      </div>
    );
  if (view.kind === 'failed')
    return (
      <div className="flex flex-col items-start gap-2 px-2.5 py-2">
        <ErrorLine error={view.error} />
        <Button type="button" size="sm" icon={VERB_ICONS.retry} onClick={props.onRetry}>
          {t`Try again`}
        </Button>
      </div>
    );
  const wordsOnly = view.result.degraded === 'keyword-only';
  const words = view.words;
  if (view.result.hits.length === 0)
    return wordsOnly ? (
      <TemplateSearchWordsOnly status className="px-2.5 py-2">
        <Trans>
          No template has the words “{words}”. Searching by meaning starts when the Search model is
          downloaded.
        </Trans>
      </TemplateSearchWordsOnly>
    ) : (
      <p role="status" className="m-0 px-2.5 py-2 text-sm text-ink-2">
        <Trans>No template matches “{words}” by its words or its meaning.</Trans>
      </p>
    );
  return (
    <>
      {wordsOnly ? <TemplateSearchWordsOnly className="px-2.5 py-2" /> : null}
      <Results {...props} view={view} />
    </>
  );
}

/** The search's answer under the field: results to open, or the line that says why there are none. */
export function TemplateSearchPanel(props: TemplateSearchPanelProps) {
  return (
    <div
      data-slot="template-search-panel"
      data-state={props.view.kind}
      className="max-h-[min(28rem,60vh)] overflow-y-auto rounded-lg border border-rule bg-popover p-1 text-popover-foreground shadow-md"
    >
      <Body {...props} />
    </div>
  );
}
