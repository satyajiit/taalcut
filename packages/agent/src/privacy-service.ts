// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Settings → Privacy (P2-X2, G9): what leaves this Mac, per model module and
 * per other network flow, served as `appContract.privacy` (owner agent). The
 * module numbers are counted from the CloudCall log, the same rows
 * Settings → Usage lists, so the panel and the log can't disagree. Where a
 * module runs and what it sends come from the models package (injected as
 * `modules`); standing consents from the consent store.
 */
import {
  CRASH_REPORTS_SETTING,
  implementContract,
  isTaalcutError,
  LOCAL_ONLY_SETTING,
  ok,
  OTHER_NETWORK_FLOWS,
  privacyContract,
  TELEMETRY_SETTING,
  toRpcError,
  unwrapRpc,
  type AsyncResult,
  type CloudCallRecord,
  type ModelModuleId,
  type ModuleQuality,
  type PrivacyOverview,
  type SENT_KINDS,
  type SettingsStore,
} from '@taalcut/core';
import type { ConsentStore } from './ports';

export type SentKind = (typeof SENT_KINDS)[number];
export type OtherNetworkFlow = (typeof OTHER_NETWORK_FLOWS)[number];

/** Where a module runs now and what it sends: the models package works it out from the active profile. */
export interface PrivacyModulePlan {
  readonly module: ModelModuleId;
  readonly runsOn: 'this-mac' | 'cloud' | 'both' | 'off';
  /** Cloud provider ids in chain order; empty when it runs only on this Mac. */
  readonly providers: readonly string[];
  readonly sends: readonly SentKind[];
}

export interface PrivacyServiceDeps {
  readonly settings: SettingsStore;
  readonly consents: Pick<ConsentStore, 'get'>;
  /** CloudCall rows that started at or after `sinceMs` (the library's cloud-call table). */
  readonly cloudCalls: (sinceMs: number) => AsyncResult<readonly CloudCallRecord[]>;
  /** Each module's plan with Local only as the overview read it, so the plan and the setting agree. */
  readonly modules: (localOnly: boolean) => readonly PrivacyModulePlan[];
  /**
   * P3-B10: how well each module works under the same settings (models' moduleQualities), so "what leaves
   * this device" and the quality labels come from one read. Without it no label is reported.
   */
  readonly quality?: (localOnly: boolean) => readonly ModuleQuality[];
  /** When a flow last used the network, if known (update checks, downloads, telemetry sends…). */
  readonly lastAt?: (flow: OtherNetworkFlow) => number | undefined;
  /**
   * LRN1-MEM: memory's cloud switch and the modules the agent's prompts go to (the agent's and each skill's). Such
   * a module that leaves this Mac sends memory too while the switch is on. Without it memory is not listed.
   */
  readonly memory?: PrivacyMemory;
  readonly now?: () => number;
}

export interface PrivacyMemory {
  /** MEMORY_CLOUD_PROMPTS_SETTING. */
  readonly cloudPrompts: () => AsyncResult<boolean>;
  readonly modules: () => readonly ModelModuleId[];
}

/** The modules whose prompts carry memory off this Mac: none when the switch is off or no memory deps. */
async function memoryModules(memory: PrivacyMemory | undefined): AsyncResult<ReadonlySet<ModelModuleId>> {
  if (!memory) return ok(new Set());
  const cloudPrompts = await memory.cloudPrompts();
  if (!cloudPrompts.ok) return cloudPrompts;
  return ok(new Set(cloudPrompts.value ? memory.modules() : []));
}

