// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: opening choice, one template row · genre: atmospheric studio app · system: DESIGN.md v0.3
 * a hairline row: a saved template's name as written with its slots and length, a bundled starter (P3-B3) with its
 *   length, the footage it needs and its placeholder blocks, or a format in words; the arrow shows on hover and focus
 * states: default · hover (hover surface) · focus (base ring) · active (pressed) · disabled (another start in flight)
 *   · loading (this row spins, aria-busy) · error and success (the list's: the cause under it, the chat takes over)
 */
import { Plural } from '@lingui/react/macro';
import { ArrowRight, LoaderCircle } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { cn } from '#lib/cn';
import { useFormatters } from '#lib/format';
import type { TemplateChoice } from './card-data';
import { UserContent } from './card-frame';
import { StarterBlocks, StarterFacts } from './opening-starters';

const ROW =
  'flex w-full cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-start transition-colors ' +
  'duration-(--dur-micro) ease-(--ease-out) hover:bg-hover active:bg-pressed disabled:cursor-not-allowed ' +
  'disabled:text-ink-disabled disabled:hover:bg-transparent';

/** A row's identity: the template or format id, or the starter's. */
export const keyOf = (choice: TemplateChoice): string =>
  choice.kind === 'starter' ? choice.starterId : choice.id;

/** The line under the name: a starter's facts and blocks, a template's slots and length, a format's line. */
function ChoiceFacts({ choice }: { choice: TemplateChoice }) {
  const format = useFormatters();
  if (choice.kind === 'starter')
    return (
      <>
        <span className="flex flex-wrap gap-x-1 text-sm text-ink-2">
          <StarterFacts choice={choice} />
          <span aria-hidden>·</span>
          <span>{choice.needs}</span>
        </span>
        <StarterBlocks blocks={choice.blocks} className="mt-1 max-w-56" />
      </>
    );
  return (
    <span className="text-sm text-ink-2 tabular-nums">
      {choice.kind === 'template' ? (
        <>
          <Plural value={choice.slotCount} one="# slot" other="# slots" />
          {' · '}
          {format.duration(choice.seconds * 1000)}
        </>
      ) : (
        choice.line
      )}
    </span>
  );
}

export interface TemplateChoiceRowProps {
  choice: TemplateChoice;
  disabled: boolean;
  /** This row's start is in flight. */
  busy: boolean;
  onPick: () => void;
  /** A further line under the facts (LRN1-TPL: how well the chosen footage fills this template). */
  extra?: ReactNode;
}

export function TemplateChoiceRow({ choice, disabled, busy, onPick, extra }: TemplateChoiceRowProps) {
  return (
    <li className="border-t border-rule-subtle first:border-t-0">
      <button
        type="button"
        disabled={disabled}
        aria-busy={busy || undefined}
        onClick={onPick}
        className={cn(ROW, 'group')}
      >
        <span className="flex min-w-0 flex-1 flex-col">
          {choice.kind === 'template' ? (
            <UserContent translate="no" className="truncate text-base font-medium text-ink">
              {choice.name}
            </UserContent>
          ) : (
            <span className="text-base font-medium text-ink">{choice.name}</span>
          )}
          <ChoiceFacts choice={choice} />
          {extra}
        </span>
        {busy ? (
          <LoaderCircle aria-hidden className="size-4 shrink-0 animate-spin text-ink-2" />
        ) : (
          <ArrowRight
            aria-hidden
            className="size-4 shrink-0 text-ink-3 opacity-0 transition-opacity duration-(--dur-micro) group-hover:opacity-100 group-focus-visible:opacity-100"
          />
        )}
      </button>
    </li>
  );
}

/** A named group of rows under a small heading (the starters, the formats). */
export function ChoiceGroup({ heading, children }: { heading: ReactNode; children: ReactNode }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <h4 id={id} className="m-0 px-3 text-xs font-medium text-ink-3">
        {heading}
      </h4>
      <ul aria-labelledby={id} className="m-0 flex list-none flex-col p-0">
        {children}
      </ul>
    </div>
  );
}
