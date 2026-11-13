// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The durable job engine (PRD G7, plan P1-E1). It claims due jobs from the
 * JobStore within per-class budgets (lowered on battery and under thermal
 * pressure) and per-lane limits inside them (slots.ts), runs their handlers,
 * and reclaims jobs whose worker died. One engine per process; several
 * processes can share one store, unless the engine is `exclusive` (takeover.ts).
 */
import { err, ValidationError, type JobConcurrencyPlan, type JobId, type Result } from '@taalcut/core';
import type { EnqueueOptions, JobEngine, JobEngineOptions, WaitOptions } from './api';
import { ChildJobs } from './children';
import { createRunContext } from './context';
import type { JobDefinition } from './definition';
import { UnknownJobKind } from './errors';
import { DEFAULT_CONCURRENCY, defaultThrottle } from './policy';
import { STEADY_POWER, type JobClaim, type JobEnqueueInput, type PowerState } from './ports';
import { callStore, JobRun, type RunContext } from './run';
import { Slots, type SlotHolder } from './slots';
import { takeOverLeases } from './takeover';
import { boundedStep, EngineTimers, settleWithin } from './timers';
import { Waiters } from './wait';
import {
  summarize,
  type ConcurrencyLimits,
  type JobRecord,
  type JobSummary,
  type LaneLimits,
  type ResourceClass,
} from './types';

export function createJobEngine(options: JobEngineOptions): JobEngine {
  return new Engine(options);
}

const ABORT_WAIT_MS = 1000;
const AFTER_JOB_MS = 250;

class Engine implements JobEngine {
  private readonly definitions = new Map<string, JobDefinition<unknown, unknown>>();
  private readonly runs = new Map<JobId, JobRun>();
  private readonly orphans = new Set<JobRun>();
  /** Each run until its slot is free again: its handler returned, the outcome is stored, `afterJob` ran. */
  private readonly finished = new Map<JobRun, Promise<void>>();
  private readonly waiters = new Waiters();
  /** Running jobs' children, claimed by id outside their class's limit (children.ts). */
  private readonly children = new ChildJobs({
    running: (id) => this.runs.has(id),
    active: () => this.status === 'running' && !this.pausedAll,
    claim: (id) => this.claimOne({ kinds: [...this.definitions.keys()], ids: [id] }),
    launch: (record) => this.launch(record),
    storeError: (error) => this.ctx.emit({ type: 'queue.store_error', error }),
    wake: () => void this.pump(),
  });
  private readonly timers = new EngineTimers(() => this.status === 'running');
  private readonly ctx: RunContext;
  private readonly power: PowerState;
  private readonly slots: Slots;
  private status: 'idle' | 'running' | 'stopping' | 'stopped' = 'idle';
  private pausedAll: boolean;
  private pumping: Promise<void> | undefined;
  private pumpAgain = false;
  private unsubscribe: (() => void) | undefined;

  constructor(private readonly options: JobEngineOptions) {
    this.ctx = createRunContext(options, {
      notify: (event) => this.waiters.notify(event),
      later: (ms, fn) => this.timers.later(ms, fn),
      pump: () => void this.pump(),
    });
    this.power = options.power ?? STEADY_POWER;
    this.slots = new Slots(
      { classes: { ...DEFAULT_CONCURRENCY, ...options.concurrency }, lanes: options.lanes ?? {} },
      options.throttle ?? defaultThrottle,
      () => ({ onBattery: this.power.onBattery, thermalState: this.power.thermalState }),
    );
    this.pausedAll = options.startPaused ?? false;
  }

  get paused(): boolean {
    return this.pausedAll;
  }

  get bootId(): string {
    return this.ctx.owner;
  }

  register<P, R>(definition: JobDefinition<P, R>): void {
    if (this.definitions.has(definition.kind))
      throw new Error(`Job kind '${definition.kind}' is registered twice`);
    this.definitions.set(definition.kind, definition as unknown as JobDefinition<unknown, unknown>);
    if (this.status === 'running') void this.pump();
  }

  async start(): Promise<void> {
    if (this.status === 'running') return;
    if (this.status !== 'idle') throw new Error('A stopped job engine cannot be restarted; create a new one');
    this.status = 'running';
    this.unsubscribe = this.power.onChange(() => this.onPowerChange());
    if (this.options.exclusive)
      await takeOverLeases(this.ctx, { freeRestarts: this.options.freeRestarts ?? 2, log: this.log });
    await this.recover();
    this.timers.every(this.options.pollMs ?? 1000, () => void this.pump());
    this.timers.every(this.ctx.leaseMs, () => void this.recover().then(() => this.pump()));
    await this.pump();
  }

