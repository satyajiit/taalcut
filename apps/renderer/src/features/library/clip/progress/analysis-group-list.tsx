// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* component: a clip's analysis by what it gives you (LIB1-PROG) · mode: Operate · system: DESIGN.md v0.7
 * the kit's ListRows, dense and static (a summary, nothing to press): one row per group, Play it, Shots, Picture,
 *   Sound and words, Search, Description, each led by its state's glyph from the registry with the state in words
 *   under its name (done, now, next, later, waits for its model or the original, not needed and why, didn't work;
 *   "Redoing now" and "To redo" while Analyse again runs). The group working now carries a neutral bar under its
 *   words (background work runs neutral: ink-3 on the hover track, never violet) and its time left at the row's
 *   end when this Mac knows it
 * states: per row done · now (bar, spinner) · next · later · waits (model, original) · skipped (the reason) ·
 *   not done (skipped behind a failed step) ·
 *   failed (danger glyph, its word) · redoing; interactive states n/a (static rows)
 * contrast: names ink, state words ink-2 (≥ 7:1 on canvas, both themes); the time left ink-3 is meta (a unit);
 *   glyphs ink-2 and ink-3, the pending ring rule-strong (3:1, a shape beside its words); danger-strong ≥ 4.5:1
 * motion: the bar's fill by transform (--dur-short), the spinner (a loader, slower under reduced motion); nothing
 *   else moves */
import { useLingui } from '@lingui/react/macro';
import { CONCEPT_ICONS, cn, ListRow, ListRows } from '@taalcut/ui';
import { JobBar } from '../../../downloads/job-bar';
import { formatTimeLeft } from '../../../downloads/time-left';
import { roundedLeftMs, timeLeftMs, type StageClock } from './analysis-estimate';
import { groupFraction, type AnalysisGroup, type GroupState } from './analysis-groups';
import { GROUP_NAMES, groupStateText } from './analysis-words';

const GLYPH_CLASS = 'size-4 shrink-0';

/** Each glyph in a 24 px box: the spinner's 16 px square turned 45° stays inside it, so nothing overflows. */
function StateGlyph({ state }: { state: GroupState }) {
  return (
    <span aria-hidden className="flex size-6 shrink-0 items-center justify-center">
      <Glyph state={state} />
    </span>
  );
}

function Glyph({ state }: { state: GroupState }) {
  switch (state) {
    case 'done':
      return <CONCEPT_ICONS.success aria-hidden className={cn(GLYPH_CLASS, 'text-ink-3')} />;
    case 'now':
      return <CONCEPT_ICONS.running aria-hidden className={cn(GLYPH_CLASS, 'animate-spin text-ink-2')} />;
    case 'failed':
      return <CONCEPT_ICONS.error aria-hidden className={cn(GLYPH_CLASS, 'text-danger-strong')} />;
    case 'model':
    case 'original':
      return <CONCEPT_ICONS.waiting aria-hidden className={cn(GLYPH_CLASS, 'text-ink-2')} />;
    case 'skipped':
      return <CONCEPT_ICONS.skipped aria-hidden className={cn(GLYPH_CLASS, 'text-ink-3')} />;
    case 'next':
      return <CONCEPT_ICONS.queued aria-hidden className={cn(GLYPH_CLASS, 'text-ink-2')} />;
    case 'later':
    case 'stopped':
      return <CONCEPT_ICONS.pending aria-hidden className={cn(GLYPH_CLASS, 'text-rule-strong')} />;
  }
}

export function AnalysisGroupList({
  groups,
  clock,
}: {
  groups: readonly AnalysisGroup[];
  clock: StageClock;
}) {
  const { t, i18n } = useLingui();
  return (
    <ListRows aria-label={t`What Taalcut does with this clip`} data-slot="clip-groups">
      {groups.map((group) => {
        const name = i18n._(GROUP_NAMES[group.key]);
        const left = group.state === 'now' ? timeLeftMs(group.stages, clock) : null;
        const rounded = left === null ? null : roundedLeftMs(left);
        return (
          <ListRow
            key={group.key}
            static
            size="dense"
            data-group={group.key}
            data-state={group.state}
            data-redoing={group.redoing || undefined}
            leading={<StateGlyph state={group.state} />}
            title={name}
            meta={
              <span className={cn(group.state === 'failed' && 'text-danger-strong')}>
                {groupStateText(i18n, group)}
              </span>
            }
            trailingMeta={rounded === null ? undefined : formatTimeLeft(i18n, rounded)}
          >
            {group.state === 'now' ? (
              <span className="block pt-1">
                <JobBar label={name} fraction={groupFraction(group, clock.fractionOf)} />
              </span>
            ) : null}
          </ListRow>
        );
      })}
    </ListRows>
  );
}
