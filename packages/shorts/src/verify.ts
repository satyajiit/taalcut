// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  ok,
  TimeRange,
  type AsyncResult,
  type ShortCandidate,
  type ShortEditPlan,
  type ShortsRequest,
} from '@taalcut/core';
import { z } from 'zod';
import type { SourceEvidence } from './evidence';
import { candidateFromProposal, chronologicalFallback, planCandidate } from './edit-plan';
import { ask } from './model';
import type { ShortsDependencies } from './ports';
import { proposalSchema, type RankedProposal } from './proposals';

const verdictSchema = z.object({
  verdict: z.enum(['accept', 'revise', 'reject']),
  issues: z.array(z.string().min(1).max(1000)).max(12),
});
export interface VerifiedEdit {
  readonly candidate: ShortCandidate;
  readonly plan: ShortEditPlan;
  readonly issues: string[];
  readonly verified: boolean;
}

function context(source: SourceEvidence, candidate: ShortCandidate, summary: string): string {
  const selected = new Set<number>();
  for (const span of candidate.speech) {
    for (const sentence of source.sentences) {
      if (!TimeRange.overlaps(span.range, sentence.range)) continue;
      for (let id = Math.max(0, sentence.id - 2); id <= sentence.id + 2; id++) selected.add(id);
    }
  }
  return JSON.stringify({
    sourceSummary: summary,
    originalContext: source.sentences.filter((sentence) => selected.has(sentence.id)),
    proposedSpokenSequence: candidate.speech.map((span) =>
      source.words
        .filter((word) => TimeRange.overlaps(span.range, word.range))
        .map((word) => word.text)
        .join(' '),
    ),
    proposedVisualSequence: candidate.visuals.map((span) => ({
      span,
      evidence: source.visuals.filter((visual) => TimeRange.overlaps(span.range, visual.range)),
    })),
    candidate,
    plan: planCandidate(candidate),
  });
}

const VERIFY =
  'You are an independent editorial verifier, not the proposer. Compare the final ordered speech and ' +
  'picture against original surrounding source evidence. Reject false meaning, missing negation or caveats, ' +
  'unresolved pronouns, changed speaker attribution or causality, joke without setup, misleading B-roll, ' +
  'fabricated connection, or a cliffhanger without payoff. Check that the hook and ending accurately describe ' +
  'the excerpt. A complete visual action or demonstration can work without speech. Accept only a coherent ' +
  'standalone short with a resolved payoff. Return {verdict:"accept"|"revise"|"reject",issues:[specificIssue]}.';

/** At most two repair calls per candidate. Each repaired edit is checked in an independent model call. */
export async function verifyCandidate(
  deps: ShortsDependencies,
  request: ShortsRequest,
  source: SourceEvidence,
  proposal: RankedProposal,
  candidate: ShortCandidate,
  signal?: AbortSignal,
  repairs: { remaining: number } = { remaining: 2 },
): AsyncResult<VerifiedEdit | null> {
  let current = candidate;
  let issues: string[] = [];
  for (let pass = 0; pass <= 2; pass++) {
    const evidence = context(
      source,
      current,
      `${proposal.summary}\nWhole-source context: ${proposal.wholeSourceContext ?? proposal.summary}`,
    );
    const frames = deps.source.frames
      ? await deps.source.frames(
          source.assetId,
          current.visuals.slice(0, 6).map((span) => span.range),
          signal,
        )
      : ok([]);
    if (!frames.ok) return frames;
    const sampled = frames.value.slice(0, 8);
    const checked = await ask(
      deps,
      request,
      VERIFY,
      `${evidence}\nOriginal frame samples in attachment order: ${JSON.stringify(sampled.map((frame) => frame.at))}`,
      verdictSchema,
      signal,
      sampled,
    );
    if (!checked.ok) return checked;
    issues = checked.value.issues;
    if (checked.value.verdict === 'accept' && !issues.length) {
      return ok({ candidate: current, plan: planCandidate(current), issues: [], verified: true });
    }
    if (repairs.remaining === 0 || checked.value.verdict === 'reject') break;
    repairs.remaining--;
    const repair = await ask(
      deps,
      request,
      'Repair this short using only supplied original sentence ids and scene ids. Preserve full statements ' +
        'and context, remove misleading B-roll or restore source order where needed. Do not write dialogue. ' +
        'Maximum total duration is the supplied request duration, including ending overlay. Return a complete ' +
        '{title,reason,hook,context,payoff,speech:[{first,last}],visuals:[sceneId]} proposal.',
      JSON.stringify({ request, issues, evidence: JSON.parse(evidence), attempt: pass + 1 }),
      proposalSchema,
      signal,
    );
    if (!repair.ok) return repair;
    const resolved = candidateFromProposal(repair.value, source, request);
    if (!resolved.ok) {
      issues = [...issues, resolved.error.detail ?? resolved.error.code];
      break;
    }
    current = { ...resolved.value, id: candidate.id };
  }
  const fallback = chronologicalFallback(candidate);
  return ok(
    fallback
      ? {
          candidate: fallback,
          plan: planCandidate(fallback),
          verified: false,
          issues: [...issues, 'Editorial verification unresolved; review the original contiguous excerpt.'],
        }
      : null,
  );
}
