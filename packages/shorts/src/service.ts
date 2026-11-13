// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  CancelledError,
  err,
  newId,
  NotFoundError,
  ok,
  shortsRequestSchema,
  ValidationError,
  type AsyncResult,
  type Result,
  type ShortsRequest,
  type ShortsRun,
  type ShortsRunId,
} from '@taalcut/core';
import { evidenceKey, readSourceEvidence, sourceFingerprint } from './evidence';
import { candidateFromProposal } from './edit-plan';
import { createShortsCoordinator, type ShortsDependencies, type ShortsOptions } from './ports';
import { proposeFromSource } from './proposals';
import { verifyCandidate, type VerifiedEdit } from './verify';

export interface ShortsService {
  generate(request: ShortsRequest, options?: ShortsOptions): AsyncResult<ShortsRun>;
  regenerate(runId: ShortsRunId, options?: Omit<ShortsOptions, 'runId'>): AsyncResult<ShortsRun>;
  get(runId: ShortsRunId): AsyncResult<ShortsRun | null>;
}

export function createShortsService(deps: ShortsDependencies): ShortsService {
  const now = deps.now ?? Date.now;
  const coordinator = deps.coordinator ?? createShortsCoordinator();

  async function execute(
    request: ShortsRequest,
    options: ShortsOptions,
    fresh: boolean,
  ): AsyncResult<ShortsRun> {
    if (options.signal?.aborted) return err(CancelledError());
    let run: ShortsRun | undefined;
    if (options.runId) {
      const found = await deps.runs.get(options.runId);
      if (!found.ok) return found;
      if (found.value && evidenceKey(found.value.request) !== evidenceKey(request)) {
        return err(ValidationError({ field: 'shorts.runId' }, { detail: 'Run belongs to another request' }));
      }
      run = found.value ?? undefined;
    } else if (!fresh) {
      const found = await deps.runs.list(request.projectId);
      if (!found.ok) return found;
      run = found.value.find((item) => evidenceKey(item.request) === evidenceKey(request));
    }
    if (run && ((run.status === 'ready' && run.timelineId) || run.status === 'needsReview')) return ok(run);
    run ??= {
      id: options.runId ?? newId<'ShortsRun'>(),
      request,
      status: 'queued',
      stage: 'queued',
      candidates: [],
      issues: [],
      createdAt: now(),
      updatedAt: now(),
    };
    const state = { run };
    const save = async (patch: Partial<ShortsRun>): AsyncResult<void> => {
      state.run = { ...state.run, ...patch, updatedAt: now() };
      const result = await deps.runs.put(state.run);
      if (result.ok) options.progress?.(state.run);
      return result;
    };
    const started = await save({
      status: 'running',
      stage: state.run.plan ? 'composing' : 'evidence',
      error: undefined,
    });
    if (!started.ok) return started;
    const result = await produce(state, save, options);
    if (!result.ok) {
      const failed = await save({
        status: CancelledError.is(result.error) ? 'cancelled' : 'failed',
        error: result.error.code,
      });
      if (!failed.ok) return failed;
    }
    return result;
  }

  async function produce(
    state: { run: ShortsRun },
    save: (patch: Partial<ShortsRun>) => AsyncResult<void>,
    options: ShortsOptions,
  ): AsyncResult<ShortsRun> {
    const { request } = state.run;
    if (!state.run.plan) {
      const evidence = await readSourceEvidence(deps.source, request.assetId, options.signal);
      if (!evidence.ok) return evidence;
      const selecting = await save({
        stage: 'selecting',
        sourceFingerprint: sourceFingerprint(evidence.value),
      });
      if (!selecting.ok) return selecting;
      const proposals = await proposeFromSource(deps, request, evidence.value, options.signal);
      if (!proposals.ok) return proposals;
      const candidates = proposals.value.flatMap((proposal) => {
        const candidate = candidateFromProposal(proposal.proposal, evidence.value, request);
        if (!candidate.ok) return [];
        const previous = state.run.candidates.find(
          (item) =>
            item.title === candidate.value.title &&
            evidenceKey(item.speech, item.visuals) ===
              evidenceKey(candidate.value.speech, candidate.value.visuals),
        );
        return [
          { proposal, candidate: previous ? { ...candidate.value, id: previous.id } : candidate.value },
        ];
      });
      const proposed = await save({
        candidates: candidates.map((item) => item.candidate),
        stage: 'verifying',
      });
      if (!proposed.ok) return proposed;
      let chosen: VerifiedEdit | null = null;
      let fallback: VerifiedEdit | null = null;
      const repairs = { remaining: 2 };
      for (const item of candidates) {
        const verified = await verifyCandidate(
          deps,
          request,
          evidence.value,
          item.proposal,
          item.candidate,
          options.signal,
          repairs,
        );
        if (!verified.ok) return verified;
        if (verified.value?.verified) {
          chosen = verified.value;
          break;
        }
        fallback ??= verified.value;
      }
      chosen ??= fallback;
      if (!chosen) {
        const empty = await save({
          status: 'needsReview',
          stage: 'noCandidate',
          issues: [
            'No complete, faithful short fits the selected duration. Choose a longer duration or another source.',
          ],
        });
        return empty.ok ? ok(state.run) : empty;
      }
      const planned = await save({
        status: chosen.verified ? 'running' : 'needsReview',
        stage: chosen.verified ? 'composing' : 'editorialReview',
        plan: chosen.plan,
        candidates: [
          chosen.candidate,
          ...state.run.candidates.filter((item) => item.id !== chosen.candidate.id),
        ],
        issues: chosen.issues,
      });
      if (!planned.ok) return planned;
      if (!chosen.verified) return ok(state.run);
    }
    // An interrupted older checkpoint must never bypass an unresolved editorial verdict.
    if (state.run.issues.length) {
      const review = await save({ status: 'needsReview', stage: 'editorialReview' });
      return review.ok ? ok(state.run) : review;
    }
    if (options.signal?.aborted) return err(CancelledError());
    const source = await deps.source.describe(request.assetId, options.signal);
    if (!source.ok) return source;
    if (!state.run.sourceFingerprint || sourceFingerprint(source.value) !== state.run.sourceFingerprint) {
      const changed = await save({
        status: 'needsReview',
        stage: 'sourceChanged',
        issues: ['Source content or analysis changed after selection. Regenerate to verify the new source.'],
      });
      return changed.ok ? ok(state.run) : changed;
    }
    const composed = await deps.compose(state.run.id, request, state.run.plan!, options.signal);
    if (!composed.ok) return composed;
    const issues = [...state.run.issues, ...(composed.value.issues ?? [])];
    const finished = await save({
      ...composed.value,
      issues,
      status: issues.length ? 'needsReview' : 'ready',
      stage: 'complete',
    });
    return finished.ok ? ok(state.run) : finished;
  }

  function generate(
    request: ShortsRequest,
    options: ShortsOptions = {},
    fresh = false,
  ): AsyncResult<ShortsRun> {
    const parsed = shortsRequestSchema.safeParse(request);
    if (!parsed.success) return Promise.resolve(err(ValidationError({ field: 'shorts.request' })));
    const key = options.runId ?? evidenceKey(parsed.data, fresh ? newId() : 'generate');
    const existing = coordinator.active.get(key);
    if (existing) return existing;
    const work = execute(parsed.data, options, fresh);
    coordinator.active.set(key, work);
    void work.finally(() => coordinator.active.delete(key)).catch(() => undefined);
    return work;
  }

  return {
    generate,
    get: (id) => deps.runs.get(id),
    async regenerate(id, options = {}): Promise<Result<ShortsRun>> {
      const found = await deps.runs.get(id);
      if (!found.ok) return found;
      if (!found.value) return err(NotFoundError({ entity: 'shortsRun', id }));
      return generate(found.value.request, options, true);
    },
  };
}
