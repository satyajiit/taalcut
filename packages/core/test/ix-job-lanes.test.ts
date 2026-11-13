// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Round IX, designs A and B: job lanes inside class budgets, and the order key on requests and records. */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  budgetClass,
  connectRpc,
  DEFAULT_LANE_LIMIT,
  defineJobKind,
  jobConcurrencyPlanSchema,
  jobEnqueueContract,
  jobEnqueuerOverRpc,
  jobEnqueueRouter,
  jobLaneSchema,
  jobOrderKeySchema,
  jobRecordSchema,
  jobRequestSchema,
  jobSnapshotSchema,
  laneLimit,
  newId,
  ok,
  publicJobSnapshotSchema,
  serveRpc,
  unwrap,
  type JobConcurrencyPlan,
  type JobRequest,
  type JobSnapshot,
} from '@taalcut/core';
import { channel } from './helpers/ports';

/** A job as a store from before round IX wrote it: no orderKey. */
const oldSnapshot = (): JobSnapshot => ({
  id: newId<'Job'>(),
  kind: 'vision.embedAsset',
  state: 'queued',
  priority: 'low',
  resource: 'gpu',
  projectId: null,
  idempotencyKey: null,
  parentId: null,
  attempt: 1,
  maxAttempts: 3,
  progress: null,
  error: null,
  createdAt: 1,
  updatedAt: 1,
  startedAt: null,
  finishedAt: null,
  nextAttemptAt: null,
});

const plan: JobConcurrencyPlan = {
  classes: { cpu: 3, gpu: 2, npu: 1, video: 2, io: 4, network: 4 },
  lanes: { 'vision.embedder': 1, 'audio.whisper': 1, 'models.llm': 1 },
};

describe('job lanes', () => {
  it('names a lane like an index stage', () => {
    for (const lane of ['vision.embedder', 'audio.whisper', 'audio.parakeet', 'audio.beats', 'models.llm'])
      expect(jobLaneSchema.safeParse(lane).success).toBe(true);
    for (const lane of ['', 'whisper', 'Audio.whisper', 'audio.Whisper', 'audio.whisper.large', 'audio-x.y'])
      expect(jobLaneSchema.safeParse(lane).success).toBe(false);
    expect(jobLaneSchema.safeParse(`audio.${'w'.repeat(54)}`).success).toBe(true);
    expect(jobLaneSchema.safeParse(`audio.${'w'.repeat(55)}`).success).toBe(false);
  });

  it('keeps a kind’s lane, leaves a kind without one unlaned, and throws on a bad lane', () => {
    const io = { input: z.object({ path: z.string() }), output: z.null() };
    const embed = defineJobKind({
      kind: 'vision.embedAsset',
      ...io,
      resource: 'gpu',
      lane: 'vision.embedder',
    });
    expect(embed).toMatchObject({ resource: 'gpu', lane: 'vision.embedder', priority: 'normal' });
    const hash = defineJobKind({ kind: 'library.hashAsset', ...io, resource: 'io' });
    expect('lane' in hash).toBe(false);
    expect(() =>
      defineJobKind({ kind: 'audio.transcribe', ...io, resource: 'gpu', lane: 'whisper' }),
    ).toThrow(/invalid lane 'whisper'/);
  });

  it('gives a lane the plan doesn’t name one job at a time', () => {
    expect(DEFAULT_LANE_LIMIT).toBe(1);
    expect(laneLimit(plan, 'audio.parakeet')).toBe(1);
    expect(laneLimit({ lanes: { 'models.llm': 2 } }, 'models.llm')).toBe(2);
  });

  it('validates a plan: every class once, budgets from 0, lanes from 1', () => {
    expect(jobConcurrencyPlanSchema.parse(plan)).toEqual(plan);
    expect(jobConcurrencyPlanSchema.safeParse({ ...plan, lanes: {} }).success).toBe(true);
    const classes = (patch: Record<string, unknown>) => ({ ...plan, classes: { ...plan.classes, ...patch } });
    expect(jobConcurrencyPlanSchema.safeParse(classes({ npu: 0 })).success).toBe(true);
    expect(jobConcurrencyPlanSchema.safeParse(classes({ gpu: -1 })).success).toBe(false);
    expect(jobConcurrencyPlanSchema.safeParse(classes({ gpu: 1.5 })).success).toBe(false);
    expect(jobConcurrencyPlanSchema.safeParse(classes({ tpu: 1 })).success).toBe(false);
    const { video: _video, ...noVideo } = plan.classes;
    expect(jobConcurrencyPlanSchema.safeParse({ ...plan, classes: noVideo }).success).toBe(false);
    expect(jobConcurrencyPlanSchema.safeParse({ ...plan, lanes: { 'audio.whisper': 0 } }).success).toBe(
      false,
    );
    expect(jobConcurrencyPlanSchema.safeParse({ ...plan, lanes: { whisper: 1 } }).success).toBe(false);
  });

  it('folds a class into another one step deep (LNX1: no Neural Engine, OCR on CUDA)', () => {
    const folded = { ...plan, foldInto: { npu: 'gpu' } } as const;
    expect(jobConcurrencyPlanSchema.parse(folded)).toEqual(folded);
    expect(budgetClass(folded, 'npu')).toBe('gpu');
    expect(budgetClass(folded, 'gpu')).toBe('gpu');
    expect(budgetClass(plan, 'npu')).toBe('npu');
    expect(jobConcurrencyPlanSchema.safeParse({ ...plan, foldInto: { npu: 'npu' } }).success).toBe(false);
    expect(
      jobConcurrencyPlanSchema.safeParse({ ...plan, foldInto: { npu: 'gpu', gpu: 'cpu' } }).success,
    ).toBe(false);
    expect(jobConcurrencyPlanSchema.safeParse({ ...plan, foldInto: { tpu: 'gpu' } }).success).toBe(false);
  });
});

