// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The agent package's Phase 2 services in the agent process: the budget,
 * privacy, onboarding and component commands on the bus; the budget,
 * privacy, onboarding, telemetry and debug-bundle namespaces; and, once
 * started, what follows the bus (the flow watcher sees the user's changes,
 * Settings → Privacy refreshes, Local only is read again) and the hourly
 * sweep that reports abandoned flows' cost.
 */
import { homedir } from 'node:os';
import {
  budgetContract,
  CommandBusToken,
  componentDownloadsOverRpc,
  createToken,
  EventLogStoreToken,
  noTelemetry,
  notServedRouter,
  ok,
  PRIVACY_COMMANDS,
  ProjectBudgetStoreToken,
  SettingsStoreToken,
  TelemetryToken,
  UsageStoreToken,
  type AnyCommand,
  type AsyncResult,
  type CloudCallRecord,
  type Container,
  type RunId,
  type UsageStore,
} from '@taalcut/core';
import {
  budgetRouter,
  createBudgetCommands,
  createBudgetService,
  createComponentCommands,
  createDebugBundleCollector,
  createOnboardingCommands,
  createPrivacyCommands,
  createPrivacyService,
  debugBundleRouter,
  fromCoreEventLog,
  onboardingRouter,
  privacyRouter,
  settingsTelemetryState,
  telemetryIngestRouter,
  telemetryRouter,
  type PrivacyService,
} from '@taalcut/agent';
import { moduleNetworks, moduleQualities } from '@taalcut/models';
import { AgentMainServicesToken, ModelProfilesToken, ModelRuntimeToken } from '../../shared/tokens';
import { LocalOnlyFlagToken } from './agent-flows';
import { AgentToken, ConsentStoreToken } from './agent-loop';
import { memoryPrivacy, notifiesMemoryPrivacy } from './agent-memory';
import { agentPluginCommands, registerAgentPlugins } from './agent-plugins';
import { TelemetryServiceToken } from './telemetry';

const PrivacyServiceToken = createToken<PrivacyService>('agent.privacyService');
const FollowerToken = createToken<{ stop(): void }>('agent.servicesFollower');

const PAGE = 500;
const MAX_PAGES = 40;
const HOUR_MS = 60 * 60 * 1000;

/** CloudCall rows that started at or after `sinceMs`, paged newest first (at most 20,000 rows). */
function cloudCallsSince(usage: UsageStore) {
  return async (sinceMs: number): AsyncResult<readonly CloudCallRecord[]> => {
    const rows: CloudCallRecord[] = [];
    let before: number | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const listed = await usage.list({ limit: PAGE, ...(before !== undefined ? { before } : {}) });
      if (!listed.ok) return listed;
      rows.push(...listed.value.records.filter((row) => row.startedAt >= sinceMs));
      const oldest = listed.value.records.at(-1);
      if (listed.value.nextBefore === undefined || !oldest || oldest.startedAt < sinceMs) break;
      before = listed.value.nextBefore;
    }
    return ok(rows);
  };
}

export function registerAgentServices(container: Container): void {
  registerAgentPlugins(container);
  container.factory(
    PrivacyServiceToken,
    ({ settings, consents, usage, profiles, runtime }) =>
      createPrivacyService({
        settings,
        consents,
        cloudCalls: cloudCallsSince(usage),
        // The plans and the quality labels both from the overview's own read of Local only (P3-B10).
        modules: (localOnly) => moduleNetworks({ selector: profiles, runtime, localOnly }),
        quality: (localOnly) =>
          moduleQualities({ selector: profiles, runtime, localOnly, tier: profiles.tier() }),
        memory: memoryPrivacy(container),
      }),
    {
      deps: {
        settings: SettingsStoreToken,
        consents: ConsentStoreToken,
        usage: UsageStoreToken,
        profiles: ModelProfilesToken,
        runtime: ModelRuntimeToken,
      },
    },
  );
  container.factory(FollowerToken, () => follow(container), { dispose: (follower) => follower.stop() });
}

