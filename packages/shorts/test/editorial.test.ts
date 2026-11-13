// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { err, ok, TimeRange, unwrap, ValidationError } from '@taalcut/core';
import { describe, expect, it, vi } from 'vitest';
import { candidateFromProposal, createShortsService, planCandidate, readSourceEvidence } from '../src';
import { fixtures, ms, proposal, range } from './helpers';

describe('source evidence and exact edit provenance', () => {
  it('reads beyond the truncated 500-segment asset-detail view', async () => {
    const setup = fixtures(503);
    const evidence = unwrap(await readSourceEvidence(setup.deps.source, setup.assetId));
    expect(evidence.sentences).toHaveLength(503);
    expect(evidence.words).toHaveLength(1006);
    expect(setup.deps.source.transcript).toHaveBeenCalledTimes(2);
    const selected = unwrap(candidateFromProposal(proposal(500, 502), evidence, setup.request));
    expect(selected.speech[0]?.wordStart).toBe(1000);
    expect(selected.speech[0]?.range).toEqual(range(1_000_000, 5800));
  });

  it('rejects invented ids, repeated speech, over-budget clips and bad pagination', async () => {
    const setup = fixtures(40);
    const evidence = unwrap(await readSourceEvidence(setup.deps.source, setup.assetId));
    expect(candidateFromProposal(proposal(0, 999), evidence, setup.request).ok).toBe(false);
    expect(
      candidateFromProposal(
        {
          ...proposal(),
          speech: [
            { first: 0, last: 2 },
            { first: 1, last: 3 },
          ],
        },
        evidence,
        setup.request,
      ).ok,
    ).toBe(false);
    expect(candidateFromProposal(proposal(0, 39), evidence, setup.request).ok).toBe(false);
    expect(
      (
        await readSourceEvidence(
          {
            ...setup.deps.source,
            transcript: async () => ok({ segments: [setup.segments[0]!], nextSegment: 0 }),
          },
          setup.assetId,
        )
      ).ok,
    ).toBe(false);
  });

  it('maps source B-roll independently from reordered speech and never pads the ending', async () => {
    const setup = fixtures();
    const evidence = unwrap(
      await readSourceEvidence(
        {
          ...setup.deps.source,
          visuals: async () =>
            ok({
              items: [{ id: 'broll', range: range(6500, 800), description: 'A closeup of the result.' }],
            }),
        },
        setup.assetId,
      ),
    );
    const selected = unwrap(
      candidateFromProposal(
        {
          ...proposal(),
          speech: [
            { first: 2, last: 2 },
            { first: 0, last: 1 },
          ],
          visuals: ['broll'],
        },
        evidence,
        setup.request,
      ),
    );
    const plan = planCandidate(selected);
    expect(plan.speech.map((span) => span.source.range.start.value)).toEqual([4000, 0]);
    expect(plan.visuals[0]?.source.range).toEqual(range(6500, 800));
    expect(plan.visuals[1]?.source.range.start.value).toBe(4800);
    expect(plan.duration).toEqual(ms(5600));
    expect(plan.endingDuration).toEqual(ms(2000));
    expect(
      TimeRange.end({ start: plan.visuals.at(-1)!.start, duration: plan.visuals.at(-1)!.duration }),
    ).toEqual(plan.duration);
  });

  it('refuses visual-only excerpts that would sever existing dialogue', async () => {
    const setup = fixtures();
    const evidence = unwrap(await readSourceEvidence(setup.deps.source, setup.assetId));
    expect(
      candidateFromProposal({ ...proposal(), speech: [], visuals: ['scene'] }, evidence, setup.request).ok,
    ).toBe(false);
  });
});