describe('order key', () => {
  it('is a safe integer on a request, and optional', () => {
    const request = { kind: 'vision.embedAsset', input: { path: '/a.mov' } };
    expect(jobRequestSchema.parse(request)).toEqual(request);
    for (const orderKey of [0, 7, -3, Number.MAX_SAFE_INTEGER])
      expect(jobRequestSchema.parse({ ...request, orderKey })).toEqual({ ...request, orderKey });
    for (const orderKey of [1.5, 2 ** 53, '7', null, Number.NaN])
      expect(jobRequestSchema.safeParse({ ...request, orderKey }).success).toBe(false);
    expect(jobOrderKeySchema.safeParse(-(2 ** 53)).success).toBe(false);
  });

  it('reads records with a key, with null, and from before round IX unchanged', () => {
    const old = oldSnapshot();
    expect(jobSnapshotSchema.parse(old)).toEqual(old);
    expect('orderKey' in jobSnapshotSchema.parse(old)).toBe(false);
    expect(jobSnapshotSchema.parse({ ...old, orderKey: 12 }).orderKey).toBe(12);
    expect(jobSnapshotSchema.parse({ ...old, orderKey: null }).orderKey).toBeNull();
    expect(jobSnapshotSchema.safeParse({ ...old, orderKey: 0.5 }).success).toBe(false);
    expect(publicJobSnapshotSchema.parse({ ...old, orderKey: 3 }).orderKey).toBe(3);
    const record = { ...old, input: { path: '/a.mov' } };
    expect(jobRecordSchema.parse(record)).toEqual(record);
    expect(jobRecordSchema.parse({ ...record, orderKey: 4 })).toEqual({ ...record, orderKey: 4 });
  });

  it('crosses the enqueue contract both ways', async () => {
    const seen: JobRequest[] = [];
    const queue = {
      enqueue: async (request: JobRequest) => {
        seen.push(request);
        return ok({ ...oldSnapshot(), kind: request.kind, orderKey: request.orderKey ?? null });
      },
      cancel: async () => ok(oldSnapshot()),
    };
    const { port1, port2 } = channel();
    serveRpc(jobEnqueueRouter(queue), port1, { context: {} });
    const { client } = connectRpc(jobEnqueueContract, port2, { peer: 'jobs' });
    const enqueuer = jobEnqueuerOverRpc(() => client);

    const first = unwrap(await enqueuer.enqueue({ kind: 'vision.embedAsset', input: {}, orderKey: 5 }));
    expect(first.orderKey).toBe(5);
    const second = unwrap(await enqueuer.enqueue({ kind: 'vision.embedAsset', input: {} }));
    expect(second.orderKey).toBeNull();
    expect(seen.map((request) => request.orderKey)).toEqual([5, undefined]);
    const refused = await enqueuer.enqueue({ kind: 'vision.embedAsset', input: {}, orderKey: 0.5 });
    expect(!refused.ok && refused.error.code).toBe('core.validation');
  });
});
