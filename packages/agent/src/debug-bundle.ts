// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The agent's half of the debug bundle (P2-X5, G16; SPEC section 15),
 * served as `UTILITY_CONTRACTS.agent.debugBundle.collect`. Main assembles the
 * whole bundle, scans it and sends or saves it. Sections: traces (spans
 * only, never prompt or output text), the chosen runs' event logs (redacted,
 * redact.ts), CloudCall rows (sizes, tokens, cost, outcome) and settings
 * (switches, caps, onboarding, standing consents). The agent holds no keys.
 */
import {
  CRASH_REPORTS_SETTING,
  DEFAULT_PROJECT_CAP_SETTING,
  debugBundleContract,
  debugSectionSchema,
  implementContract,
  LOCAL_ONLY_SETTING,
  ok,
  ONBOARDING_SETTING,
  TELEMETRY_SETTING,
  unwrapRpc,
  ValidationError,
  err,
  type AsyncResult,
  type Result,
  type CloudCallRecord,
  type DebugSection,
  type RunId,
  type SettingsStore,
} from '@taalcut/core';
import type { AgentEvent } from './events';
import type { ConsentStore } from './ports';
import { createRedactor, redactRunEvent, type RedactionCounts, type Redactor } from './redact';
import { buildTrace, toOtelSpans } from './trace';

export interface DebugBundleDeps {
  readonly log: { read(runId: RunId): AsyncResult<readonly AgentEvent[]> };
  /** The newest runs that started at or after `sinceMs`, newest first. */
  readonly recentRuns: (input: {
    readonly limit: number;
    readonly sinceMs: number;
  }) => AsyncResult<readonly RunId[]>;
  /** CloudCall rows that started at or after `sinceMs`. */
  readonly cloudCalls: (sinceMs: number) => AsyncResult<readonly CloudCallRecord[]>;
  readonly settings: SettingsStore;
  readonly consents: Pick<ConsentStore, 'list'>;
  /** More settings for the section (autonomy, the run budget, model profile state). Never keys. */
  readonly extraSettings?: () => Promise<Record<string, unknown>>;
  /** The home folder: anything under it is a path. */
  readonly home: string;
  readonly now?: () => number;
}

export interface DebugCollectRequest {
  readonly runIds?: readonly RunId[];
  readonly includeChatText?: boolean;
  /** Epoch ms. Default: the last 24 h. */
  readonly sinceMs?: number;
}

