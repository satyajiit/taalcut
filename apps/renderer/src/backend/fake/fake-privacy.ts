// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Settings → Privacy's fake (appContract.privacy and PRIVACY_COMMANDS, served
 * by the agent in the app): Local only, telemetry and crash reports, and the
 * overview of what leaves the Mac. The per-module numbers are aggregated from
 * the same fake CloudCall log Usage lists, so the panel and Usage agree (the
 * P2-X2 "Done when"). The switches are person-only commands with no inverse:
 * audited, never undone by ⌘Z, never the agent's.
 */
import {
  defineCommand,
  err,
  MODEL_MODULE_IDS,
  ok,
  PERSON_SOURCES,
  PRIVACY_COMMANDS,
  privacyCommandPayloads,
  TimeoutError,
  type AnyCommand,
  type CloudCallRecord,
  type ModelModuleId,
  type ModelSettings,
  type PrivacyOverview,
  type SENT_KINDS,
  type UploadConsentInfo,
} from '@taalcut/core';
import { ON_DEVICE } from './fake-model-data';
import { watched, type Watched } from './watch';

const DAY = 86_400_000;
/** Providers that run on this Mac: the embedded runtime, the speech engines, local servers, Taalcut's own rules. */
const HERE = new Set([ON_DEVICE, 'onnx', 'sherpa-onnx', 'whisper-cpp', 'ollama', 'lm-studio', 'taalcut']);

/** What each job sends when it runs in the cloud, in the overview's words (SENT_KINDS). */
export const MODULE_SENDS: Readonly<Record<ModelModuleId, readonly (typeof SENT_KINDS)[number][]>> = {
  // Memory's cloud switch is on in the fake (LRN1-MEM), so the agent's prompts carry it.
  agent: ['messages', 'tool-results', 'prompts', 'memory'],
  router: ['messages'],
  vision: ['frames', 'prompts'],
  embeddings: ['transcripts'],
  speech: ['audio'],
  voice: ['prompts'],
  music: ['prompts'],
  images: ['prompts'],
};

/** The jobs whose model on this Mac is simpler than the cloud's (models' quality table for the fake). */
const SIMPLER_HERE: ReadonlySet<ModelModuleId> = new Set(['agent', 'vision']);

/**
 * P3-B10: what Local only does to each job, as the models package reports it, with its label keys
 * (QUALITY_LABEL_KEYS): a job with no model on this Mac is off (unavailable, needsInternet); one whose model here is
 * simpler says so. Derived from where each job runs, so Privacy's rows and the labels never disagree.
 */
function localOnlyQuality(
  modules: readonly { module: ModelModuleId; runsOn: string }[],
): PrivacyOverview['quality'] {
  return modules.flatMap(({ module, runsOn }): PrivacyOverview['quality'] =>
    runsOn === 'off'
      ? [{ module, quality: 'unavailable' as const, labelKey: 'models.quality.needsInternet' }]
      : runsOn === 'this-mac' && SIMPLER_HERE.has(module)
        ? [{ module, quality: 'lowerQuality' as const, labelKey: 'models.quality.lowerQuality' }]
        : [],
  );
}

export interface PrivacyState {
  localOnly: boolean;
  telemetry: { enabled: boolean; cohort?: string; changedAt: number };
  crashReports: { enabled: boolean; changedAt: number };
}

export interface FakePrivacyDeps {
  now: () => number;
  models: () => ModelSettings;
  /** Every CloudCall row, newest first (the fake usage log). */
  calls: () => readonly CloudCallRecord[];
  consents: () => readonly UploadConsentInfo[];
  initial?: Partial<PrivacyState>;
}

export interface FakePrivacy {
  readonly watch: Watched<PrivacyOverview>;
  state(): PrivacyState;
  commands(): AnyCommand[];
  /** For tests: a switch's write fails once. */
  failNext(name: string): void;
}