  async stop(options: { graceMs?: number } = {}): Promise<void> {
    if (this.status === 'stopped' || this.status === 'stopping') return;
    this.status = 'stopping';
    this.timers.clear();
    this.unsubscribe?.();
    await this.pumping;
    await settleWithin(this.dones(true), options.graceMs ?? this.options.shutdownGraceMs ?? 10_000);
    for (const run of this.runs.values()) run.abort('shutdown');
    await settleWithin(this.dones(true), ABORT_WAIT_MS);
    // Handlers that ignored the abort: hand their jobs back anyway.
    await Promise.all([...this.runs.values()].map((run) => run.release('shutdown')));
    this.status = 'stopped';
  }

  async enqueue<P>(
    job: string | JobDefinition<P, unknown>,
    payload: P,
    options: EnqueueOptions = {},
  ): Promise<Result<{ job: JobRecord; created: boolean }>> {
    const definition: JobDefinition<unknown, unknown> | undefined =
      typeof job === 'string'
        ? this.definitions.get(job)
        : (job as unknown as JobDefinition<unknown, unknown>);
    if (!definition) return err(UnknownJobKind({ kind: String(job) }));
    let value: unknown = payload;
    if (definition.payload) {
      const parsed = definition.payload.safeParse(payload);
      if (!parsed.success)
        return err(ValidationError({ field: 'payload' }, { detail: parsed.error.message }));
      value = parsed.data;
    }
    const idempotencyKey = options.idempotencyKey ?? definition.idempotencyKey?.(value);
    const input: JobEnqueueInput = {
      kind: definition.kind,
      payload: value,
      resourceClass: definition.resourceClass,
      priority: options.priority ?? definition.priority ?? 0,
      maxAttempts: options.maxAttempts ?? definition.maxAttempts ?? 3,
      ...(options.id ? { id: options.id } : {}),
      ...(idempotencyKey ? { idempotencyKey } : {}),
      ...(options.runAt !== undefined ? { runAt: options.runAt } : {}),
      ...(options.projectId !== undefined ? { projectId: options.projectId } : {}),
      ...(options.orderKey !== undefined ? { orderKey: options.orderKey } : {}),
    };
    const stored = await callStore(() => this.ctx.store.enqueue(input));
    this.children.adopt(stored, options.parentJobId);
    if (stored.ok && stored.value.created) {
      this.ctx.emit({ type: 'job.enqueued', job: summarize(stored.value.job) });
      if (options.runAt !== undefined) this.ctx.wakeAt(options.runAt);
      void this.pump();
    }
    return stored;
  }

  async pause(id: JobId): Promise<Result<JobRecord>> {
    const paused = await callStore(() => this.ctx.store.pause(id));
    if (paused.ok) {
      this.runs.get(id)?.abort('paused');
      this.ctx.emit({ type: 'job.paused', job: summarize(paused.value) });
    }
    return paused;
  }

  async resume(id: JobId): Promise<Result<JobRecord>> {
    const resumed = await callStore(() => this.ctx.store.resume(id));
    if (resumed.ok) {
      this.ctx.emit({ type: 'job.resumed', job: summarize(resumed.value) });
      void this.pump();
    }
    return resumed;
  }

  async cancel(id: JobId): Promise<Result<JobRecord>> {
    const cancelled = await callStore(() => this.ctx.store.cancel(id));
    if (cancelled.ok) {
      this.runs.get(id)?.abort('cancelled');
      this.ctx.emit({ type: 'job.cancelled', job: summarize(cancelled.value) });
    }
    return cancelled;
  }

  wait(id: JobId, options: WaitOptions = {}): Promise<Result<JobRecord>> {
    return this.waiters.wait(id, options, {
      get: () => callStore(() => this.ctx.store.get(id)),
      cancel: () => this.cancel(id),
      pollMs: this.options.pollMs ?? 1000,
    });
  }

  async pauseAll(): Promise<void> {
    if (this.pausedAll) return;
    this.pausedAll = true;
    this.ctx.emit({ type: 'queue.paused' });
    for (const run of this.runs.values()) run.abort('queue_paused');
    await Promise.all(this.dones());
  }

  resumeAll(): void {
    if (!this.pausedAll) return;
    this.pausedAll = false;
    this.ctx.emit({ type: 'queue.resumed' });
    void this.pump();
  }

  limits(): ConcurrencyLimits {
    return this.slots.limits();
  }

  laneLimits(): LaneLimits {
    return this.slots.laneLimits();
  }

  applyPlan(plan: JobConcurrencyPlan): void {
    if (!this.slots.setPlan(plan)) return;
    this.limitsChanged();
  }

  running(): JobSummary[] {
    return [...this.runs.values()].map((run) => summarize(run.record));
  }

  async whenIdle(): Promise<void> {
    for (;;) {
      await this.pump();
      if (this.runs.size === 0) return;
      await Promise.all(this.dones());
    }
  }

  /** Claims due jobs while each resource class has room. Concurrent calls share one pass. */
  private pump(): Promise<void> {
    if (this.pumping) {
      this.pumpAgain = true;
      return this.pumping;
    }
    this.pumping = this.claimLoop().finally(() => (this.pumping = undefined));
    return this.pumping;
  }

