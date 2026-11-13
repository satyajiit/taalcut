// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The router's switch-on report (SPEC section 24, R23, P3-B11), folded from run logs, never asked of a model.
 * One decision is one routed act turn the main model answered. It agrees when the router's choice equals the
 * family of the turn's first domain tool call, or `none` when the turn called none; a timeout, an error or a
 * missing family is a disagreement and stays in the denominator (the error rate is printed beside it).
 *
 * Switch-on rule, as the plan writes it: agreement ≥ 90 % (point estimate, or a 95 % Wilson lower bound ≥ 90 %)
 * over at least 200 decisions, main-model prompt tokens per task down ≥ 30 % on the golden tasks (the
 * provider's own prompt-token counts, router tokens reported beside, never inside), and no golden task that
 * passed with the router off failing with it on. Both golden halves are judged over the whole off-set: an off task
 * with no on-run fails them. The report recommends; a person flips the setting.
 */
import type { AgentEvent } from '../events';
import { META_TOOLS } from '../meta-tools';
import { NONE_FAMILY } from './families';

export const ROUTER_GATE = { agreement: 0.9, tokenDrop: 0.3, minTasks: 200, z: 1.96 } as const;

/** One golden task run with the router off or on (tools/evals router writes these). */
export interface RouterGoldenRun {
  readonly taskId: string;
  /** The main model's prompt tokens for the task, from the provider's usage fields. */
  readonly promptTokens: number;
  readonly passed: boolean;
  /** The router's own input tokens (on only): reported beside the ratio. */
  readonly routerInputTokens?: number;
}

export interface RouterGolden {
  readonly off: readonly RouterGoldenRun[];
  readonly on: readonly RouterGoldenRun[];
}

export interface Interval {
  readonly low: number;
  readonly high: number;
}

export interface Agreement {
  readonly n: number;
  readonly matches: number;
  readonly estimate: number;
  readonly wilson: Interval;
}

export interface RouterReport {
  readonly id: string;
  readonly generatedAt: number;
  readonly agreement: Agreement;
  /** Decisions the router didn't answer: timeouts and errors (both counted as disagreements above). */
  readonly unanswered: { readonly timeouts: number; readonly errors: number; readonly rate: number };
  readonly overrides: number;
  /** Per router choice: how often the main model agreed when the router picked it (what a live family narrows). */
  readonly families: readonly ({ readonly family: string } & Agreement)[];
  /** Null when no golden runs were given: unmeasured, so the rule can't pass. */
  readonly tokens: {
    readonly tasks: number;
    readonly full: number;
    readonly routed: number;
    readonly drop: number;
    readonly routerInputTokens: number;
  } | null;
  /** Golden tasks that passed with the router off and failed with it on. */
  readonly flips: readonly string[];
  /**
   * Golden tasks run with the router off and never on. Any one leaves equal success and the token saving unproven:
   * an on-set that skips the tasks that would fail must not pass the rule (review M9).
   */
  readonly unpaired: readonly string[];
  readonly criteria: {
    readonly enoughTasks: boolean;
    readonly agreement: boolean;
    readonly tokens: boolean;
    readonly equalSuccess: boolean;
  };
  readonly recommended: boolean;
  /** Families that may go `live` once a person records the gate (empty unless recommended). */
  readonly liveFamilies: readonly string[];
  /** Families that stay in shadow, and why the rule isn't met, in plain words for the beta gate report. */
  readonly reasons: readonly string[];
}

/** The 95 % Wilson score interval for k matches in n (z = 1.96). */
export function wilson(matches: number, n: number, z: number = ROUTER_GATE.z): Interval {
  if (n === 0) return { low: 0, high: 0 };
  const p = matches / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { low: Math.max(0, centre - half), high: Math.min(1, centre + half) };
}

interface Decision {
  readonly choice: string | undefined;
  readonly errored: boolean;
  readonly main: string;
}

/** A tool's family: its name's prefix ('media.probe' → 'media'), as core's defineTool defaults it. */
const prefixFamily = (tool: string) => tool.split('.')[0] ?? tool;

/** The decisions in one run's log whose turn the main model answered. */
export function routerDecisions(
  events: readonly AgentEvent[],
  familyOf: (tool: string) => string = prefixFamily,
): Decision[] {
  const responded = new Set<string>();
  const mains = new Map<string, string>();
  for (const event of events) {
    if (event.type === 'model.responded') responded.add(event.payload.modelCallId);
    if (event.type !== 'tool.requested' || event.payload.meta || META_TOOLS.includes(event.payload.tool))
      continue;
    if (!mains.has(event.payload.modelCallId))
      mains.set(event.payload.modelCallId, familyOf(event.payload.tool));
  }
  return events.flatMap((event): Decision[] => {
    if (event.type !== 'route.shadow' && event.type !== 'route.timeout') return [];
    const id = event.payload.modelCallId;
    if (!responded.has(id)) return [];
    const main = mains.get(id) ?? NONE_FAMILY;
    return event.type === 'route.shadow'
      ? [{ choice: event.payload.router.choice, errored: false, main }]
      : [{ choice: undefined, errored: event.payload.errorCode !== undefined, main }];
  });
}

function agreementOf(decisions: readonly Decision[]): Agreement {
  const matches = decisions.filter((d) => d.choice === d.main).length;
  const n = decisions.length;
  return { n, matches, estimate: n === 0 ? 0 : matches / n, wilson: wilson(matches, n) };
}

export interface RouterReportOptions {
  readonly minTasks?: number;
  readonly familyOf?: (tool: string) => string;
  readonly now?: () => number;
  readonly id?: string;
}

export function routerReport(
  logs: readonly (readonly AgentEvent[])[],
  golden: RouterGolden | undefined,
  options: RouterReportOptions = {},
): RouterReport {
  const generatedAt = (options.now ?? Date.now)();
  const minTasks = options.minTasks ?? ROUTER_GATE.minTasks;
  const decisions = logs.flatMap((events) => routerDecisions(events, options.familyOf));
  const overrides = logs.reduce(
    (sum, events) => sum + events.filter((e) => e.type === 'route.override').length,
    0,
  );
  const agreement = agreementOf(decisions);
  const timeouts = decisions.filter((d) => d.choice === undefined && !d.errored).length;
  const errors = decisions.filter((d) => d.errored).length;
  const chosen = [...new Set(decisions.flatMap((d) => (d.choice === undefined ? [] : [d.choice])))].sort();
  const families = chosen.map((family) => ({
    family,
    ...agreementOf(decisions.filter((d) => d.choice === family)),
  }));
  const tokens = golden ? tokenDrop(golden) : null;
  const flips = golden ? passToFail(golden) : [];
  const unpaired = golden ? unpairedTasks(golden) : [];
  const paired = golden !== undefined && unpaired.length === 0;
  const criteria = {
    enoughTasks: agreement.n >= minTasks,
    agreement:
      agreement.n >= minTasks &&
      (agreement.estimate >= ROUTER_GATE.agreement || agreement.wilson.low >= ROUTER_GATE.agreement),
    tokens: paired && tokens !== null && tokens.drop >= ROUTER_GATE.tokenDrop,
    equalSuccess: paired && flips.length === 0,
  };
  const recommended = criteria.agreement && criteria.tokens && criteria.equalSuccess;
  const liveFamilies = recommended
    ? families.filter((f) => f.estimate >= ROUTER_GATE.agreement).map((f) => f.family)
    : [];
  return {
    id: options.id ?? `router-${generatedAt}`,
    generatedAt,
    agreement,
    unanswered: { timeouts, errors, rate: agreement.n === 0 ? 0 : (timeouts + errors) / agreement.n },
    overrides,
    families,
    tokens,
    flips,
    unpaired,
    criteria,
    recommended,
    liveFamilies,
    reasons: reasons(agreement, criteria, tokens, { flips, unpaired }, families, liveFamilies, minTasks),
  };
}

/** Off-set task ids, sorted, whose off-run and on-run (undefined when the on-set skipped it) match `keep`. */
function offTasksWhere(
  golden: RouterGolden,
  keep: (off: RouterGoldenRun, on: RouterGoldenRun | undefined) => boolean,
): string[] {
  const on = new Map(golden.on.map((run) => [run.taskId, run]));
  return golden.off
    .filter((off) => keep(off, on.get(off.taskId)))
    .map((off) => off.taskId)
    .sort();
}

/** Off-set tasks the on-set never ran. */
function unpairedTasks(golden: RouterGolden): string[] {
  return offTasksWhere(golden, (_off, on) => on === undefined);
}

/** Tasks that passed with the router off and failed with it on. */
function passToFail(golden: RouterGolden): string[] {
  return offTasksWhere(golden, (off, on) => off.passed && on?.passed === false);
}

function tokenDrop(golden: RouterGolden): NonNullable<RouterReport['tokens']> {
  const on = new Map(golden.on.map((run) => [run.taskId, run]));
  const pairs = golden.off.flatMap((off) => {
    const routed = on.get(off.taskId);
    return routed ? [{ off, on: routed }] : [];
  });
  const full = pairs.reduce((sum, p) => sum + p.off.promptTokens, 0);
  const routed = pairs.reduce((sum, p) => sum + p.on.promptTokens, 0);
  return {
    tasks: pairs.length,
    full,
    routed,
    drop: full === 0 ? 0 : 1 - routed / full,
    routerInputTokens: pairs.reduce((sum, p) => sum + (p.on.routerInputTokens ?? 0), 0),
  };
}

const pct = (value: number) => `${(value * 100).toFixed(1)} %`;

function reasons(
  agreement: Agreement,
  criteria: RouterReport['criteria'],
  tokens: RouterReport['tokens'],
  { flips, unpaired }: Pick<RouterReport, 'flips' | 'unpaired'>,
  families: RouterReport['families'],
  live: readonly string[],
  minTasks: number,
): string[] {
  const out: string[] = [];
  out.push(
    `Agreement ${pct(agreement.estimate)} over ${agreement.n} decisions (95 % Wilson ${pct(agreement.wilson.low)} to ${pct(agreement.wilson.high)}).`,
  );
  if (!criteria.enoughTasks) out.push(`Fewer than ${minTasks} decisions: the router stays in shadow.`);
  else if (!criteria.agreement) out.push('Agreement is under 90 %: the router stays in shadow.');
  if (tokens === null) out.push('No golden runs: the token saving is unmeasured.');
  else if (!criteria.tokens)
    out.push(`Prompt tokens fell ${pct(tokens.drop)}, under the 30 % the rule needs.`);
  if (flips.length > 0) out.push(`Golden tasks that passed off and failed on: ${flips.join(', ')}.`);
  if (unpaired.length > 0)
    out.push(
      `${unpaired.length} golden tasks ran with the router off and never on (${unpaired.join(', ')}): ` +
        'equal success and the token saving are unproven.',
    );
  for (const family of families)
    if (!live.includes(family.family))
      out.push(`${family.family} stays in shadow (${pct(family.estimate)} of ${family.n}).`);
  return out;
}
