// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * App-wide commands the agent process handles (core SPEC section 13):
 *
 * - The privacy switches (P2-X2): Local only, telemetry and crash reports.
 *   Person-only and without an inverse: audited, never undone by ⌘Z, never
 *   the agent's. Main mirrors crash reporting and Local only into its
 *   bootstrap file on `command.changed`.
 * - Onboarding (P2-X4, P3-B3): the step to open next, where inside it, when it
 *   started and how it ended; and "Run setup again", which undo reverts.
 *   Person-only.
 * - The download of everything this Mac needs (UX2-DOWNLOADER: first run,
 *   Settings, ⌘K, a clip waiting for its models): `components.download`,
 *   `pauseDownloads`, `resumeDownloads` and `cancelDownloads`, run by the jobs
 *   process's download set.
 */
import {
  COMPONENT_COMMANDS,
  componentCommandPayloads,
  CRASH_REPORTS_SETTING,
  defineCommand,
  LOCAL_ONLY_SETTING,
  ok,
  ONBOARDING_COMMANDS,
  ONBOARDING_SETTING,
  onboardingCommandPayloads,
  onboardingContract,
  implementContract,
  PERSON_SOURCES,
  PRIVACY_COMMANDS,
  privacyCommandPayloads,
  TELEMETRY_SETTING,
  unwrapRpc,
  type AsyncResult,
  type ComponentDownloadsPort,
  type Downloads,
  type SettingsStore,
} from '@taalcut/core';

export interface SettingsCommandDeps {
  readonly settings: SettingsStore;
  readonly now?: () => number;
}

/** `privacy.setLocalOnly`, `privacy.setTelemetry`, `privacy.setCrashReports`. */
export function createPrivacyCommands(deps: SettingsCommandDeps) {
  const now = deps.now ?? Date.now;
  const setLocalOnly = defineCommand({
    name: PRIVACY_COMMANDS.setLocalOnly,
    payload: privacyCommandPayloads[PRIVACY_COMMANDS.setLocalOnly],
    sideEffect: 'write',
    sources: PERSON_SOURCES,
    project: () => null,
    async handle({ enabled }, context) {
      const saved = await deps.settings.set(LOCAL_ONLY_SETTING, enabled, context);
      return saved.ok ? ok({ result: { enabled: saved.value } }) : saved;
    },
  });

  const setTelemetry = defineCommand({
    name: PRIVACY_COMMANDS.setTelemetry,
    payload: privacyCommandPayloads[PRIVACY_COMMANDS.setTelemetry],
    sideEffect: 'write',
    sources: PERSON_SOURCES,
    project: () => null,
    async handle({ enabled, cohort }, context) {
      const before = await deps.settings.get(TELEMETRY_SETTING);
      if (!before.ok) return before;
      // A cohort code, once entered, stays with the install until a new one is given.
      const kept = cohort ?? before.value.cohort;
      const saved = await deps.settings.set(
        TELEMETRY_SETTING,
        { enabled, ...(kept ? { cohort: kept } : {}), changedAt: now() },
        context,
      );
      return saved.ok ? ok({ result: saved.value }) : saved;
    },
  });

  const setCrashReports = defineCommand({
    name: PRIVACY_COMMANDS.setCrashReports,
    payload: privacyCommandPayloads[PRIVACY_COMMANDS.setCrashReports],
    sideEffect: 'write',
    sources: PERSON_SOURCES,
    project: () => null,
    async handle({ enabled }, context) {
      const saved = await deps.settings.set(CRASH_REPORTS_SETTING, { enabled, changedAt: now() }, context);
      return saved.ok ? ok({ result: saved.value }) : saved;
    },
  });

  return { setLocalOnly, setTelemetry, setCrashReports, all: [setLocalOnly, setTelemetry, setCrashReports] };
}

/**
 * Onboarding's commands (P2-X4, P3-B3), all person-only and app-wide:
 * - `onboarding.setProgress`: the step to open next, where inside it (`branch`, merged into what is stored)
 *   and, with `completed`, how first run ended (`via`, default 'finished'). No inverse.
 * - `onboarding.reset` ("Run setup again"): back to the start; undoable, its inverse puts the progress back.
 * - `onboarding.restore`: puts a progress back as it was, the inverse of `onboarding.reset`; internal, so only
 *   undo and redo run it.
 */
