// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * One attempt of one claimed job: runs the handler with an AbortSignal and a
 * throttled progress reporter, keeps the lease alive with heartbeats, and
 * records the outcome (complete, retry with backoff, fail, or release).
 */
import {
  CancelledError,
  err,
  isTaalcutError,
  retryDelay,
  TimeoutError,
  toTaalcutError,
  ValidationError,
  type Result,
  type TaalcutError,
} from '@taalcut/core';
import { isResult, type JobContext, type JobDefinition } from './definition';
import { JobHandlerFailed, JobOutputInvalid } from './errors';
import { backoffDelay, type BackoffPolicy } from './policy';
import type { JobStore, MaybePromise } from './ports';
import { ThrottledProgress } from './progress';
import { summarize, type JobEvent, type JobRecord, type ReleaseReason } from './types';

/** What a run needs from its engine. */
export interface RunContext {
  readonly store: JobStore;
  readonly owner: string;
  readonly leaseMs: number;
  readonly heartbeatMs: number;
  readonly progressIntervalMs: number;
  readonly backoff: BackoffPolicy;
  readonly clock: () => number;
  readonly random: () => number;
  emit(event: JobEvent): void;
  /** Asks the engine to look for due jobs again at `time` (a retry's backoff ends). */
  wakeAt(time: number): void;
}

export type AbortReason = 'paused' | 'cancelled' | 'lease_lost' | 'timeout' | ReleaseReason;

type Outcome = { ok: true; value: unknown } | { ok: false; error: TaalcutError; retryable: boolean };

const STORE_RETRIES = 3;

/**
 * Calls the store, retrying retryable errors (database busy) briefly. A store
 * that throws is reported as an Err rather than crashing the engine.
 */
export async function callStore<T>(fn: () => MaybePromise<Result<T>>): Promise<Result<T>> {
  for (let attempt = 1; ; attempt++) {
    let result: Result<T>;
    try {
      result = await fn();
    } catch (cause) {
      return err(toTaalcutError(cause));
    }
    if (result.ok || !result.error.retryable || attempt >= STORE_RETRIES) return result;
    await new Promise((resolve) => setTimeout(resolve, 25 * attempt));
  }
}

/**
 * What a handler's throw becomes. Only the error's name goes in `detail`: the
 * message can carry a secret (a URL with a token, a header), and `detail`
 * travels in `job.failed` events and is stored with the job.
 */
function failure(thrown: unknown, kind: string): Outcome {
  if (isTaalcutError(thrown)) return { ok: false, error: thrown, retryable: thrown.retryable };
  const detail = thrown instanceof Error ? `threw ${thrown.name}` : `threw a ${typeof thrown}`;
  return { ok: false, error: JobHandlerFailed({ kind }, { detail }), retryable: true };
}

export class JobRun {
  readonly done: Promise<void>;
  private readonly controller = new AbortController();
  private readonly progress: ThrottledProgress;
  private reason: AbortReason | undefined;
  private released = false;
  private beating = false;
  private leaseHeld = true;

  /** @param after An earlier local attempt at the same job that must finish before this one starts. */
  constructor(
    readonly record: JobRecord,
    readonly definition: JobDefinition<unknown, unknown>,
    private readonly ctx: RunContext,
    after?: Promise<void>,
  ) {
    this.progress = new ThrottledProgress(ctx.progressIntervalMs, (value) =>
      ctx.emit({
        type: 'job.progress',
        jobId: record.id,
        kind: record.kind,
        fraction: value.fraction,
        ...(value.detail !== undefined ? { detail: value.detail } : {}),
      }),
    );
    this.done = this.execute(after);
  }

  /** True while the store still has this run's owner on the job, as far as this run knows. */
  private holdsLease(): boolean {
    const gone = this.reason === 'paused' || this.reason === 'cancelled' || this.reason === 'lease_lost';
    return this.leaseHeld && !gone;
  }

  /** Stops the handler. The first reason wins; the outcome is then handled by reason. */
  abort(reason: AbortReason): void {
    if (this.reason) return;
    this.reason = reason;
    const ms = this.definition.timeoutMs ?? 0;
    this.controller.abort(
      reason === 'timeout' ? TimeoutError({ ms }) : CancelledError(undefined, { detail: reason }),
    );
  }

  /** Hands the job back to the queue now, for a handler that ignores its signal at shutdown. */
  async release(reason: ReleaseReason): Promise<void> {
    if (this.released) return;
    this.released = true;
    const released = await callStore(() => this.ctx.store.release(this.record.id, this.ctx.owner));
    if (released.ok) this.ctx.emit({ type: 'job.released', job: summarize(released.value), reason });
  }

  private async execute(after: Promise<void> | undefined): Promise<void> {
    const heartbeat = setInterval(() => void this.beat(), this.ctx.heartbeatMs);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let outcome: Outcome;
    try {
      // An earlier attempt at this job in this process (aborted, its handler not yet returned)
      // finishes first, while this run holds the lease: one live attempt per job.
      if (after) await after;
      this.ctx.emit({ type: 'job.started', job: summarize(this.record) });
      const timeoutMs = this.definition.timeoutMs;
      timeout = timeoutMs ? setTimeout(() => this.abort('timeout'), timeoutMs) : undefined;
      outcome = this.reason
        ? { ok: false, error: CancelledError(undefined, { detail: this.reason }), retryable: false }
        : await this.invoke();
    } finally {
      clearInterval(heartbeat);
      clearTimeout(timeout);
      this.progress.close();
    }
    await this.settle(outcome);
  }