describe('durable short generation', () => {
  it('creates a verified editable short and coalesces repeated requests', async () => {
    const setup = fixtures();
    const service = createShortsService(setup.deps);
    const [first, second] = await Promise.all([
      service.generate(setup.request),
      service.generate(setup.request),
    ]);
    expect(unwrap(first).id).toBe(unwrap(second).id);
    expect(unwrap(first)).toMatchObject({ status: 'ready', stage: 'complete', issues: [], revision: 1 });
    expect(setup.compose).toHaveBeenCalledTimes(1);
    expect(setup.calls.every((call) => call.placement === 'local')).toBe(true);
    expect(unwrap(await service.generate(setup.request)).id).toBe(unwrap(first).id);
    expect(setup.compose).toHaveBeenCalledTimes(1);
  });

  it('resumes a persisted plan without paying for model calls again', async () => {
    const setup = fixtures();
    const failed = createShortsService({
      ...setup.deps,
      compose: async () => err(ValidationError({ field: 'render' })),
    });
    expect((await failed.generate(setup.request)).ok).toBe(false);
    const run = [...setup.runs.values()][0]!;
    expect(run.plan).toBeDefined();
    expect(run.status).toBe('failed');
    const calls = setup.calls.length;
    const resumed = unwrap(await createShortsService(setup.deps).generate(setup.request, { runId: run.id }));
    expect(resumed.status).toBe('ready');
    expect(setup.calls).toHaveLength(calls);
  });

  it('uses real frames in the independent verification call', async () => {
    const setup = fixtures();
    const frames = vi.fn(async () =>
      ok([{ at: ms(500), data: 'aW1hZ2U=', mimeType: 'image/jpeg' as const }]),
    );
    const result = await createShortsService({
      ...setup.deps,
      source: { ...setup.deps.source, frames },
    }).generate(setup.request);
    expect(unwrap(result).status).toBe('ready');
    expect(frames).toHaveBeenCalledTimes(1);
    expect(setup.calls.at(-1)?.module).toBe('vision');
    expect(setup.calls.at(-1)?.content.some((part) => part.type === 'image')).toBe(true);
  });

  it('allows no more than two repairs, then marks a contiguous fallback for review', async () => {
    const setup = fixtures();
    setup.respond((input) =>
      input.system.includes('independent editorial verifier')
        ? { verdict: 'revise', issues: ['The referent remains uncertain.'] }
        : input.system.includes('Repair this short')
          ? proposal()
          : { summary: 'A lesson.', candidates: [proposal()] },
    );
    const run = unwrap(await createShortsService(setup.deps).generate(setup.request));
    expect(run.status).toBe('needsReview');
    expect(run.issues).toContain('The referent remains uncertain.');
    expect(setup.calls.filter((input) => input.system.includes('Repair this short'))).toHaveLength(2);
    expect(run.plan?.visuals[0]?.source.range).toEqual(run.plan?.speech[0]?.source.range);
    expect(setup.compose).not.toHaveBeenCalled();
  });

  it('returns no candidate instead of inventing a hook, and stops before any work when cancelled', async () => {
    const setup = fixtures();
    setup.respond(() => ({ summary: 'An unresolved setup.', candidates: [] }));
    const service = createShortsService(setup.deps);
    const run = unwrap(await service.generate(setup.request));
    expect(run).toMatchObject({ status: 'needsReview', stage: 'noCandidate' });
    expect(run.plan).toBeUndefined();
    expect(setup.compose).not.toHaveBeenCalled();
    const cancelled = await service.generate(setup.request, { signal: AbortSignal.abort() });
    expect(!cancelled.ok && cancelled.error.code).toBe('core.cancelled');
  });
});

it('selects a late hook after reading and summarizing the entire long source', async () => {
  const setup = fixtures(503);
  setup.respond((input) => {
    if (input.system.includes('independent editorial verifier')) return { verdict: 'accept', issues: [] };
    if (input.system.includes('global source context'))
      return { summary: 'The late lesson resolves the earlier setup.' };
    const text = input.content
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join('');
    const source = JSON.parse(text.slice(text.indexOf('evidence:\n') + 10)) as {
      sentences: Array<{ id: number }>;
    };
    return {
      summary: 'Earlier setup and later resolution.',
      candidates: source.sentences.some((sentence) => sentence.id === 502) ? [proposal(500, 502)] : [],
    };
  });
  const run = unwrap(await createShortsService(setup.deps).generate(setup.request));
  expect(run.status).toBe('ready');
  expect(run.plan?.speech[0]?.source.wordStart).toBe(1000);
  expect(setup.calls.some((call) => call.system.includes('global source context'))).toBe(true);
  expect(setup.calls.at(-1)?.content[0]).toMatchObject({
    type: 'text',
    text: expect.stringContaining('late lesson resolves the earlier setup'),
  });
});