export function createOnboardingCommands(deps: SettingsCommandDeps) {
  const now = deps.now ?? Date.now;
  const setProgress = defineCommand({
    name: ONBOARDING_COMMANDS.setProgress,
    payload: onboardingCommandPayloads[ONBOARDING_COMMANDS.setProgress],
    sideEffect: 'write',
    sources: PERSON_SOURCES,
    project: () => null,
    async handle({ step, completed, via, branch }, context) {
      const before = await deps.settings.get(ONBOARDING_SETTING);
      if (!before.ok) return before;
      const at = now();
      const saved = await deps.settings.set(
        ONBOARDING_SETTING,
        {
          step,
          startedAt: before.value.startedAt ?? at,
          completedAt: completed ? at : before.value.completedAt,
          branch: branch ? { ...before.value.branch, ...branch } : before.value.branch,
          completedVia: completed ? (via ?? 'finished') : before.value.completedVia,
        },
        context,
      );
      return saved.ok ? ok({ result: saved.value }) : saved;
    },
  });

  const reset = defineCommand({
    name: ONBOARDING_COMMANDS.reset,
    payload: onboardingCommandPayloads[ONBOARDING_COMMANDS.reset],
    sideEffect: 'write',
    sources: PERSON_SOURCES,
    project: () => null,
    async handle(_payload, context) {
      const before = await deps.settings.get(ONBOARDING_SETTING);
      if (!before.ok) return before;
      const saved = await deps.settings.set(ONBOARDING_SETTING, ONBOARDING_SETTING.defaultValue, context);
      if (!saved.ok) return saved;
      return ok({
        result: saved.value,
        inverse: { name: ONBOARDING_COMMANDS.restore, payload: before.value },
      });
    },
  });

  const restore = defineCommand({
    name: ONBOARDING_COMMANDS.restore,
    payload: onboardingCommandPayloads[ONBOARDING_COMMANDS.restore],
    sideEffect: 'write',
    internal: true,
    project: () => null,
    async handle(progress, context) {
      const saved = await deps.settings.set(ONBOARDING_SETTING, progress, context);
      return saved.ok ? ok({ result: saved.value }) : saved;
    },
  });
  return { setProgress, reset, restore, all: [setProgress, reset, restore] };
}

/** appContract.onboarding (owner agent): the progress as stored. */
export function onboardingRouter(settings: SettingsStore) {
  const os = implementContract(onboardingContract);
  return os.router({
    state: os.state.handler(async () => unwrapRpc(await settings.get(ONBOARDING_SETTING))),
  });
}

export interface ComponentCommandDeps {
  /** The jobs process's download of everything this Mac needs, through main (componentDownloadsOverRpc). */
  readonly downloads: ComponentDownloadsPort;
}

/** What a download command answers: the state it left the download in (the rest follows in events). */
const stateOf = async (call: AsyncResult<Downloads>) => {
  const done = await call;
  return done.ok ? ok({ result: { state: done.value.state } }) : done;
};

/**
 * The download of everything this Mac needs (core `COMPONENT_COMMANDS`). `download` starts it, or picks it up
 * after a pause or a failure, with `first` at the front (the jobs process refuses one this Mac doesn't need,
 * `core.validation`, field `first`); it answers once the download has started, not when it ends.
 */
export function createComponentCommands(deps: ComponentCommandDeps) {
  const shared = { sideEffect: 'write', project: () => null } as const;
  const download = defineCommand({
    ...shared,
    name: COMPONENT_COMMANDS.download,
    payload: componentCommandPayloads[COMPONENT_COMMANDS.download],
    handle: ({ first }) => stateOf(deps.downloads.start(first ? { first } : {})),
  });
  const pauseDownloads = defineCommand({
    ...shared,
    name: COMPONENT_COMMANDS.pauseDownloads,
    payload: componentCommandPayloads[COMPONENT_COMMANDS.pauseDownloads],
    handle: () => stateOf(deps.downloads.pause()),
  });
  const resumeDownloads = defineCommand({
    ...shared,
    name: COMPONENT_COMMANDS.resumeDownloads,
    payload: componentCommandPayloads[COMPONENT_COMMANDS.resumeDownloads],
    handle: () => stateOf(deps.downloads.start()),
  });
  const cancelDownloads = defineCommand({
    ...shared,
    name: COMPONENT_COMMANDS.cancelDownloads,
    payload: componentCommandPayloads[COMPONENT_COMMANDS.cancelDownloads],
    handle: () => stateOf(deps.downloads.cancel()),
  });
  return {
    download,
    pauseDownloads,
    resumeDownloads,
    cancelDownloads,
    all: [download, pauseDownloads, resumeDownloads, cancelDownloads],
  };
}
