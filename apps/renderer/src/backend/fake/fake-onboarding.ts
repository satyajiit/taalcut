// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * First run's fakes (P2-X4, P3-B3): onboarding progress (appContract.onboarding, `onboarding.setProgress`
 * (person-only, no inverse) with the branch inside a step and how first run ended, and `onboarding.reset` for
 * Run setup again, whose inverse puts the previous progress back), the download of everything this Mac needs
 * (fake-downloads.ts: `system.downloads`, the `components.downloads` event and the four download commands; first
 * run starts it), and telemetry (appContract.telemetry: what the window records; tests read `recorded`). The
 * build's update channel is the updates fake's (phase3/fake-updates.ts).
 */
import type { AnyCommand, Component, Downloads, OnboardingProgress, TelemetryEvent } from '@taalcut/core';
import { createFakeDownloads, type FakeDownloadsScenario, type FakeModels } from './fake-downloads';
import { FAKE_PARTS } from './fake-downloads-data';
import type { FakeWanted } from './fake-speech';
import { createFakeProgress, scenarioProgress, type OnboardingScenario } from './fake-onboarding-progress';
import type { FakeHeld } from './fake-nvidia';
import { FAKE_COMPONENTS } from './fake-system';

export type { OnboardingScenario } from './fake-onboarding-progress';

export interface FakeOnboardingOptions {
  /** done (the default: the app opens on the chat), fresh (first run) or midway (stopped at sources). */
  scenario?: OnboardingScenario;
  /** Milliseconds between download ticks once the download runs; 0 finishes at once. */
  downloadTickMs?: number;
  /** The indexing models (speech, clip search): missing, or missing with one that won't download (UX2-MODELS). */
  models?: FakeModels;
  /** A download under way when the page opens, or paused (UX2-DOWNLOADER). */
  downloads?: FakeDownloadsScenario;
  /** Progress saved by an earlier page load (the preview keeps it in localStorage), over the scenario's. */
  saved?: OnboardingProgress;
  /** Called with the progress after each setProgress, to keep it across reloads. */
  persist?: (progress: OnboardingProgress) => void;
}

/** What the download fake needs from the rest: the disk's free space and the page's event bus. */
export interface FakeOnboardingDeps {
  readonly now: () => number;
  readonly freeBytes: () => number;
  readonly emitDownloads: (downloads: Downloads) => void;
  /** LNX1-TRM: NVIDIA's CUDA libraries, held back on their terms (the RTX 4090 host). */
  readonly held?: FakeHeld | undefined;
  /** LIB1-LANG: the parts the person's choices ask for now (fake-speech.ts). */
  readonly wanted?: () => readonly FakeWanted[];
}

export interface FakeOnboarding {
  progress(): OnboardingProgress;
  /** system.components: every component this build knows, the ones this Mac needs as the download has them. */
  components(): Component[];
  /** system.downloads. */
  downloads(): Downloads;
  /** Telemetry events the window recorded, oldest first. */
  readonly recorded: TelemetryEvent[];
  /**
   * files.openNotice: "opens" an installed component's licence notice (round 3), or false when it has none here
   * (main then says core.not_found). What it opened goes in `noticesOpened`, oldest first, for the tests.
   */
  openNotice(componentId: string): boolean;
  readonly noticesOpened: string[];
  commands(): AnyCommand[];
}

export function createFakeOnboarding(
  deps: FakeOnboardingDeps,
  options: FakeOnboardingOptions = {},
): FakeOnboarding {
  const scenario = options.scenario ?? 'done';
  const progress = createFakeProgress(
    deps.now,
    options.saved ?? scenarioProgress(scenario, deps.now()),
    options.persist,
  );
  const downloads = createFakeDownloads({
    installed: scenario === 'done',
    tick: options.downloadTickMs ?? 400,
    ...(options.models ? { models: options.models } : {}),
    ...(options.downloads ? { scenario: options.downloads } : {}),
    freeBytes: deps.freeBytes,
    now: deps.now,
    emit: deps.emitDownloads,
    held: deps.held,
    ...(deps.wanted ? { wanted: deps.wanted } : {}),
  });
  const components = (): Component[] => {
    const known = FAKE_COMPONENTS.map(
      (component): Component =>
        downloads.part(component.id) ??
        // Nothing fetches a component this Mac doesn't need: it is here or it isn't.
        (component.status === 'downloading'
          ? { ...component, status: 'not-installed', progress: undefined }
          : component),
    );
    const rest = FAKE_PARTS.flatMap((part) =>
      FAKE_COMPONENTS.some((component) => component.id === part.id) ? [] : (downloads.part(part.id) ?? []),
    );
    const held = deps.held ? [downloads.part(deps.held.part.id) ?? []].flat() : [];
    // LIB1-LANG: a part the person's choices asked for (wanted now, or here from before).
    const chosen = downloads
      .downloads()
      .components.filter(
        (each) => !FAKE_PARTS.some((part) => part.id === each.id) && each.id !== deps.held?.part.id,
      );
    return [...known, ...rest, ...held, ...chosen];
  };
  const noticesOpened: string[] = [];
  return {
    progress: progress.progress,
    components,
    downloads: downloads.downloads,
    recorded: [],
    openNotice(componentId) {
      if (!components().some((component) => component.id === componentId && component.notice)) return false;
      noticesOpened.push(componentId);
      return true;
    },
    noticesOpened,
    commands: () => [...progress.commands, ...downloads.commands],
  };
}
