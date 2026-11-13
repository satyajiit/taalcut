// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* component: the steps Taalcut takes with a clip (LIB1-PROG, after UX2's) · mode: Operate · system: DESIGN.md v0.7
 * shown when the status's "Show the steps" opens them: one line per indexing stage, under the group it serves
 *   (Play it, Shots, Picture, Sound and words, Search, Description: the status's own groups), its state's glyph and
 *   word (background work: a neutral spinner, never violet); a skipped or waiting stage says why in the library's
 *   words when it knows (no sound, the original's drive is away, a model to download), wrapping under its name
 *   rather than truncating
 * states: done · in progress · waiting (with its reason) · skipped (not needed for this clip, or why) · failed
 *   (danger glyph and word) · interactive states n/a (a list of facts)
 * contrast: running ink, settled ink-2, to come ink-3 is meta beside its word; glyphs ink-2/ink-3, rule-strong 3:1
 */
import type { I18n, MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
import type { AssetDetail } from '@taalcut/core';
import { CONCEPT_ICONS, cn, importStageLabel } from '@taalcut/ui';
import { indexingReasonText } from '../indexing-messages';
import { MODEL_MISSING_REASON } from '../../downloads/stage-models';
import { ANALYSIS_GROUPS, groupOf, type AnalysisGroupKey } from './progress/analysis-groups';
import { GROUP_NAMES } from './progress/analysis-words';

type Stage = AssetDetail['stages'][number];
type StageState = Stage['state'];

const STATE_WORDS: Readonly<Record<StageState, MessageDescriptor>> = {
  waiting: msg`waiting`,
  queued: msg`waiting`,
  running: msg`now`,
  done: msg`done`,
  skipped: msg`not needed`,
  failed: msg`didn’t work`,
};

/**
 * The catalogue's words for a model-held step say a download is under way; the step waits whether one is or not
 * (the waiting card above the list says which models and offers the download).
 */
const MODEL_WAIT = msg`waits for its model`;

/** The clip page's own name for a step the import strip names too broadly (both previews are "Making previews"). */
const CLIP_STAGE_LABELS: Readonly<Record<string, MessageDescriptor>> = {
  'media.proxy': msg`Making a copy to play`,
  'media.filmstrip': msg`Laying out the frames`,
  'media.previews': msg`Drawing the sound`,
};

/** A step's name on the clip page. */
export function clipStageLabel(i18n: I18n, stage: string): string {
  const own = CLIP_STAGE_LABELS[stage];
  return own ? i18n._(own) : importStageLabel(i18n, stage);
}

/** Why a step is where it is, in the library's words when it has some. */
function reasonOf(i18n: I18n, state: StageState, reasonKey: string | undefined): string {
  if (reasonKey === MODEL_MISSING_REASON) return i18n._(MODEL_WAIT);
  return (reasonKey ? indexingReasonText(i18n, reasonKey) : undefined) ?? i18n._(STATE_WORDS[state]);
}

interface StageGroup {
  readonly key: AnalysisGroupKey;
  readonly label: MessageDescriptor;
  readonly stages: readonly Stage[];
}

/** The stages under the groups the status shows, in its order; a group with no stage for this clip is left out. */
export function stageGroups(stages: AssetDetail['stages']): StageGroup[] {
  return ANALYSIS_GROUPS.flatMap((key) => {
    const mine = stages.filter((stage) => groupOf(stage.stage) === key);
    return mine.length > 0 ? [{ key, label: GROUP_NAMES[key], stages: mine }] : [];
  });
}

function StageIcon({ state }: { state: StageState }) {
  const iconClassName = 'mt-[3px] size-3.5 shrink-0';
  if (state === 'done')
    return <CONCEPT_ICONS.success aria-hidden className={cn(iconClassName, 'text-ink-3')} />;
  if (state === 'running')
    return <CONCEPT_ICONS.running aria-hidden className={cn(iconClassName, 'animate-spin text-ink-2')} />;
  if (state === 'failed')
    return <CONCEPT_ICONS.error aria-hidden className={cn(iconClassName, 'text-danger-strong')} />;
  if (state === 'skipped')
    return <CONCEPT_ICONS.skipped aria-hidden className={cn(iconClassName, 'text-ink-3')} />;
  if (state === 'queued')
    return <CONCEPT_ICONS.queued aria-hidden className={cn(iconClassName, 'text-ink-2')} />;
  return <CONCEPT_ICONS.pending aria-hidden className={cn(iconClassName, 'text-rule-strong')} />;
}

function StageList({ stages }: { stages: readonly Stage[] }) {
  const { i18n } = useLingui();
  return (
    <ol className="m-0 flex list-none flex-col gap-1.5 p-0">
      {stages.map(({ stage, state, reasonKey }) => (
        <li key={stage} data-state={state} className="flex items-start gap-2 type-body">
          <StageIcon state={state} />
          <span className="min-w-0">
            <span className={cn(state === 'running' ? 'font-medium text-ink' : 'text-ink-2')}>
              {clipStageLabel(i18n, stage)}
            </span>{' '}
            <span className="type-meta text-ink-2" data-slot="stage-reason">
              {reasonOf(i18n, state, reasonKey)}
            </span>
          </span>
        </li>
      ))}
    </ol>
  );
}

/** Every stage of a clip, under the group it serves. */
export function ClipStages({ stages }: { stages: AssetDetail['stages'] }) {
  const { i18n } = useLingui();
  return (
    <div data-slot="clip-steps" className="flex flex-col gap-3 pt-2">
      {stageGroups(stages).map((group) => (
        <div key={group.key} className="flex flex-col gap-1.5" data-group={group.key}>
          <h3 className="m-0 type-label-sm text-ink-2">{i18n._(group.label)}</h3>
          <StageList stages={group.stages} />
        </div>
      ))}
    </div>
  );
}