export interface PrivacyService {
  overview(): AsyncResult<PrivacyOverview>;
  /** The current overview first, then again after every notify(). Ends when `signal` aborts. Throws a read's error. */
  changed(signal?: AbortSignal): AsyncIterable<PrivacyOverview>;
  /** Something the overview shows changed (a privacy or model command, a consent, a new cloud call). */
  notify(): void;
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
/** Update checks and component downloads send nothing of the user's, so Local only allows them. */
const ALLOWED_LOCAL_ONLY: ReadonlySet<OtherNetworkFlow> = new Set(['update-checks', 'component-downloads']);

/** The 30-day numbers of one module, from the CloudCall rows. */
export function moduleTraffic(rows: readonly CloudCallRecord[], module: ModelModuleId) {
  const own = rows.filter((row) => row.module === module);
  const cloud = own.filter((row) => !row.local);
  const lastCloudAt = cloud.reduce<number | undefined>(
    (latest, row) => (latest === undefined || row.startedAt > latest ? row.startedAt : latest),
    undefined,
  );
  return {
    calls: own.length,
    cloudCalls: cloud.length,
    bytesSent: cloud.reduce((sum, row) => sum + row.bytesSent, 0),
    ...(lastCloudAt !== undefined ? { lastCloudAt } : {}),
  };
}

export function createPrivacyService(deps: PrivacyServiceDeps): PrivacyService {
  const now = deps.now ?? Date.now;
  const waiting = new Set<() => void>();

  async function overview(): AsyncResult<PrivacyOverview> {
    const [localOnly, telemetry, crashes] = await Promise.all([
      deps.settings.get(LOCAL_ONLY_SETTING),
      deps.settings.get(TELEMETRY_SETTING),
      deps.settings.get(CRASH_REPORTS_SETTING),
    ]);
    if (!localOnly.ok) return localOnly;
    if (!telemetry.ok) return telemetry;
    if (!crashes.ok) return crashes;
    const since = now() - THIRTY_DAYS_MS;
    const calls = await deps.cloudCalls(since);
    if (!calls.ok) return calls;
    const rows = calls.value.filter((row) => row.startedAt >= since);
    const local = localOnly.value;
    const withMemory = await memoryModules(deps.memory);
    if (!withMemory.ok) return withMemory;

    const modules: PrivacyOverview['modules'] = [];
    for (const plan of deps.modules(local)) {
      const consent = await deps.consents.get(plan.module);
      const leaves = plan.runsOn === 'cloud' || plan.runsOn === 'both';
      const memory = leaves && withMemory.value.has(plan.module);
      modules.push({
        module: plan.module,
        runsOn: plan.runsOn,
        providers: [...plan.providers],
        sends: memory ? [...plan.sends, 'memory'] : [...plan.sends],
        consent: consent
          ? { module: consent.module, providers: [...consent.providers], grantedAt: consent.grantedAt }
          : null,
        last30Days: moduleTraffic(rows, plan.module),
      });
    }

    const enabled: Record<OtherNetworkFlow, boolean> = {
      'update-checks': true,
      'component-downloads': true,
      'reference-links': !local,
      telemetry: telemetry.value.enabled && !local,
      'crash-reports': crashes.value.enabled && !local,
      feedback: !local,
      // P3: allowed unless Local only is on (core.local_only 'stock', 'hub').
      'stock-media': !local,
      'template-hub': !local,
    };
    const other = OTHER_NETWORK_FLOWS.map((flow) => {
      const lastAt = deps.lastAt?.(flow);
      return {
        flow,
        enabled: enabled[flow],
        allowedLocalOnly: ALLOWED_LOCAL_ONLY.has(flow),
        ...(lastAt !== undefined ? { lastAt } : {}),
      };
    });
    const { cohort } = telemetry.value;
    const switches = {
      telemetry: telemetry.value.enabled,
      crashReports: crashes.value.enabled,
      ...(cohort ? { cohort } : {}),
    };
    const quality = deps.quality ? deps.quality(local).map((q) => ({ ...q })) : [];
    return ok({ localOnly: local, modules, other, switches, quality });
  }

  async function* changed(signal?: AbortSignal): AsyncGenerator<PrivacyOverview> {
    let pending = true;
    let wake: (() => void) | undefined;
    const onChange = () => {
      pending = true;
      wake?.();
    };
    const onAbort = () => wake?.();
    waiting.add(onChange);
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      while (!signal?.aborted) {
        if (pending) {
          pending = false;
          const current = await overview();
          if (!current.ok) throw current.error;
          yield current.value;
          continue;
        }
        await new Promise<void>((resolve) => (wake = resolve));
        wake = undefined;
      }
    } finally {
      waiting.delete(onChange);
      signal?.removeEventListener('abort', onAbort);
    }
  }

  return {
    overview,
    changed,
    notify() {
      for (const listener of waiting) listener();
    },
  };
}

/** appContract.privacy (owner agent). The switches are PRIVACY_COMMANDS on the bus. */
export function privacyRouter(service: PrivacyService) {
  const os = implementContract(privacyContract);
  return os.router({
    overview: os.overview.handler(async () => unwrapRpc(await service.overview())),
    changed: os.changed.handler(async function* ({ signal }) {
      try {
        yield* service.changed(signal);
      } catch (cause) {
        throw isTaalcutError(cause) ? toRpcError(cause) : cause;
      }
    }),
  });
}
