// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* component: the import line's labelled bar (UX4, B12) · system: DESIGN.md v0.6 + UX4
 * under the line's words: the bar (a fixed short width), then its two layers named by swatches in the bar's own
 *   order, left to right: the clips fully analysed (ink-2) and the ones search can find (rule-strong); then the step
 *   and the time left, and the files that need a look (warning, with its icon and words). An import that ended says
 *   how many clips came in, without a bar. Colour is never the only sign: every swatch has its words.
 * states: running (two layers) · before search counts (one: "36 of 120") · every clip searchable ("Analysing
 *   details") · paused (the bar holds) · only waiting, for a model or the originals (how many search finds, LIB1-PROG)
 *   · ended with failures (no bar) · not interactive: no hover or focus
 * motion: the bar's transforms (ImportBar, --dur-short) */
import { Plural, useLingui } from '@lingui/react/macro';
import type { ImportStatus } from '@taalcut/core';
import {
  cn,
  currentStage,
  endedWithFailures,
  everySearchable,
  ImportBar,
  importStageLabel,
  isRunning,
  useFormatters,
  waitsOnly,
} from '@taalcut/ui';
import { TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';

/** A layer's word, after a swatch of its colour. */
function Layer({ tone, children, milestone }: { tone: string; children: ReactNode; milestone?: boolean }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 tabular-nums"
      {...(milestone ? { 'data-slot': 'import-milestone' } : {})}
    >
      <span aria-hidden className={cn('inline-block size-2 shrink-0 rounded-[2px]', tone)} />
      {children}
    </span>
  );
}

export function ImportMeta({
  status,
  lines,
  failed,
}: {
  status: ImportStatus;
  /** Search's count is known: the bar has two layers. */
  lines: boolean;
  /** Files that couldn't be read or finished. */
  failed: number;
}) {
  const { t, i18n } = useLingui();
  const format = useFormatters();
  const { counts } = status;
  const doneCount = format.count(counts.done);
  const allCount = format.count(counts.assets);
  const searchableCount = format.count(Math.max(counts.searchable ?? 0, counts.done));
  const ended = endedWithFailures(status);
  const running = isRunning(status.state) && !waitsOnly(status);
  // LIB1-PROG: the rest only waits (for a model or the originals) and nothing runs: say what search finds, not "0 of
  // 2" fully analysed, which read as nothing in while the clips already play and are found.
  const held = waitsOnly(status) && counts.searchable !== undefined;
  const stage = running ? currentStage(status) : null;
  const left = running && status.etaMs !== null ? format.duration(status.etaMs) : null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 type-meta text-ink-2">
      {ended ? (
        <span>
          <Plural value={counts.done} one="# clip in your library" other="# clips in your library" />
        </span>
      ) : (
        <>
          <ImportBar status={status} lines={lines || held} className="w-32 shrink-0" />
          {held ? (
            <span data-slot="import-milestone" className="tabular-nums">
              {t`${searchableCount} of ${allCount} searchable`}
            </span>
          ) : !lines ? (
            <span className="tabular-nums">{t`${doneCount} of ${allCount}`}</span>
          ) : everySearchable(status) ? (
            <span data-slot="import-milestone">{t`Analysing details`}</span>
          ) : (
            <>
              <Layer tone="bg-ink-2">{t`${doneCount} fully analysed`}</Layer>
              <Layer tone="bg-rule-strong" milestone>
                {t`${searchableCount} of ${allCount} searchable`}
              </Layer>
            </>
          )}
        </>
      )}
      {stage ? <span>{importStageLabel(i18n, stage)}</span> : null}
      {left !== null ? <span>{t`About ${left} left`}</span> : null}
      {failed > 0 ? (
        <span data-slot="import-needs-look" className="inline-flex items-center gap-1 text-warning-strong">
          <TriangleAlert aria-hidden className="size-3.5 shrink-0" />
          <Plural value={failed} one="# file needs a look" other="# files need a look" />
        </span>
      ) : null}
    </div>
  );
}
