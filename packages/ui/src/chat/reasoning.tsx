// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: reasoning · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.2 · states: working (open) · settled (folded) · hover · focus (base ring on
 * the summary) · active · open/closed */

import { useLingui } from '@lingui/react/macro';
import { ChevronDown } from 'lucide-react';
import { cn } from '#lib/cn';
import { MarkdownText } from './markdown-text';
import { ThoughtLine } from './thought-line';

export interface ReasoningProps {
  /** The model's reasoning summary so far. */
  text: string;
  /** Still thinking: the line breathes and the text stays open. */
  working: boolean;
  /** How long it thought, once finished. Without it the line times itself. */
  elapsedMs?: number;
  className?: string;
}

/**
 * The agent's thinking: a quiet ThoughtLine ("Thinking…", then "Thought for
 * 4.2s") over the reasoning text, indented under it (no rule, no box). Open
 * while it thinks; folds away when it is done and opens again on a click.
 */
export function Reasoning({ text, working, elapsedMs, className }: ReasoningProps) {
  const { t } = useLingui();
  return (
    <details
      data-slot="reasoning"
      data-working={working || undefined}
      open={working}
      className={cn('group/reasoning relative flex flex-col text-ink-2', className)}
    >
      <summary
        className="inline-flex w-fit cursor-pointer list-none items-center gap-1 rounded-sm py-0.5 text-ink-2 hover:text-ink [&::-webkit-details-marker]:hidden"
        title={working ? undefined : t`Show or hide the reasoning`}
      >
        <ThoughtLine
          working={working}
          collapsible={false}
          elapsed={working || elapsedMs === undefined ? undefined : elapsedMs / 1000}
        />
        <ChevronDown
          aria-hidden
          className="size-3.5 text-ink-3 transition-transform duration-(--dur-micro) ease-(--ease-out) group-open/reasoning:rotate-180"
        />
      </summary>
      <MarkdownText text={text} className="mt-1.5 max-w-[65ch] text-sm text-ink-2" />
    </details>
  );
}
