// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  CancelledError,
  err,
  ok,
  RationalTime,
  ValidationError,
  type AsyncResult,
  type ShortsRequest,
} from '@taalcut/core';
import { z } from 'zod';
import { evidenceWindows, windowText, type SourceEvidence } from './evidence';
import { ask } from './model';
import type { ShortsDependencies } from './ports';
import { candidateFromProposal } from './edit-plan';
import { proposalSchema, type Proposal } from './proposal-schema';

export { proposalSchema, type Proposal } from './proposal-schema';
export interface RankedProposal {
  readonly key: string;
  readonly proposal: Proposal;
  readonly summary: string;
  readonly wholeSourceContext?: string;
}
const windowSchema = z.object({
  summary: z.string().min(1).max(1800),
  candidates: z.array(proposalSchema).max(3),
});
const rankingSchema = z.object({ best: z.array(z.string().min(1).max(100)).min(1).max(4) });

const PROPOSE =
  'You are an editor identifying complete short stories in one window of a longer source. ' +
  'Summarize the window, including background, dependencies and any later qualification. Propose up to 3 ' +
  'self-contained short candidates with an immediate truthful hook, necessary context, and a resolved payoff. ' +
  'Cover interview, comedy, teaching, gaming, demonstrations and visual action on their merits. ' +
  'Select whole sentence ranges using inclusive first/last sentence ids in output order. Never sever a ' +
  'qualification, joke setup, explanation, or imply a different speaker/chronology. Reordering is allowed only ' +
  'if faithful. Visual ids can provide source B-roll, but never false contemporaneous evidence. No repeated ' +
  'speech, filler, artificial cliffhanger, intro montage or padded outro. For visual stories speech may be []. ' +
  'Do not choose visual-only excerpts of dialogue to evade its sentence timing. If no complete story fits, ' +
  'candidates must be []. Output {summary,candidates:[{title,reason,hook,context,payoff,speech:[{first,last}],' +
  'visuals:[sceneId]}]}. All selected sentences/scenes must come from this window. Ending text overlays the ' +
  'last 2 seconds of footage and is already inside the total maximum. Never add footage for duration.';

/** Every source window participates; repeated ranking keeps the final context bounded for hour-long sources. */
export async function proposeFromSource(
  deps: ShortsDependencies,
  request: ShortsRequest,
  source: SourceEvidence,
  signal?: AbortSignal,
  progress?: (completed: number, total: number) => void,
): AsyncResult<RankedProposal[]> {
  const windows = evidenceWindows(source);
  const proposals: RankedProposal[] = [];
  const summaries: string[] = [];
  for (const window of windows) {
    if (signal?.aborted) return err(CancelledError());
    const result = await ask(
      deps,
      request,
      PROPOSE,
      `Maximum total duration: ${RationalTime.toSeconds(request.duration)} seconds.\n` +
        `Source window ${window.id}; evidence:\n${windowText(window)}`,
      windowSchema,
      signal,
    );
    if (!result.ok) return result;
    summaries.push(`Window ${window.id}: ${result.value.summary}`);
    const ids = new Set(window.sentences.map((sentence) => sentence.id));
    const scenes = new Set(window.visuals.map((visual) => visual.id));
    for (const [index, proposal] of result.value.candidates.entries()) {
      const valid =
        proposal.speech.every(({ first, last }) => {
          if (first > last || last - first > source.sentences.length) return false;
          for (let id = first; id <= last; id++) if (!ids.has(id)) return false;
          return true;
        }) && proposal.visuals.every((id) => scenes.has(id));
      if (valid && candidateFromProposal(proposal, source, request).ok) {
        proposals.push({ key: `${window.id}:${index}`, proposal, summary: result.value.summary });
      }
    }
    progress?.(window.id + 1, windows.length);
  }
  // Windows with no short still contain qualifications, outcomes and lore needed by another window.
  const whole = await summarizeSource(deps, request, summaries, signal);
  if (!whole.ok) return whole;
  let ranked = proposals;
  while (ranked.length > 4) {
    const next: RankedProposal[] = [];
    for (let from = 0; from < ranked.length; from += 12) {
      const group = ranked.slice(from, from + 12);
      if (group.length <= 4) {
        next.push(...group);
        continue;
      }
      const selected = await rank(deps, request, group, signal);
      if (!selected.ok) return selected;
      next.push(...selected.value);
    }
    ranked = next;
  }
  const ordered = ranked.length > 1 ? await rank(deps, request, ranked, signal) : ok(ranked);
  return ordered.ok
    ? ok(ordered.value.map((item) => ({ ...item, wholeSourceContext: whole.value })))
    : ordered;
}

async function summarizeSource(
  deps: ShortsDependencies,
  request: ShortsRequest,
  summaries: readonly string[],
  signal?: AbortSignal,
): AsyncResult<string> {
  let level = [...summaries];
  while (level.length > 1) {
    const next: string[] = [];
    for (let from = 0; from < level.length; from += 8) {
      const group = level.slice(from, from + 8);
      if (group.length === 1) {
        next.push(group[0]!);
        continue;
      }
      const result = await ask(
        deps,
        request,
        'Build global source context in chronological order from these source-window summaries. Retain all ' +
          'qualifications, later corrections, eventual outcomes, speaker attribution, lore dependencies and ' +
          'causal relationships that could change the meaning of an excerpt. Do not select a short. ' +
          'Return {summary:string}, at most 4000 characters. Mark uncertainty explicitly.',
        JSON.stringify(group),
        z.object({ summary: z.string().min(1).max(4000) }),
        signal,
      );
      if (!result.ok) return result;
      next.push(result.value.summary);
    }
    level = next;
  }
  return ok(level[0] ?? 'No source summary.');
}

async function rank(
  deps: ShortsDependencies,
  request: ShortsRequest,
  group: readonly RankedProposal[],
  signal?: AbortSignal,
): AsyncResult<RankedProposal[]> {
  const result = await ask(
    deps,
    request,
    'Independently rank source-backed short candidates by hook clarity, context sufficiency, resolved payoff, ' +
      'visual interest and faithful standalone meaning. Popularity is unknown; never promise virality. ' +
      'Return {best:[candidateKey]} with up to 4 keys, strongest first. Do not return a key twice.',
    JSON.stringify(group),
    rankingSchema,
    signal,
  );
  if (!result.ok) return result;
  const selected = result.value.best.map((key) => group.find((item) => item.key === key));
  if (selected.some((item) => !item) || new Set(result.value.best).size !== selected.length) {
    return err(ValidationError({ field: 'shorts.ranking' }, { detail: 'Unknown or repeated candidate' }));
  }
  return ok(selected.filter((item): item is RankedProposal => item !== undefined));
}
