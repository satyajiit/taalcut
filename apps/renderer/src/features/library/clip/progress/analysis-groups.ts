// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A clip's analysis as the person reads it (LIB1-PROG): the library's fifteen-odd steps grouped by what each gives
 * them (Play it, Shots, Picture, Sound and words, Search, Description), each group in one state, and what the clip
 * is already good for. Pure, so the clip page, its tests and the e2e all read the same answer; the words are
 * analysis-words.ts's.
 *
 * A group is, in order of what matters most: failed (a step didn't work), now (a step runs), held for its model or
 * its original, done (every step settled, one at least done), skipped (every step was not needed), next (a step is
 * queued: it starts as soon as a worker is free) or later. A group is *being redone* while its steps are pending
 * and what it made last time still shows: Analyse again keeps the old results until new ones replace them
 * (`library.reindexAssets` resets the steps, not the data).
 */
import type { AssetDetail } from '@taalcut/core';

type Stage = AssetDetail['stages'][number];

export const ANALYSIS_GROUPS = ['play', 'shots', 'picture', 'sound', 'search', 'describe'] as const;
export type AnalysisGroupKey = (typeof ANALYSIS_GROUPS)[number];

export type GroupState =
  'failed' | 'now' | 'model' | 'original' | 'done' | 'skipped' | 'stopped' | 'next' | 'later';

export const MODEL_REASON = 'library.stage.modelMissing';
export const ORIGINAL_REASON = 'library.stage.originalOffline';

/** The library's stages by the group they serve (library's DEFAULT_STAGE_ORDER and LIB1's new ones). */
const GROUP_OF: Readonly<Record<string, AnalysisGroupKey>> = {
  'library.hash': 'play',
  'media.normalise': 'play',
  'media.thumbnail': 'play',
  'media.proxy': 'play',
  'media.filmstrip': 'play',
  'media.previews': 'play',
  'vision.shots': 'shots',
  'vision.analyse': 'picture',
  'vision.ocr': 'picture',
  'audio.language': 'sound',
  'audio.transcript': 'sound',
  'audio.beats': 'sound',
  'vision.embed': 'search',
  'vision.embedOcr': 'search',
  'vision.embedText': 'search',
  // LIB1-PLACE: naming the place reads only the clip's facts, in milliseconds, and never waits for a model: it goes
  // with the preparing steps (place's request).
  'library.place': 'play',
  'vision.describe': 'describe',
};

/** The group a stage serves; a stage this list doesn't know goes by its package, else with search. */
export function groupOf(stage: string): AnalysisGroupKey {
  const known = GROUP_OF[stage];
  if (known) return known;
  if (stage.startsWith('audio.')) return 'sound';
  if (stage.startsWith('media.')) return 'play';
  if (/embed/i.test(stage)) return 'search';
  if (stage.startsWith('vision.describe')) return 'describe';
  if (stage.startsWith('vision.')) return 'picture';
  return 'search';
}

const settled = (stage: Stage) => stage.state === 'done' || stage.state === 'skipped';
const pending = (stage: Stage) => !settled(stage) && stage.state !== 'failed';
const heldBy = (stage: Stage, reason: string) => stage.state === 'waiting' && stage.reasonKey === reason;

export interface AnalysisGroup {
  readonly key: AnalysisGroupKey;
  readonly stages: readonly Stage[];
  readonly state: GroupState;
  /** Its steps pending while what it made last time still shows: that part of the page is stale. */
  readonly stale: boolean;
  /** Analyse again redoes it: stale, or still to do while another group is (search's vectors show nowhere). */
  readonly redoing: boolean;
  /** The first skipped step's reason, when every step was not needed (an i18n key). */
  readonly reasonKey: string | null;
  /** The step that didn't work. */
  readonly failed: Stage | null;
  /** Sound and words is done, and the clip's speech is in no language Taalcut could tell (LIB1-LANG). */
  readonly unclear: boolean;
}

/**
 * What a pending step made last time is on the clip already: shots, their analysis, words, a description, a copy to
 * play. Asked per step, so a first analysis whose copy is made while its waveform is still to come isn't "again".
 */
function madeBefore(detail: AssetDetail, stage: Stage): boolean {
  switch (stage.stage) {
    case 'media.proxy':
      return detail.playback !== null;
    case 'media.filmstrip':
      return detail.filmstrip !== null;
    case 'media.previews':
      return detail.waveform !== null;
    case 'vision.shots':
      return detail.shots.length > 0;
    case 'vision.analyse':
      return detail.shots.some((shot) => shot.analysis !== null || shot.shotType !== null);
    case 'audio.language':
      return detail.asset.language !== null || detail.asset.speech !== undefined;
    case 'audio.transcript':
      return detail.transcript !== null;
    case 'vision.describe':
      return detail.asset.description !== null;
    default:
      return false;
  }
}

function stateOf(stages: readonly Stage[]): GroupState {
  if (stages.some((stage) => stage.state === 'failed')) return 'failed';
  if (stages.some((stage) => stage.state === 'running')) return 'now';
  if (stages.some((stage) => heldBy(stage, ORIGINAL_REASON))) return 'original';
  if (stages.some((stage) => heldBy(stage, MODEL_REASON))) return 'model';
  if (stages.every(settled)) return stages.every((stage) => stage.state === 'skipped') ? 'skipped' : 'done';
  return stages.some((stage) => stage.state === 'queued') ? 'next' : 'later';
}

/** The six groups, in the order the person reads them; a group with no steps for this clip is left out. */
export function analysisGroups(detail: AssetDetail): AnalysisGroup[] {
  const byGroup = new Map<AnalysisGroupKey, Stage[]>();
  for (const stage of detail.stages) {
    const key = groupOf(stage.stage);
    byGroup.set(key, [...(byGroup.get(key) ?? []), stage]);
  }
  const groups = ANALYSIS_GROUPS.flatMap((key) => {
    const stages = byGroup.get(key);
    if (!stages || stages.length === 0) return [];
    const state = stateOf(stages);
    const skipped = state === 'skipped' ? stages.find((stage) => stage.reasonKey) : undefined;
    return [
      {
        key,
        stages,
        state,
        stale: stages.some((stage) => pending(stage) && madeBefore(detail, stage)),
        redoing: false,
        reasonKey: skipped?.reasonKey ?? null,
        failed: stages.find((stage) => stage.state === 'failed') ?? null,
        unclear: key === 'sound' && state === 'done' && detail.asset.speech?.state === 'unclear',
      },
    ];
  });
  // Analysing again: every group still to do is being redone, search's vectors included, which show nowhere.
  const again = groups.some((group) => group.stale);
  // A step failed: what was skipped with no reason of its own wasn't "not needed", it wasn't reached.
  const failed = groups.some((group) => group.state === 'failed');
  return groups.map((group) => ({
    ...group,
    state: failed && group.state === 'skipped' && group.reasonKey === null ? 'stopped' : group.state,
    redoing: again && group.stages.some(pending),
  }));
}

export type Overall = 'complete' | 'failed' | 'running' | 'held' | 'waiting';

export interface ClipReadiness {
  readonly overall: Overall;
  /** The copy to play is here. */
  readonly canPlay: boolean;
  /** Search finds it already (its searchable steps are done or skipped: round IX). */
  readonly canSearch: boolean;
  /** Analyse again: what it found last time still shows while the steps are redone. */
  readonly again: boolean;
  /** The group working now, the first in reading order when several are. */
  readonly now: AnalysisGroup | null;
  /** What comes next when nothing runs (between the library's polls). */
  readonly next: AnalysisGroup | null;
  /** Some steps wait for an on-device model. */
  readonly heldForModel: boolean;
}

/** What the clip is already good for, and where its analysis stands as a whole. */
export function readinessOf(detail: AssetDetail, groups: readonly AnalysisGroup[]): ClipReadiness {
  const now = groups.find((group) => group.state === 'now') ?? null;
  const next =
    groups.find((group) => group.state === 'next') ?? groups.find((group) => group.state === 'later') ?? null;
  const heldForModel = groups.some((group) => group.state === 'model');
  const held = groups.some((group) => group.state === 'model' || group.state === 'original');
  const overall: Overall = groups.some((group) => group.state === 'failed')
    ? 'failed'
    : groups.every((group) => group.state === 'done' || group.state === 'skipped')
      ? 'complete'
      : now || (next && !held)
        ? 'running'
        : held
          ? 'held'
          : 'waiting';
  return {
    overall,
    canPlay: detail.playback !== null,
    canSearch: (detail.asset.index.searchableAt ?? null) !== null,
    again: groups.some((group) => group.stale),
    now,
    next: now ? null : next,
    heldForModel,
  };
}

/** How far a group has got (0..1): its settled steps, and the share of each running one its job reports. */
export function groupFraction(group: AnalysisGroup, fractionOf: (stage: Stage) => number | null): number {
  if (group.stages.length === 0) return 0;
  const sum = group.stages.reduce(
    (total, stage) => total + (settled(stage) ? 1 : stage.state === 'running' ? (fractionOf(stage) ?? 0) : 0),
    0,
  );
  return Math.min(1, sum / group.stages.length);
}