  private async claimLoop(): Promise<void> {
    do {
      this.pumpAgain = false;
      if (this.definitions.size === 0) return;
      await this.children.claim();
      for (const pool of this.slots.pools()) await this.claimPool(pool);
    } while (this.pumpAgain);
  }

  /**
   * Claims while the pool's budget has room. Kinds whose lane is full are left out: they never hold up another
   * lane. A pool of folded classes (npu in gpu, LNX1) claims across its classes' kinds in the store's order
   * (priority, then order key), so one class can't starve the other by coming first.
   */
  private async claimPool(pool: readonly [ResourceClass, ...ResourceClass[]]): Promise<void> {
    const [resourceClass] = pool;
    const definitions = [...this.definitions.values()];
    const members = pool.length > 1 ? definitions.filter((d) => pool.includes(d.resourceClass)) : definitions;
    while (this.canClaim(resourceClass)) {
      const kinds = this.slots.claimableKinds(members, this.holders());
      if (kinds.length === 0) return;
      const claimed = await this.claimOne(pool.length > 1 ? { kinds } : { resourceClass, kinds });
      if (!claimed.ok) return this.ctx.emit({ type: 'queue.store_error', error: claimed.error });
      if (!claimed.value) return;
      this.launch(claimed.value);
    }
  }

  private claimOne(filter: Omit<JobClaim, 'owner' | 'leaseMs'>) {
    const { owner, leaseMs } = this.ctx;
    return callStore(() => this.ctx.store.claimNext({ owner, leaseMs, ...filter }));
  }

  private canClaim(resourceClass: ResourceClass): boolean {
    if (this.status !== 'running' || this.pausedAll) return false;
    return this.slots.classHasRoom(resourceClass, this.holders());
  }

  /** What holds a slot: running jobs, and aborted runs whose handler hasn't returned yet. */
  private holders(): SlotHolder[] {
    return [...this.runs.values(), ...this.orphans].map((run) => ({
      resourceClass: run.record.resourceClass,
      lane: run.definition.lane,
    }));
  }

  private launch(record: JobRecord): void {
    const definition = this.definitions.get(record.kind)!; // claims are filtered to registered kinds
    this.orphan(record.id);
    // A handler still running from an earlier attempt at this job finishes before the new attempt starts.
    const earlier = [...this.orphans]
      .filter((stale) => stale.record.id === record.id)
      .map((stale) => stale.done);
    const after = earlier.length > 0 ? Promise.all(earlier).then(() => undefined) : undefined;
    const run = new JobRun(record, definition, this.ctx, after);
    this.runs.set(record.id, run);
    // The slot stays taken until the after-job step is done, so the next claim sees what it enqueued.
    const finished = run.done
      .then(() => this.afterJob(record.id))
      .finally(() => {
        this.finished.delete(run);
        if (this.runs.get(record.id) === run) this.runs.delete(record.id);
        this.orphans.delete(run);
        if (this.status === 'running') void this.pump();
      });
    this.finished.set(run, finished);
  }

  /** The `afterJob` option, bounded: a slow or failing step delays the next claim by AFTER_JOB_MS at most. */
  private afterJob(id: JobId): Promise<void> {
    if (this.status !== 'running') return Promise.resolve();
    return boundedStep(this.options.afterJob, id, this.options.afterJobMs ?? AFTER_JOB_MS, this.log);
  }

  private readonly log = (message: string): void =>
    (this.options.log ?? ((line: string) => console.warn(`[jobs] ${line}`)))(message);

  /** A local run that no longer holds its job (its lease expired and was reclaimed): abort it, stop counting it. */
  private orphan(id: JobId): void {
    const stale = this.runs.get(id);
    if (!stale) return;
    stale.abort('lease_lost');
    this.runs.delete(id);
    this.orphans.add(stale);
  }

  private async recover(): Promise<void> {
    const recovered = await callStore(() => this.ctx.store.recoverExpiredLeases());
    if (!recovered.ok) return this.ctx.emit({ type: 'queue.store_error', error: recovered.error });
    for (const job of recovered.value) {
      this.orphan(job.id);
      this.ctx.emit({ type: 'job.recovered', job: summarize(job) });
    }
  }

  private onPowerChange(): void {
    if (this.slots.refresh()) this.limitsChanged();
  }

  private limitsChanged(): void {
    const power = { onBattery: this.power.onBattery, thermalState: this.power.thermalState };
    const { slots } = this;
    const folds = slots.folds();
    this.ctx.emit({
      type: 'queue.limits_changed',
      limits: slots.limits(),
      lanes: slots.laneLimits(),
      ...(folds ? { foldInto: folds } : {}),
      power,
    });
    if (this.status === 'running') void this.pump();
  }

  /** Running jobs' completions, slots freed; with `orphans`, also aborted runs that haven't returned yet. */
  private dones(orphans = false): Promise<void>[] {
    const runs = [...this.runs.values(), ...(orphans ? this.orphans : [])];
    return runs.map((run) => this.finished.get(run) ?? run.done);
  }
}
