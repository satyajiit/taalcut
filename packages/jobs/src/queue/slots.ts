// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Who may start next (round IX, design A). Each resource class has a budget that all its jobs share: the
 * plan's, lowered by the power throttle. A job kind's lane (the model or process its jobs load, core's
 * `JobKind.lane`) has its own limit inside that budget, so the embedder and whisper can share the GPU
 * while neither runs two jobs at once. The throttle lowers class budgets only; a lane never runs more
 * than its class allows. Running jobs are never interrupted: a lower budget applies to what starts next.
 *
 * A class the plan folds into another (core's `foldInto`, LNX1: `npu` into `gpu` where there's no Neural Engine)
 * draws on that class's budget: its jobs and the target's count together against the target's budget, after the
 * throttle. The folded class's own budget is ignored; its lanes keep their limits.
 */
import { budgetClass, laneLimit, type JobConcurrencyPlan, type JobLane } from '@taalcut/core';
import type { ThrottlePolicy } from './policy';
import {
  RESOURCE_CLASSES,
  type ConcurrencyLimits,
  type LaneLimits,
  type PowerSnapshot,
  type ResourceClass,
} from './types';

/** A running job, as far as limits go. */
export interface SlotHolder {
  readonly resourceClass: ResourceClass;
  readonly lane?: JobLane | undefined;
}

/** A registered kind, as far as limits go. */
export interface SlotKind {
  readonly kind: string;
  readonly lane?: JobLane | undefined;
}

/** The base plan: class budgets before the throttle, lane limits, and the classes that share another's budget. */
export interface SlotPlan {
  readonly classes: ConcurrencyLimits;
  readonly lanes: LaneLimits;
  readonly foldInto?: JobConcurrencyPlan['foldInto'];
}

const copyPlan = (plan: SlotPlan): SlotPlan => ({
  classes: { ...plan.classes },
  lanes: { ...plan.lanes },
  ...(plan.foldInto ? { foldInto: { ...plan.foldInto } } : {}),
});

const sameFolds = (a: SlotPlan['foldInto'], b: SlotPlan['foldInto']): boolean =>
  RESOURCE_CLASSES.every((rc) => a?.[rc] === b?.[rc]);

const sameLanes = (a: LaneLimits, b: LaneLimits): boolean => {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].every((lane) => a[lane] === b[lane]);
};

const sameClasses = (a: ConcurrencyLimits, b: ConcurrencyLimits): boolean =>
  RESOURCE_CLASSES.every((rc) => a[rc] === b[rc]);

export class Slots {
  private plan: SlotPlan;
  private current: ConcurrencyLimits;

  constructor(
    plan: SlotPlan,
    private readonly throttle: ThrottlePolicy,
    private readonly power: () => PowerSnapshot,
  ) {
    this.plan = copyPlan(plan);
    this.current = this.throttled();
  }

  /** Class budgets after the throttle. */
  limits(): ConcurrencyLimits {
    return this.current;
  }

  /** Lane limits as planned (a lane not named runs DEFAULT_LANE_LIMIT at once). */
  laneLimits(): LaneLimits {
    return this.plan.lanes;
  }

  /** Classes folded into another's budget (none: every class has its own). */
  folds(): SlotPlan['foldInto'] {
    return this.plan.foldInto;
  }

  /** Replaces the plan. True when the budgets after the throttle, the lane limits or the folds changed. */
  setPlan(plan: SlotPlan): boolean {
    const lanesChanged = !sameLanes(this.plan.lanes, plan.lanes);
    const foldsChanged = !sameFolds(this.plan.foldInto, plan.foldInto);
    this.plan = copyPlan(plan);
    return this.refresh() || lanesChanged || foldsChanged;
  }

  /** Applies the throttle to the power state now. True when a class budget changed. */
  refresh(): boolean {
    const next = this.throttled();
    const changed = !sameClasses(next, this.current);
    this.current = next;
    return changed;
  }

  /**
   * The budgets jobs are claimed in: each class whose budget is its own, first, with the classes folded into it.
   * Without folds, one pool per class in RESOURCE_CLASSES order.
   */
  pools(): (readonly [ResourceClass, ...ResourceClass[]])[] {
    return RESOURCE_CLASSES.filter((rc) => budgetClass(this.plan, rc) === rc).map((root) => [
      root,
      ...RESOURCE_CLASSES.filter((rc) => rc !== root && budgetClass(this.plan, rc) === root),
    ]);
  }

  /** Whether one more job of `resourceClass` may start beside `holders`, in the budget it draws on. */
  classHasRoom(resourceClass: ResourceClass, holders: Iterable<SlotHolder>): boolean {
    const pool = budgetClass(this.plan, resourceClass);
    let busy = 0;
    for (const holder of holders) if (budgetClass(this.plan, holder.resourceClass) === pool) busy++;
    return busy < this.current[pool];
  }

  /** The kinds that may start beside `holders` as far as lanes go: no lane, or a lane with room. */
  claimableKinds(kinds: Iterable<SlotKind>, holders: Iterable<SlotHolder>): string[] {
    const busy = new Map<JobLane, number>();
    for (const { lane } of holders) if (lane !== undefined) busy.set(lane, (busy.get(lane) ?? 0) + 1);
    const out: string[] = [];
    for (const { kind, lane } of kinds) {
      if (lane === undefined || (busy.get(lane) ?? 0) < laneLimit(this.plan, lane)) out.push(kind);
    }
    return out;
  }

  private throttled(): ConcurrencyLimits {
    return this.throttle(this.plan.classes, this.power());
  }
}
