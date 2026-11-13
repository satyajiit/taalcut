// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Budgets, privacy, onboarding, telemetry, debug bundles and main's own Phase 2 namespaces. */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  BUDGET_COMMANDS,
  budgetCommandPayloads,
  COHORT_CODE_PATTERN,
  CRASH_REPORTS_SETTING,
  debugCollectOptionsSchema,
  debugSectionSchema,
  DEFAULT_PROJECT_CAP_SETTING,
  LOCAL_ONLY_SETTING,
  LocalOnly,
  newId,
  noTelemetry,
  ONBOARDING_COMMANDS,
  ONBOARDING_SETTING,
  onboardingCommandPayloads,
  PRIVACY_COMMANDS,
  privacyCommandPayloads,
  RENDERER_TELEMETRY_EVENTS,
  sizeBucket,
  SIZE_BUCKETS,
  TELEMETRY_EVENT_NAMES,
  TELEMETRY_SETTING,
  telemetryContract,
  telemetryEnvelopeSchema,
  telemetryEventSchema,
  telemetryIngestContract,
  updateStateSchema,
  type TelemetryEvent,
} from '@taalcut/core';

const usd = (micros: number) => ({ currency: 'USD', micros });

describe('budget, privacy and onboarding', () => {
  it('caps a new project at US$2 and lets a person clear or change a cap', () => {
    expect(DEFAULT_PROJECT_CAP_SETTING.defaultValue).toEqual(usd(2_000_000));
    const setCap = budgetCommandPayloads[BUDGET_COMMANDS.setProjectCap];
    const projectId = newId<'Project'>();
    expect(setCap.parse({ projectId, cap: null })).toEqual({ projectId, cap: null });
    expect(setCap.safeParse({ projectId, cap: { currency: 'usd', micros: 1 } }).success).toBe(false);
  });

  it('starts private: Local only off, crash reports and telemetry off until chosen', () => {
    expect(LOCAL_ONLY_SETTING.defaultValue).toBe(false);
    expect(CRASH_REPORTS_SETTING.defaultValue).toEqual({ enabled: false, changedAt: 0 });
    expect(TELEMETRY_SETTING.defaultValue).toEqual({ enabled: false, changedAt: 0 });
    const setTelemetry = privacyCommandPayloads[PRIVACY_COMMANDS.setTelemetry];
    expect(setTelemetry.parse({ enabled: true, cohort: 'ALPHA1' })).toEqual({
      enabled: true,
      cohort: 'ALPHA1',
    });
    expect(setTelemetry.safeParse({ enabled: true, cohort: 'alpha-1' }).success).toBe(false);
    expect(COHORT_CODE_PATTERN.test('A1B2C3')).toBe(true);
  });

  it('refuses with Local only and offers the Privacy pane', () => {
    const error = LocalOnly({ what: 'upload' });
    expect(error).toMatchObject({ code: 'core.local_only', params: { what: 'upload' } });
    expect(error.fix).toEqual({ command: 'go.privacy', payload: {}, labelKey: 'fix.openPrivacy' });
  });

  it('moves onboarding on by step', () => {
    expect(ONBOARDING_SETTING.defaultValue).toEqual({
      step: null,
      startedAt: null,
      completedAt: null,
      branch: {},
      completedVia: null,
    });
    // A Phase 2 progress reads with an empty branch and no end.
    expect(
      ONBOARDING_SETTING.schema.parse({ step: 'import', startedAt: 1, completedAt: null }),
    ).toMatchObject({
      branch: {},
      completedVia: null,
    });
    const payload = onboardingCommandPayloads[ONBOARDING_COMMANDS.setProgress];
    expect(payload.parse({ step: 'hardware' })).toEqual({ step: 'hardware' });
    expect(payload.safeParse({ step: 'welcome' }).success).toBe(false);
  });
});

/** Every leaf of a JSON Schema, with its path. */
function leaves(node: Record<string, unknown>, path: string, out: [string, Record<string, unknown>][]) {
  const children = [
    ...Object.entries((node.properties as Record<string, Record<string, unknown>>) ?? {}),
    ...((node.anyOf ?? node.oneOf ?? []) as Record<string, unknown>[]).map((c, i) => [`|${i}`, c] as const),
    ...(node.items ? [['[]', node.items as Record<string, unknown>] as const] : []),
    ...(typeof node.additionalProperties === 'object'
      ? [['{}', node.additionalProperties as Record<string, unknown>] as const]
      : []),
  ];
  if (children.length === 0) out.push([path, node]);
  for (const [key, child] of children) leaves(child, `${path}.${key}`, out);
  return out;
}

const ok: TelemetryEvent[] = [
  {
    name: 'session.started',
    appVersion: '0.2.0-alpha.3',
    channel: 'alpha',
    osMajor: 15,
    tier: 'recommended',
    locale: 'en',
    profile: 'balanced',
  },
  {
    name: 'import.completed',
    source: 'wifi',
    assets: '21-100',
    failed: '0',
    reencodedByPhone: '2-5',
    ms: 81_000,
  },
  { name: 'qa.result', passed: true, firstPass: false, fixLoops: 1, failed: ['loudness'] },
  {
    name: 'cost.recorded',
    scope: 'export',
    usdMicros: 412_000,
    estimateMicros: 380_000,
    byModule: { vision: 300_000, agent: 112_000 },
    capHit: false,
  },
];