export interface DebugBundleCollector {
  collect(options: DebugCollectRequest): AsyncResult<DebugSection[]>;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_RUNS = 10;
const MAX_TEXT = 8 * 1024 * 1024;

const json = (value: unknown) => JSON.stringify(value, null, 2);

function section(
  name: DebugSection['section'],
  path: string,
  mediaType: DebugSection['mediaType'],
  text: string,
  counts: RedactionCounts,
): Result<DebugSection> {
  const parsed = debugSectionSchema.safeParse({
    section: name,
    process: 'agent',
    path,
    mediaType,
    text,
    redactions: { ...counts },
  });
  return parsed.success
    ? ok(parsed.data)
    : err(ValidationError({ field: path }, { detail: parsed.error.message }));
}

/** Newline-delimited JSON within the section limit: the oldest lines go first, and the cut is noted. */
function ndjson(lines: readonly string[]): string {
  let kept = [...lines];
  let size = kept.reduce((sum, line) => sum + line.length + 1, 0);
  let dropped = 0;
  while (size > MAX_TEXT - 100 && kept.length > 0) {
    size -= kept[0]!.length + 1;
    kept = kept.slice(1);
    dropped += 1;
  }
  return [...(dropped > 0 ? [JSON.stringify({ truncated: dropped })] : []), ...kept].join('\n');
}

/** A trace's spans as OpenTelemetry would get them: step names are the model's words, so they count as text. */
function traceText(runId: RunId, events: readonly AgentEvent[], r: Redactor): string {
  const spans = toOtelSpans(buildTrace(runId, events)).map((span) => {
    const step = span.attributes['taalcut.stepId'] !== undefined;
    return {
      ...(r.value({ ...span, name: '' }, 'keep') as object),
      name: r.value(span.name, step ? 'chat' : 'keep'),
    };
  });
  return json({ runId, spans });
}

function cloudCallRow(row: CloudCallRecord) {
  const { id, module, provider, model, reasoning, local, startedAt, latencyMs, bytesSent, bytesReceived } =
    row;
  return {
    id,
    module,
    provider,
    model,
    reasoning,
    local,
    startedAt,
    latencyMs,
    bytesSent,
    bytesReceived,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    cachedInputTokens: row.cachedInputTokens,
    cacheWriteTokens: row.cacheWriteTokens,
    costUsd: row.costUsd,
    outcome: row.outcome,
    attempt: row.attempt,
    ...(row.errorCode ? { errorCode: row.errorCode } : {}),
    ...(row.httpStatus !== undefined ? { httpStatus: row.httpStatus } : {}),
    ...(row.runId ? { runId: row.runId } : {}),
  };
}

export function createDebugBundleCollector(deps: DebugBundleDeps): DebugBundleCollector {
  const now = deps.now ?? Date.now;

  async function settingsSnapshot(): AsyncResult<Record<string, unknown>> {
    const localOnly = await deps.settings.get(LOCAL_ONLY_SETTING);
    if (!localOnly.ok) return localOnly;
    const telemetry = await deps.settings.get(TELEMETRY_SETTING);
    if (!telemetry.ok) return telemetry;
    const crashReports = await deps.settings.get(CRASH_REPORTS_SETTING);
    if (!crashReports.ok) return crashReports;
    const cap = await deps.settings.get(DEFAULT_PROJECT_CAP_SETTING);
    if (!cap.ok) return cap;
    const onboarding = await deps.settings.get(ONBOARDING_SETTING);
    if (!onboarding.ok) return onboarding;
    const standingConsents = (await deps.consents.list()).map(({ module, providers, grantedAt }) => ({
      module,
      providers: [...providers],
      grantedAt,
    }));
    return ok({
      ...(await deps.extraSettings?.()),
      localOnly: localOnly.value,
      telemetry: telemetry.value,
      crashReports: crashReports.value,
      defaultProjectCap: cap.value,
      onboarding: onboarding.value,
      standingConsents,
    });
  }

  return {
    async collect(options) {
      const include = { includeChatText: options.includeChatText ?? false, home: deps.home };
      const since = options.sinceMs ?? now() - DAY_MS;
      const chosen = options.runIds
        ? ok([...options.runIds])
        : await deps.recentRuns({ limit: DEFAULT_RUNS, sinceMs: since });
      if (!chosen.ok) return chosen;

      const sections: DebugSection[] = [];
      const add = (made: Result<DebugSection>): Result<void> => {
        if (!made.ok) return made;
        sections.push(made.value);
        return ok(undefined);
      };
      for (const runId of chosen.value) {
        const events = await deps.log.read(runId);
        // A run the log no longer has (pruned, or never there) is left out, not a failed bundle.
        if (!events.ok || events.value.length === 0) continue;
        const traceRedactor = createRedactor(include);
        const traced = add(
          section(
            'traces',
            `agent/traces/${runId}.json`,
            'application/json',
            traceText(runId, events.value, traceRedactor),
            traceRedactor.counts,
          ),
        );
        if (!traced.ok) return traced;
        const runRedactor = createRedactor(include);
        const lines = events.value.map((event) =>
          JSON.stringify(redactRunEvent(event, include, runRedactor).event),
        );
        const logged = add(
          section(
            'runs',
            `agent/runs/${runId}.jsonl`,
            'application/x-ndjson',
            ndjson(lines),
            runRedactor.counts,
          ),
        );
        if (!logged.ok) return logged;
      }

      const calls = await deps.cloudCalls(since);
      if (!calls.ok) return calls;
      const callRedactor = createRedactor(include);
      const rows = calls.value.filter((row) => row.startedAt >= since).map(cloudCallRow);
      const called = add(
        section(
          'cloudCalls',
          'agent/cloud-calls.json',
          'application/json',
          json(callRedactor.value(rows, 'keep')),
          callRedactor.counts,
        ),
      );
      if (!called.ok) return called;

      const snapshot = await settingsSnapshot();
      if (!snapshot.ok) return snapshot;
      const settingsRedactor = createRedactor(include);
      const set = add(
        section(
          'settings',
          'agent/settings.json',
          'application/json',
          json(settingsRedactor.value(snapshot.value, 'keep')),
          settingsRedactor.counts,
        ),
      );
      return set.ok ? ok(sections) : set;
    },
  };
}

/** UTILITY_CONTRACTS.agent.debugBundle. */
export function debugBundleRouter(collector: DebugBundleCollector) {
  const os = implementContract(debugBundleContract);
  return os.router({
    collect: os.collect.handler(async ({ input }) => unwrapRpc(await collector.collect(input))),
  });
}
