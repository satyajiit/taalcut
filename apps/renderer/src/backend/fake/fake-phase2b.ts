// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The namespaces UI round 2b's screens read (P2-X1, P2-X2, P2-X4, P2-X7),
 * served by the renderer's fake on the same MessageChannel as the rest:
 * `budget`, `privacy`, `onboarding`, `telemetry` and `feedback` (projects are the Make fakes',
 * make/fake-projects.ts; updates are Phase 3's, phase3/fake-updates.ts), plus their commands (caps, the privacy switches, onboarding progress, the
 * recommended downloads). Each is core's contract, so the real backend
 * changes nothing in the pages.
 */
import {
  appContract,
  implementContract,
  type AnyCommand,
  type CloudCallRecord,
  type Downloads,
  type ModelSettings,
  type UploadConsentInfo,
} from '@taalcut/core';
import { createFakeBudget } from './fake-budget';
import { createFakeFeedback } from './fake-feedback';
import type { FakeHeld } from './fake-nvidia';
import type { FakeWanted } from './fake-speech';
import { createFakeOnboarding, type FakeOnboardingOptions } from './fake-onboarding';
import { createFakePrivacy, type PrivacyState } from './fake-privacy';

export interface Phase2bFakeOptions {
  readonly onboarding?: FakeOnboardingOptions;
  readonly privacy?: Partial<PrivacyState>;
}

export interface Phase2bDeps {
  now: () => number;
  models: () => ModelSettings;
  calls: () => readonly CloudCallRecord[];
  consents: () => readonly UploadConsentInfo[];
  /** The fake disk's free space (the download checks it before it starts). */
  freeBytes: () => number;
  /** The download changed: the page's `components.downloads` event. */
  emitDownloads: (downloads: Downloads) => void;
  /** LNX1-TRM: a part the download holds back on its owner's terms (fake-nvidia.ts). */
  held?: FakeHeld | undefined;
  /** LIB1-LANG: the parts the person's choices ask for now (fake-speech.ts). */
  wanted?: () => readonly FakeWanted[];
}

export function createPhase2bFakes(deps: Phase2bDeps, options: Phase2bFakeOptions = {}) {
  const privacy = createFakePrivacy({ ...deps, ...(options.privacy ? { initial: options.privacy } : {}) });
  const budget = createFakeBudget();
  const onboarding = createFakeOnboarding(deps, options.onboarding);
  const feedback = createFakeFeedback({ localOnly: () => privacy.state().localOnly });

  const bud = implementContract(appContract.budget);
  const pri = implementContract(appContract.privacy);
  const onb = implementContract(appContract.onboarding);
  const tel = implementContract(appContract.telemetry);
  const fbk = implementContract(appContract.feedback);

  const router = {
    budget: bud.router({
      project: bud.project.handler(({ input }) => budget.project(input.projectId)),
      defaults: bud.defaults.handler(() => budget.defaults()),
    }),
    privacy: pri.router({
      overview: pri.overview.handler(() => privacy.watch.get()),
      changed: pri.changed.handler(({ signal }) => privacy.watch.stream(signal)),
    }),
    onboarding: onb.router({ state: onb.state.handler(() => onboarding.progress()) }),
    telemetry: tel.router({
      state: tel.state.handler(() => {
        const { telemetry, localOnly } = privacy.state();
        return {
          enabled: telemetry.enabled && !localOnly,
          ...(telemetry.cohort ? { cohort: telemetry.cohort } : {}),
          queued: onboarding.recorded.length,
        };
      }),
      // As the agent's queue does: nothing is kept while consent is off or Local only is on.
      record: tel.record.handler(({ input }) => {
        const { telemetry, localOnly } = privacy.state();
        if (telemetry.enabled && !localOnly) onboarding.recorded.push(input.event);
      }),
    }),
    feedback: fbk.router({
      preview: fbk.preview.handler(({ input }) => feedback.preview(input)),
      send: fbk.send.handler(({ input }) => feedback.send(input)),
      saveBundle: fbk.saveBundle.handler(({ input }) => feedback.saveBundle(input)),
    }),
  };

  const commands: AnyCommand[] = [...privacy.commands(), ...budget.commands(), ...onboarding.commands()];
  /** A command on the bus changed something these fakes show: tell the watchers. */
  const changed = () => privacy.watch.notify();
  return { router, commands, privacy, budget, onboarding, feedback, changed };
}

export type Phase2bFakes = ReturnType<typeof createPhase2bFakes>;