/** One module's last 30 days, from the CloudCall rows: the numbers Usage shows for it. */
export function last30Days(calls: readonly CloudCallRecord[], module: ModelModuleId, now: number) {
  const recent = calls.filter((call) => call.module === module && call.startedAt >= now - 30 * DAY);
  const cloud = recent.filter((call) => !call.local);
  const lastCloudAt = cloud.reduce<number | undefined>(
    (latest, call) => (latest === undefined || call.startedAt > latest ? call.startedAt : latest),
    undefined,
  );
  return {
    calls: recent.length,
    cloudCalls: cloud.length,
    bytesSent: cloud.reduce((sum, call) => sum + call.bytesSent, 0),
    ...(lastCloudAt === undefined ? {} : { lastCloudAt }),
  };
}

export function createFakePrivacy(deps: FakePrivacyDeps): FakePrivacy {
  const state: PrivacyState = {
    localOnly: deps.initial?.localOnly ?? false,
    telemetry: deps.initial?.telemetry ?? { enabled: false, changedAt: 0 },
    crashReports: deps.initial?.crashReports ?? { enabled: false, changedAt: 0 },
  };
  const failing = new Set<string>();

  const overview = (): PrivacyOverview => {
    const now = deps.now();
    const calls = deps.calls();
    const consents = deps.consents();
    const modules = deps.models().modules.filter((m) => MODEL_MODULE_IDS.includes(m.module));
    const rows = modules.map((m) => {
      const cloud = [...new Set(m.chain.filter((c) => !HERE.has(c.provider)).map((c) => c.provider))];
      const local = m.chain.some((c) => HERE.has(c.provider));
      const runsOn =
        m.chain.length === 0
          ? 'off'
          : state.localOnly
            ? local
              ? 'this-mac'
              : 'off'
            : cloud.length === 0
              ? 'this-mac'
              : local
                ? 'both'
                : 'cloud';
      return {
        module: m.module,
        runsOn,
        providers: state.localOnly ? [] : cloud,
        sends: cloud.length === 0 ? [] : [...MODULE_SENDS[m.module]],
        consent: consents.find((c) => c.module === m.module) ?? null,
        last30Days: last30Days(calls, m.module, now),
      } as const;
    });
    return {
      localOnly: state.localOnly,
      modules: rows,
      other: [
        { flow: 'update-checks', enabled: true, allowedLocalOnly: true, lastAt: now - 3 * 3_600_000 },
        { flow: 'component-downloads', enabled: true, allowedLocalOnly: true, lastAt: now - 2 * DAY },
        { flow: 'reference-links', enabled: !state.localOnly, allowedLocalOnly: false },
        { flow: 'telemetry', enabled: state.telemetry.enabled && !state.localOnly, allowedLocalOnly: false },
        {
          flow: 'crash-reports',
          enabled: state.crashReports.enabled && !state.localOnly,
          allowedLocalOnly: false,
        },
        { flow: 'feedback', enabled: !state.localOnly, allowedLocalOnly: false },
      ],
      switches: {
        telemetry: state.telemetry.enabled,
        crashReports: state.crashReports.enabled,
        ...(state.telemetry.cohort ? { cohort: state.telemetry.cohort } : {}),
      },
      quality: state.localOnly ? localOnlyQuality(rows) : [],
    };
  };
  const watch = watched(overview);

  /** A person-only switch with no inverse: audited, never undone, never the agent's. */
  const write = <K extends keyof typeof privacyCommandPayloads>(
    name: K,
    apply: (payload: ReturnType<(typeof privacyCommandPayloads)[K]['parse']>) => void,
  ) =>
    defineCommand({
      name,
      payload: privacyCommandPayloads[name],
      sideEffect: 'write',
      sources: PERSON_SOURCES,
      project: () => null,
      async handle(payload) {
        if (failing.delete(name)) return err(TimeoutError({ ms: 5_000 }));
        apply(payload as never);
        watch.notify();
        return ok({ result: payload });
      },
    });

  return {
    watch,
    state: () => state,
    failNext: (name) => void failing.add(name),
    commands: () => [
      write(PRIVACY_COMMANDS.setLocalOnly, ({ enabled }) => {
        state.localOnly = enabled;
      }),
      write(PRIVACY_COMMANDS.setTelemetry, ({ enabled, cohort }) => {
        state.telemetry = { enabled, changedAt: deps.now(), ...(cohort ? { cohort } : {}) };
      }),
      write(PRIVACY_COMMANDS.setCrashReports, ({ enabled }) => {
        state.crashReports = { enabled, changedAt: deps.now() };
      }),
    ],
  };
}