describe('telemetry', () => {
  it('has no field that could carry free text, a path or an id', () => {
    const schema = z.toJSONSchema(telemetryEventSchema) as Record<string, unknown>;
    const all = leaves(schema, 'event', []);
    expect(all.length).toBeGreaterThan(40);
    for (const [path, leaf] of all) {
      if (leaf.type === 'string')
        expect(leaf.enum ?? leaf.const ?? leaf.pattern, `${path} is a free string`).toBeDefined();
      if (leaf.type === 'integer' || leaf.type === 'number')
        expect(leaf.maximum, `${path} has no maximum`).toBeDefined();
      if (path.endsWith('[]')) expect(leaf.enum, `${path} lists free items`).toBeDefined();
    }
  });

  it('accepts the catalogue and refuses unknown names and extra fields', () => {
    for (const event of ok) expect(telemetryEventSchema.parse(event)).toEqual(event);
    expect(telemetryEventSchema.safeParse({ name: 'clip.opened' }).success).toBe(false);
    expect(telemetryEventSchema.safeParse({ ...ok[3], fileName: 'IMG_0418.mov' }).success).toBe(false);
    expect(new Set(TELEMETRY_EVENT_NAMES).size).toBe(TELEMETRY_EVENT_NAMES.length);
  });

  it('puts counts of the library in coarse buckets', () => {
    const cases: [number, string][] = [
      [-3, '0'],
      [Number.NaN, '0'],
      [0, '0'],
      [1, '1'],
      [2, '2-5'],
      [5, '2-5'],
      [6, '6-20'],
      [100, '21-100'],
      [101, '101-500'],
      [501, '501+'],
      [Infinity, '501+'],
    ];
    for (const [n, bucket] of cases) expect(sizeBucket(n), String(n)).toBe(bucket);
    expect(SIZE_BUCKETS).toContain(sizeBucket(12_345));
  });

  it('wraps each event in an envelope with no project id', () => {
    const envelope = {
      v: 1,
      installId: newId<'Install'>(),
      sessionId: newId<'TelemetrySession'>(),
      cohort: 'ALPHA1',
      projectKey: '0123456789abcdef',
      seq: 4,
      at: 1_760_000_000_000,
      event: ok[0],
    };
    expect(telemetryEnvelopeSchema.parse(envelope)).toEqual(envelope);
    const withProject = { ...envelope, projectId: newId<'Project'>() };
    expect(telemetryEnvelopeSchema.safeParse(withProject).success).toBe(false);
    expect(telemetryEnvelopeSchema.safeParse({ ...envelope, projectKey: 'ABC' }).success).toBe(false);
  });

  it('lets a window record only its own events; other processes record any', async () => {
    const fromWindow = telemetryContract.record['~orpc'].inputSchema!;
    const survey = { event: { name: 'export.survey', answer: 'yes' } };
    expect(await fromWindow['~standard'].validate(survey)).toEqual({ value: survey });
    const qa = await fromWindow['~standard'].validate({ event: ok[2] });
    expect('issues' in qa).toBe(true);
    const ingest = telemetryIngestContract.record['~orpc'].inputSchema!;
    expect(await ingest['~standard'].validate({ event: ok[2] })).toEqual({ value: { event: ok[2] } });
    expect(RENDERER_TELEMETRY_EVENTS.every((name) => TELEMETRY_EVENT_NAMES.includes(name))).toBe(true);
    expect(noTelemetry.record(ok[0]!)).toBeUndefined();
  });
});

describe('debug bundles and updates', () => {
  it('leaves chat text out unless asked, and keeps bundle paths tidy', () => {
    expect(debugCollectOptionsSchema.parse({})).toEqual({ includeChatText: false });
    const section = {
      section: 'runs',
      process: 'agent',
      path: 'agent/runs/01JABCDEFGHJKMNPQRSTVWXYZ0.jsonl',
      mediaType: 'application/x-ndjson',
      text: '{}',
      redactions: { text: 2, paths: 1, secrets: 0 },
    };
    expect(debugSectionSchema.parse(section)).toEqual(section);
    expect(debugSectionSchema.safeParse({ ...section, path: '../etc/passwd' }).success).toBe(false);
  });

  it('describes an update by state', () => {
    const ready = { version: '0.2.0', channel: 'alpha', status: { kind: 'ready', version: '0.2.1' } };
    // A Phase 2 main's state reads with no choice and no rollback.
    expect(updateStateSchema.parse(ready)).toEqual({ ...ready, choice: null, lastRollback: null });
    const off = { version: '0.2.0', channel: null, status: { kind: 'off' } };
    expect(updateStateSchema.parse(off)).toEqual({ ...off, choice: null, lastRollback: null });
  });
});
