// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Turns the study's probes into labels: an asset (its path in the footage set) and, for a moment, its time range
 * in seconds. ix-v1's moments come from the set's own plan (`planClip`: each shot's look and start, each
 * on-screen line's times), the same plan the generator encoded, so no time is typed by hand. The search eval's
 * eight queries join the study as they are (their clip is the label).
 */
import { IX_V1, planClip, type ClipPlan } from '@taalcut/bench-footage';
import { SEARCH_FIXTURE_LIBRARY, syntheticSearchClips, syntheticSearchQueries } from '../fixtures';
import type { ProbeKind, Selector, StudyProbe, StudySet } from './schema';

export interface StudyLabel {
  readonly asset: string;
  /** Seconds into the asset; absent for "any shot of it". */
  readonly range?: { readonly from: number; readonly to: number };
}

export interface LabelledProbe {
  readonly id: string;
  readonly set: StudySet;
  readonly language: StudyProbe['language'];
  readonly kind: ProbeKind;
  readonly text: string;
  readonly relevant: readonly StudyLabel[];
}

const ixPlans = new Map<string, ClipPlan>(IX_V1.clips.map((clip) => [clip.file, planClip(IX_V1, clip)]));

function ixLabels(selector: Selector): StudyLabel[] {
  if ('look' in selector) {
    const labels = [...ixPlans].flatMap(([file, plan]) =>
      plan.shots
        .filter((shot) => shot.look === selector.look)
        .map((shot) => ({ asset: file, range: { from: shot.startsAt, to: shot.startsAt + shot.seconds } })),
    );
    if (labels.length === 0) throw new Error(`ix-v1 has no ${selector.look} shot`);
    return labels;
  }
  const plan = ixPlans.get(selector.clip);
  if (!plan) throw new Error(`ix-v1 has no clip ${selector.clip}`);
  if ('onScreen' in selector) {
    const line = plan.texts.find((text) => text.line === selector.onScreen);
    if (!line) throw new Error(`${selector.clip} never shows "${selector.onScreen}"`);
    return [{ asset: selector.clip, range: { from: line.from, to: line.to } }];
  }
  if ('spokenToo' in selector) {
    const said = plan.clip.speech?.text.toLocaleLowerCase() ?? '';
    if (!said.includes(selector.spokenToo.toLocaleLowerCase()))
      throw new Error(`${selector.clip} doesn't say "${selector.spokenToo}"`);
  }
  return [{ asset: selector.clip }];
}

const syntheticAssets = new Set(syntheticSearchClips().map((clip) => clip.asset));

function syntheticLabels(selector: Selector): StudyLabel[] {
  if (!('clip' in selector) || 'onScreen' in selector || 'spokenToo' in selector)
    throw new Error('synthetic-search probes name whole clips');
  if (!syntheticAssets.has(selector.clip)) throw new Error(`synthetic-search has no clip ${selector.clip}`);
  return [{ asset: selector.clip }];
}

/** The probe with its labels resolved; throws naming the probe when a selector names nothing. */
export function labelProbe(probe: StudyProbe): LabelledProbe {
  try {
    const relevant = probe.relevant.flatMap((selector) =>
      probe.set === 'ix-v1' ? ixLabels(selector) : syntheticLabels(selector),
    );
    return {
      id: probe.id,
      set: probe.set,
      language: probe.language,
      kind: probe.kind,
      text: probe.text,
      relevant,
    };
  } catch (error) {
    throw new Error(`${probe.id}: ${error instanceof Error ? error.message : String(error)}`, {
      cause: error,
    });
  }
}

/** The search eval's own queries (P2-Q1's synthetic set): each names one clip whose burned-in word it asks for. */
export function evalQueryProbes(): LabelledProbe[] {
  return syntheticSearchQueries().map((query) => ({
    id: `eval-${query.queryId}`,
    set: 'synthetic-search' as const,
    language: query.language,
    kind: 'on-screen' as const,
    text: query.text,
    relevant: query.relevant.map((shot) => ({ asset: shot.asset })),
  }));
}

/** Every probe of the study: the file's, then the search eval's. Ids are unique across both. */
export function studyProbes(probes: readonly StudyProbe[]): LabelledProbe[] {
  const all = [...probes.map(labelProbe), ...evalQueryProbes()];
  const ids = new Set<string>();
  for (const probe of all) {
    if (ids.has(probe.id)) throw new Error(`duplicate probe id ${probe.id}`);
    ids.add(probe.id);
  }
  return all;
}

/** The set a stored library holds, from its assets' paths: every asset must belong to one set. */
export function setOfAssets(paths: readonly string[]): StudySet {
  if (paths.length > 0 && paths.every((path) => ixPlans.has(path))) return 'ix-v1';
  if (paths.length > 0 && paths.every((path) => syntheticAssets.has(path))) return SEARCH_FIXTURE_LIBRARY;
  throw new Error(`these assets are neither ix-v1 nor the search eval's: ${paths.slice(0, 3).join(', ')}`);
}
