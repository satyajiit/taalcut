// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The words for a clip's analysis (LIB1-PROG): each group's name, its state, and a whole sentence for what Taalcut
 * is doing now or next, one per group, so no translation has to splice a verb into a frame. What the clip is good
 * for leads the status ("You can play and search this clip now").
 */
import type { I18n, MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { indexingReasonText } from '../../indexing-messages';
import type { AnalysisGroup, AnalysisGroupKey, ClipReadiness, GroupState } from './analysis-groups';

export const GROUP_NAMES: Readonly<Record<AnalysisGroupKey, MessageDescriptor>> = {
  play: msg`Play it`,
  shots: msg`Shots`,
  picture: msg`Picture`,
  sound: msg`Sound and words`,
  search: msg`Search`,
  describe: msg`Description`,
};

const STATE_WORDS: Readonly<Record<GroupState, MessageDescriptor>> = {
  failed: msg`Didn’t work`,
  now: msg`Now`,
  model: msg`Waits for its model`,
  original: msg`Waits for the original`,
  done: msg`Done`,
  skipped: msg`Not needed`,
  stopped: msg`Not done`,
  next: msg`Next`,
  later: msg`Later`,
};

/** While Analyse again redoes a group, its state says so. */
const REDO_WORDS: Partial<Readonly<Record<GroupState, MessageDescriptor>>> = {
  now: msg`Redoing now`,
  next: msg`Redoing next`,
  later: msg`To redo`,
};

const NOW_LINES: Readonly<Record<AnalysisGroupKey, MessageDescriptor>> = {
  play: msg`Taalcut is getting it ready to play.`,
  shots: msg`Taalcut is finding its shots.`,
  picture: msg`Taalcut is looking at what’s in the picture.`,
  sound: msg`Taalcut is listening to it.`,
  search: msg`Taalcut is getting it ready for search.`,
  describe: msg`Taalcut is describing it.`,
};

const NEXT_LINES: Readonly<Record<AnalysisGroupKey, MessageDescriptor>> = {
  play: msg`Next, Taalcut gets it ready to play.`,
  shots: msg`Next, Taalcut finds its shots.`,
  picture: msg`Next, Taalcut looks at what’s in the picture.`,
  sound: msg`Next, Taalcut listens to it.`,
  search: msg`Next, Taalcut gets it ready for search.`,
  describe: msg`Next, Taalcut describes it.`,
};

/** A group's state in words: why it was skipped when the library says, "Redoing now" while Analyse again runs. */
export function groupStateText(i18n: I18n, group: AnalysisGroup): string {
  if (group.unclear) return i18n._(msg`Done. Speech, language unclear`);
  if (group.state === 'skipped' && group.reasonKey) {
    const reason = indexingReasonText(i18n, group.reasonKey);
    if (reason) return reason;
  }
  const redo = group.redoing ? REDO_WORDS[group.state] : undefined;
  return i18n._(redo ?? STATE_WORDS[group.state]);
}

/** The status's heading while the clip is analysed: what it is good for already, or that it is analysed again. */
export function readinessHeading(i18n: I18n, readiness: ClipReadiness): string {
  if (readiness.again) return i18n._(msg`Taalcut is analysing this clip again`);
  if (readiness.canPlay && readiness.canSearch) return i18n._(msg`You can play and search this clip now`);
  if (readiness.canPlay) return i18n._(msg`You can play this clip now`);
  if (readiness.canSearch) return i18n._(msg`You can search this clip now`);
  return i18n._(msg`Taalcut is still looking at this clip`);
}

/** What Taalcut is doing now, or does next, as one sentence; null when nothing runs or is to come. */
export function nowLine(i18n: I18n, readiness: ClipReadiness): string | null {
  if (readiness.now) return i18n._(NOW_LINES[readiness.now.key]);
  if (readiness.next && readiness.overall === 'running') return i18n._(NEXT_LINES[readiness.next.key]);
  return null;
}
