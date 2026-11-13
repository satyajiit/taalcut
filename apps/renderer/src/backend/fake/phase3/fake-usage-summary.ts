// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Settings › Usage's dashboard data as the agent serves it (G8): `usage.summary` aggregates the cloud-call rows
 * over a period and filter (by local day in the request's time zone, job, provider and project), and
 * `usage.limits`/`usage.limitsChanged` are the limits the models client is waiting on. Tests and the preview set
 * the limits with `limits.set`.
 */
import type {
  CloudCallRecord,
  Money,
  ModelModuleId,
  ProjectId,
  UsageLimit,
  UsageSummary,
  UsageSummaryInput,
} from '@taalcut/core';
import { watched, type Watched } from '../watch';

type Units = UsageSummary['totals']['units'];
type Row = { calls: number; inputTokens: number; outputTokens: number; costUsd: number; units: Units };

const DAY = 86_400_000;
const blank = (): Row => ({ calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, units: {} });

function add(row: Row, record: CloudCallRecord): void {
  row.calls += 1;
  row.inputTokens += record.inputTokens + record.cachedInputTokens;
  row.outputTokens += record.outputTokens;
  row.costUsd += record.costUsd;
  if (record.billed && record.billed.unit !== 'token')
    row.units[record.billed.unit] = (row.units[record.billed.unit] ?? 0) + record.billed.quantity;
}

/** 'YYYY-MM-DD' for an instant in a time zone (en-CA writes ISO order). */
function dayIn(timeZone: string): (at: number) => string {
  const format = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return (at) => format.format(new Date(at));
}

export function summarizeUsage(
  rows: readonly CloudCallRecord[],
  input: UsageSummaryInput,
  capOf: (projectId: ProjectId) => Money | null,
): UsageSummary {
  const matching = rows.filter(
    (r) =>
      r.startedAt >= input.from &&
      r.startedAt <= input.to &&
      (input.module === undefined || r.module === input.module) &&
      (input.provider === undefined || r.provider === input.provider) &&
      (input.projectId === undefined || r.projectId === input.projectId),
  );
  const day = dayIn(input.timeZone);
  const days = new Map<
    string,
    { costUsd: number; calls: number; byModule: Partial<Record<ModelModuleId, number>> }
  >();
  // Every day of the period, so a quiet day is a gap in the chart rather than a missing bar (at most 400).
  const first = Math.max(input.from, input.to - 399 * DAY);
  for (let at = first; at <= input.to + DAY - 1; at += DAY) {
    const key = day(Math.min(at, input.to));
    if (!days.has(key)) days.set(key, { costUsd: 0, calls: 0, byModule: {} });
  }
  const totals = { ...blank(), localCalls: 0, cachedInputTokens: 0, bytesSent: 0 };
  const modules = new Map<ModelModuleId, Row>();
  const providers = new Map<string, Row & { local: boolean }>();
  const projects = new Map<ProjectId | null, Row>();
  for (const record of matching) {
    add(totals, record);
    totals.inputTokens -= record.cachedInputTokens;
    totals.cachedInputTokens += record.cachedInputTokens;
    totals.bytesSent += record.bytesSent;
    if (record.local) totals.localCalls += 1;
    const bucket = days.get(day(record.startedAt));
    if (bucket) {
      bucket.calls += 1;
      bucket.costUsd += record.costUsd;
      bucket.byModule[record.module] = (bucket.byModule[record.module] ?? 0) + record.costUsd;
    }
    const module = modules.get(record.module) ?? blank();
    add(module, record);
    modules.set(record.module, module);
    const provider = providers.get(record.provider) ?? { ...blank(), local: record.local };
    add(provider, record);
    providers.set(record.provider, provider);
    const projectKey = record.projectId ?? null;
    const project = projects.get(projectKey) ?? blank();
    add(project, record);
    projects.set(projectKey, project);
  }
  const byCost = <T extends { costUsd: number; calls: number }>(a: T, b: T) =>
    b.costUsd - a.costUsd || b.calls - a.calls;
  return {
    from: input.from,
    to: input.to,
    totals,
    byDay: [...days].map(([key, value]) => ({ day: key, ...value })).slice(-400),
    byModule: [...modules].map(([module, row]) => ({ module, ...row })).sort(byCost),
    byProvider: [...providers].map(([provider, row]) => ({ provider, ...row })).sort(byCost),
    byProject: [...projects]
      .map(([projectId, row]) => ({ projectId, cap: projectId ? capOf(projectId) : null, ...row }))
      .sort(byCost),
  };
}

export const LIMIT_SCENARIOS = ['none', 'one', 'three'] as const;
export type LimitScenario = (typeof LIMIT_SCENARIOS)[number];

function seedLimits(scenario: LimitScenario, now: number): UsageLimit[] {
  const plan: UsageLimit = {
    provider: 'openai-codex',
    model: 'gpt-5.4',
    modules: ['agent'],
    kind: 'plan',
    since: now - 10 * 60_000,
    resetsAt: now + 38 * 60_000,
    waiting: ['run'],
  };
  if (scenario === 'one') return [plan];
  if (scenario === 'none') return [];
  return [
    plan,
    {
      provider: 'openai',
      modules: ['images'],
      kind: 'quota',
      since: now - 3 * 3_600_000,
      resetsAt: null,
      waiting: [],
      billingUrl: 'https://platform.openai.com/settings/organization/billing',
    },
    {
      provider: 'xai',
      model: 'grok-4.1-fast',
      modules: ['vision'],
      kind: 'rate',
      since: now - 60_000,
      resetsAt: now + 2 * 3_600_000 + 20 * 60_000,
      waiting: ['background'],
    },
  ];
}

export interface FakeLimits {
  readonly watch: Watched<readonly UsageLimit[]>;
  set(limits: readonly UsageLimit[]): void;
}

export function createFakeLimits(now: () => number, scenario: LimitScenario = 'none'): FakeLimits {
  let limits: readonly UsageLimit[] = seedLimits(scenario, now());
  const watch = watched(() => limits);
  return {
    watch,
    set(next) {
      limits = next;
      watch.notify();
    },
  };
}
