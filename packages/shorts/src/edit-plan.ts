// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  err,
  newId,
  ok,
  RationalTime,
  TimeRange,
  ValidationError,
  type Result,
  type ShortCandidate,
  type ShortEditPlan,
  type ShortSourceSpan,
  type ShortTimedSpan,
  type ShortsRequest,
} from '@taalcut/core';
import type { SourceEvidence } from './evidence';
import type { Proposal } from './proposal-schema';

const ZERO = RationalTime.zero({ num: 1000, den: 1 });
const invalid = (detail: string) => err(ValidationError({ field: 'shorts.candidate' }, { detail }));
const total = (spans: readonly ShortSourceSpan[]) =>
  spans.reduce((duration, span) => RationalTime.add(duration, span.range.duration), ZERO);

/** Resolve model identifiers against real timing; models cannot supply a time at this boundary. */
export function candidateFromProposal(
  proposal: Proposal,
  source: SourceEvidence,
  request: ShortsRequest,
): Result<ShortCandidate> {
  const speech: ShortSourceSpan[] = [];
  for (const selected of proposal.speech) {
    const first = source.sentences[selected.first];
    const last = source.sentences[selected.last];
    if (!first || !last || selected.first > selected.last) return invalid('Unknown sentence');
    const range = TimeRange.fromStartEnd(first.range.start, TimeRange.end(last.range));
    if (speech.some((span) => TimeRange.overlaps(span.range, range))) return invalid('Repeated speech');
    speech.push({ assetId: source.assetId, range, wordStart: first.wordStart, wordEnd: last.wordEnd });
  }
  const visuals: ShortSourceSpan[] = [];
  for (const id of proposal.visuals) {
    const visual = source.visuals.find((item) => item.id === id);
    if (!visual) return invalid('Unknown scene');
    if (visuals.some((span) => TimeRange.overlaps(span.range, visual.range)))
      return invalid('Repeated scene');
    visuals.push({ assetId: source.assetId, range: visual.range });
  }
  // Spoken shorts default to their own original footage; source B-roll is a separate visual clock.
  if (!visuals.length) visuals.push(...speech);
  if (!visuals.length) return invalid('Empty candidate');
  if (!speech.length && source.hasAudio) {
    const coversSpeech = visuals.some((span) =>
      source.sentences.some((sentence) => TimeRange.overlaps(span.range, sentence.range)),
    );
    if (coversSpeech) return invalid('Visual-only selection would cut dialogue without word boundaries');
    speech.push(...visuals);
  }
  const duration = speech.length ? total(speech) : total(visuals);
  if (duration.value <= 0 || RationalTime.isAfter(duration, request.duration))
    return invalid('Duration budget');
  return ok({ id: newId<'ShortCandidate'>(), ...proposal, speech, visuals });
}

function timed(spans: readonly ShortSourceSpan[]): ShortTimedSpan[] {
  let start = ZERO;
  return spans.map((source) => {
    const item = { source, start, duration: source.range.duration };
    start = RationalTime.add(start, item.duration);
    return item;
  });
}

/** Remove a prefix from an existing source/output map, retaining exact source provenance. */
function tail(spans: readonly ShortTimedSpan[], from: RationalTime): ShortTimedSpan[] {
  return spans.flatMap((span) => {
    const end = RationalTime.add(span.start, span.duration);
    if (!RationalTime.isAfter(end, from)) return [];
    const start = RationalTime.max(span.start, from);
    const offset = RationalTime.subtract(start, span.start);
    const duration = RationalTime.subtract(end, start);
    return [
      {
        start,
        duration,
        source: {
          assetId: span.source.assetId,
          range: TimeRange.of(RationalTime.add(span.source.range.start, offset), duration),
        },
      },
    ];
  });
}

/** Ending is an overlay, never padding. Source B-roll may replace picture while original speech stays mapped. */
export function planCandidate(candidate: ShortCandidate): ShortEditPlan {
  const speech = timed(candidate.speech);
  const duration = total(candidate.speech.length ? candidate.speech : candidate.visuals);
  const visuals: ShortTimedSpan[] = [];
  let start = ZERO;
  for (const source of candidate.visuals) {
    if (!RationalTime.isBefore(start, duration)) break;
    const length = RationalTime.min(source.range.duration, RationalTime.subtract(duration, start));
    visuals.push({
      source: { ...source, range: TimeRange.of(source.range.start, length) },
      start,
      duration: length,
    });
    start = RationalTime.add(start, length);
  }
  if (RationalTime.isBefore(start, duration)) visuals.push(...tail(speech, start));
  return {
    candidateId: candidate.id,
    title: candidate.title,
    hook: candidate.hook,
    speech,
    visuals,
    duration,
    endingDuration: RationalTime.min(RationalTime.of(2000, ZERO.rate), duration),
  };
}

/** A contiguous source excerpt is the review fallback when reordered storytelling remains uncertain. */
export function chronologicalFallback(candidate: ShortCandidate): ShortCandidate | null {
  if (candidate.speech.length !== 1 || candidate.speech[0]?.wordStart === undefined) {
    return null;
  }
  return { ...candidate, visuals: [...candidate.speech] };
}