  private async invoke(): Promise<Outcome> {
    const { record, definition } = this;
    let payload: unknown = record.payload;
    if (definition.payload) {
      const parsed = definition.payload.safeParse(record.payload);
      if (!parsed.success) {
        return {
          ok: false,
          error: ValidationError({ field: 'payload' }, { detail: parsed.error.message }),
          retryable: false,
        };
      }
      payload = parsed.data;
    }
    const context: JobContext = {
      jobId: record.id,
      kind: record.kind,
      attempt: record.attempts,
      maxAttempts: record.maxAttempts,
      projectId: record.projectId,
      resumeFrom:
        record.progress === null && record.progressDetail == null
          ? null
          : { fraction: record.progress, detail: record.progressDetail ?? undefined },
    };
    let value: unknown;
    try {
      const out = await definition.handler(payload, this.controller.signal, this.progress, context);
      if (!isResult(out)) value = out;
      else if (out.ok) value = out.value;
      else return failure(out.error, record.kind);
    } catch (thrown) {
      return failure(thrown, record.kind);
    }
    return definition.result ? this.checkResult(definition.result, value) : { ok: true, value };
  }

  /** The result as the store will hold it (JSON), checked against the kind's output schema. */
  private checkResult(schema: NonNullable<JobDefinition['result']>, value: unknown): Outcome {
    let stored: unknown;
    try {
      stored = JSON.parse(JSON.stringify(value) ?? 'null');
    } catch (cause) {
      stored = cause; // Not serialisable (a cycle, a BigInt): the schema check below fails with the reason.
    }
    const parsed = schema.safeParse(stored);
    if (parsed.success) return { ok: true, value: parsed.data };
    const detail = `result failed its schema: ${parsed.error.message}`;
    return { ok: false, error: JobOutputInvalid({ kind: this.record.kind }, { detail }), retryable: false };
  }

  /** When to try again after `error`, or undefined to give up. */
  private retryAt(error: TaalcutError, retryable: boolean): number | undefined {
    const { record, definition, ctx } = this;
    if (!retryable || record.attempts >= record.maxAttempts) return undefined;
    if (definition.retryPolicy) {
      const policy = { ...definition.retryPolicy, maxAttempts: record.maxAttempts };
      const delay = retryDelay(policy, record.attempts, { ...error, retryable: true }, ctx.random);
      return delay === null ? undefined : ctx.clock() + delay;
    }
    const backoff = { ...ctx.backoff, ...definition.backoff };
    return ctx.clock() + backoffDelay(record.attempts, backoff, ctx.random);
  }

  private async settle(outcome: Outcome): Promise<void> {
    const { record, ctx } = this;
    switch (this.reason) {
      case 'paused':
      case 'cancelled':
      case 'lease_lost':
        return; // The store already says what happened; this engine no longer holds the job.
      case 'shutdown':
      case 'queue_paused':
        return this.release(this.reason);
      case 'timeout':
        // Whatever the handler returned after its time was up, the attempt timed out.
        outcome = { ok: false, error: TimeoutError({ ms: this.definition.timeoutMs ?? 0 }), retryable: true };
        break;
    }
    if (outcome.ok) {
      const result = outcome.value;
      const done = await callStore(() => ctx.store.complete(record.id, ctx.owner, result ?? null));
      ctx.emit(done.ok ? { type: 'job.succeeded', job: summarize(done.value) } : this.lost());
      return;
    }
    const error = outcome.error;
    const retryAt = this.retryAt(error, outcome.retryable);
    const failed = await callStore(() =>
      ctx.store.fail(record.id, ctx.owner, error, retryAt === undefined ? {} : { retryAt }),
    );
    if (!failed.ok) return ctx.emit(this.lost());
    const willRetry = failed.value.state === 'queued';
    ctx.emit({
      type: 'job.failed',
      job: summarize(failed.value),
      error,
      willRetry,
      retryAt: willRetry ? (retryAt ?? null) : null,
    });
    if (willRetry && retryAt !== undefined) ctx.wakeAt(retryAt);
  }

  private lost(): JobEvent {
    return { type: 'job.lease_lost', jobId: this.record.id, kind: this.record.kind };
  }

  /**
   * Renews the lease and saves the latest progress. Losing the lease aborts
   * the handler. After a timeout, shutdown or queue pause this run still
   * holds the job until the handler returns and the outcome is written, so
   * it keeps beating: an expired lease would let the job start again while
   * this handler is still running.
   */
  private async beat(): Promise<void> {
    if (this.beating || !this.holdsLease()) return;
    this.beating = true;
    try {
      const p = this.progress.takeUnsaved();
      const update = p
        ? { leaseMs: this.ctx.leaseMs, progress: p.fraction, progressDetail: p.detail ?? null }
        : { leaseMs: this.ctx.leaseMs };
      const beat = await callStore(() => this.ctx.store.heartbeat(this.record.id, this.ctx.owner, update));
      if (!beat.ok && !beat.error.retryable) {
        const first = !this.reason;
        this.leaseHeld = false;
        this.abort('lease_lost');
        if (first) this.ctx.emit(this.lost());
      }
    } finally {
      this.beating = false;
    }
  }
}