/** BUDGET_COMMANDS (with the library's budget store), PRIVACY_COMMANDS, ONBOARDING_COMMANDS, COMPONENT_COMMANDS. */
export function agentServiceCommands(container: Container): AnyCommand[] {
  const settings = container.resolve(SettingsStoreToken);
  const commands: AnyCommand[] = [
    ...createPrivacyCommands({ settings }).all,
    ...createOnboardingCommands({ settings }).all,
    ...agentPluginCommands(container),
  ];
  if (container.has(ProjectBudgetStoreToken))
    commands.push(
      ...createBudgetCommands({ budgets: container.resolve(ProjectBudgetStoreToken), settings }).all,
    );
  if (container.has(AgentMainServicesToken)) {
    const main = container.resolve(AgentMainServicesToken);
    commands.push(
      // The download of everything this Mac needs runs in the jobs process; main forwards (UX2-DOWNLOADER).
      ...createComponentCommands({ downloads: componentDownloadsOverRpc(() => main().components) }).all,
    );
  }
  return commands as AnyCommand[];
}

/** budget, privacy, onboarding, telemetry, telemetryIngest and debugBundle (in place of the stubs). */
export function agentServiceRouters(container: Container) {
  const settings = container.resolve(SettingsStoreToken);
  const telemetry = container.has(TelemetryToken) ? container.resolve(TelemetryToken) : noTelemetry;
  const log = container.resolve(EventLogStoreToken);
  const usage = container.resolve(UsageStoreToken);
  const profiles = container.resolve(ModelProfilesToken);
  const collector = createDebugBundleCollector({
    log: fromCoreEventLog(log),
    async recentRuns({ limit, sinceMs }) {
      const runs = await log.listRuns({ limit });
      if (!runs.ok) return runs;
      return ok(runs.value.filter((run) => run.startedAt >= sinceMs).map((run) => run.runId as RunId));
    },
    cloudCalls: cloudCallsSince(usage),
    settings,
    consents: container.resolve(ConsentStoreToken),
    extraSettings: async () => ({ modelTier: profiles.tier() }),
    home: homedir(),
  });
  return {
    budget: container.has(ProjectBudgetStoreToken)
      ? budgetRouter(createBudgetService({ budgets: container.resolve(ProjectBudgetStoreToken), settings }))
      : notServedRouter(budgetContract, 'budget'),
    privacy: privacyRouter(container.resolve(PrivacyServiceToken)),
    onboarding: onboardingRouter(settings),
    // The queue and transport are the telemetry service's (TelemetryToken); without it nothing is queued.
    telemetry: telemetryRouter({
      telemetry,
      state: async () => {
        const stored = await settingsTelemetryState(settings)();
        if (!stored.ok || !container.has(TelemetryServiceToken)) return stored;
        const live = await container.resolve(TelemetryServiceToken).state();
        return ok({
          enabled: stored.value.enabled,
          queued: live.queued,
          ...(stored.value.cohort !== undefined ? { cohort: stored.value.cohort } : {}),
          ...(live.lastSentAt !== undefined ? { lastSentAt: live.lastSentAt } : {}),
        });
      },
    }),
    telemetryIngest: telemetryIngestRouter(telemetry),
    debugBundle: debugBundleRouter(collector),
  };
}

const notifiesPrivacy = (name: string) =>
  /^(privacy|models|consents)\./.test(name) || notifiesMemoryPrivacy(name);

/**
 * Follows the bus: every command reaches the flow watcher (it ignores the agent's own), privacy and
 * model commands refresh Settings → Privacy, privacy.setLocalOnly is read again. Abandoned flows are
 * swept now and hourly. Stopped when the container is disposed.
 */
function follow(container: Container): { stop(): void } {
  const flag = container.resolve(LocalOnlyFlagToken);
  const agent = container.resolve(AgentToken);
  const privacy = container.resolve(PrivacyServiceToken);
  const unsubscribe = container.resolve(CommandBusToken).subscribe((change) => {
    void agent.noteCommand({ id: change.id, projectId: change.projectId, source: change.origin.source });
    if (change.name === PRIVACY_COMMANDS.setLocalOnly) void flag.refresh().then(() => privacy.notify());
    else if (notifiesPrivacy(change.name)) privacy.notify();
  });
  const sweep = () =>
    void agent.sweepAbandonedFlows().then((swept) => {
      if (!swept.ok) console.warn(`[agent] abandoned flows not swept: ${swept.error.code}`);
    });
  sweep();
  const timer = setInterval(sweep, HOUR_MS);
  timer.unref?.();
  return {
    stop() {
      clearInterval(timer);
      unsubscribe();
    },
  };
}

/** At start: Local only is read before any model call can go out, then the bus is followed. */
export async function startAgentServices(container: Container): Promise<void> {
  await container.resolve(LocalOnlyFlagToken).refresh();
  container.resolve(FollowerToken);
}
