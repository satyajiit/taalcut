// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* component: the window bar's analysis (LIB1-PROG) · mode: Operate · system: DESIGN.md v0.7 (Window › Downloads)
 * at the bar's right end, just before the downloads, on every page in the shell while Taalcut analyses clips: a
 *   28 px ghost button holding the clip glyph and how many (tabular), in ink-2 (background work runs neutral; no
 *   accent, no spinner in the chrome). Under 1280 px the glyph alone, as the download is, so the page's actions keep
 *   their room in a narrow window; its name and tooltip still say how many. Clips held for a model or their drive don't count: nothing runs for them.
 *   Pointing at it names it in the bar's tooltip ("Analysing 3 clips"); its own name is what it shows, after a
 *   hidden label ("Clips being analysed: 3"). Pressing it opens a popover under it,
 *   instantly as DESIGN.md's popovers do: the time left over one bar, what most of the rest is, the clips being
 *   analysed, each a link to its page, and the held ones with the way to the models. Light dismiss, Escape and the
 *   button close it; focus goes back to the button. Gone, with a fade, once nothing is being analysed
 * states: default · hover (the hover fill) · focus-visible (the base ring) · active (pressed) · paused (the label
 *   and heading say so) · loading (the queue reads when it opens) · error (the read's cause) · inactive window
 *   (ink-3) · disabled n/a
 * motion: it fades in and out over --dur-short on --ease-out (opacity only); reduced motion: a 150 ms fade
 * contrast: ink-2 glyph and count on canvas ≥ 7:1, both themes
 */
import { plural } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
import {
  AnimatePresence,
  Button,
  CONCEPT_ICONS,
  DUR,
  EASE_OUT,
  motion,
  REDUCED_FADE,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  useReducedMotion,
} from '@taalcut/ui';
import { useId, useState, type ToggleEvent } from 'react';
import { useIndexingStatus } from '../library/import-strip';
import { AnalysisQueueView } from './analysis-queue';
import { summariseAnalysis } from './analysis-summary';
import { useAnalysisQueue } from './use-analysis-queue';

/** Clips being analysed, at the window bar's right end beside the downloads (LIB1-PROG). */
export function AnalysisIndicator() {
  const { t, i18n } = useLingui();
  const reduced = useReducedMotion();
  const [status] = useIndexingStatus();
  const summary = summariseAnalysis(status);
  const [open, setOpen] = useState(false);
  const queue = useAnalysisQueue(open, status?.updatedAt ?? 0);
  const popoverId = useId();
  const titleId = useId();
  const count = summary?.count ?? 0;
  const shown = summary !== null && (count > 0 || open);
  const label = summary?.paused
    ? t`Analysis paused, ${plural(count, { one: '# clip left', other: '# clips left' })}`
    : t`Analysing ${plural(count, { one: '# clip', other: '# clips' })}`;
  const fade = { duration: reduced ? REDUCED_FADE : DUR.short, ease: EASE_OUT };
  return (
    <AnimatePresence initial={false}>
      {shown && summary ? (
        <motion.span
          key="analysis"
          data-slot="analysis-indicator"
          data-state={summary.paused ? 'paused' : 'running'}
          className="flex items-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={fade}
        >
          <Tooltip>
            <TooltipTrigger asChild>
              {/* Named by what it shows: a whole label, then the count it reads aloud as seen (no spliced words). */}
              <Button
                variant="ghost"
                popoverTarget={popoverId}
                data-action="open-analysis"
                className="h-7 gap-1 px-1.5 text-ink-2 [anchor-name:--analysis] window-inactive:text-ink-3"
              >
                <CONCEPT_ICONS.clip aria-hidden className="size-4" />
                <span className="sr-only">
                  {summary.paused ? t`Analysis paused. Clips left:` : t`Clips being analysed:`}
                </span>
                <span className="type-meta tabular-nums max-xl:sr-only">{i18n.number(count)}</span>
              </Button>
            </TooltipTrigger>
            {open ? null : <TooltipContent>{label}</TooltipContent>}
          </Tooltip>
          <div
            id={popoverId}
            popover="auto"
            // A dialog while open only: pages' Escape keys look for an open layer by role (use-review-keys.ts), and
            // this one sits in the bar on every page, closed.
            role={open ? 'dialog' : undefined}
            aria-labelledby={open ? titleId : undefined}
            data-slot="analysis-popover"
            // The toggle event doesn't bubble: the popover itself says when it opens and closes.
            onToggle={(event: ToggleEvent<HTMLDivElement>) => setOpen(event.newState === 'open')}
            className={[
              'app-no-drag m-0 w-80 max-w-[calc(100vw-24px)] overflow-y-auto rounded-lg border border-rule-subtle',
              'bg-popover p-4 text-popover-foreground shadow-md',
              'max-h-[calc(100vh-var(--spacing-toolbar)-24px)] inset-auto [position-anchor:--analysis]',
              'top-[calc(anchor(bottom)+8px)] right-[anchor(right)]',
            ].join(' ')}
          >
            {open ? (
              <AnalysisQueueView titleId={titleId} title={label} summary={summary} queue={queue} />
            ) : (
              <h2 id={titleId} className="sr-only">
                {label}
              </h2>
            )}
          </div>
        </motion.span>
      ) : null}
    </AnimatePresence>
  );
}
