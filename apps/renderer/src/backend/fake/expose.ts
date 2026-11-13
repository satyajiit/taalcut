// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { ThemeEngine } from '@taalcut/ui';
import type { Backend } from '../contract';
import { createFakeBackend, type FakeControls, type FakeThemeTarget } from './fake-backend';
import type { Phase2FakeOptions } from './fake-phase2';
import type { FakeOnboardingOptions } from './fake-onboarding';
import type { Phase2bFakeOptions } from './fake-phase2b';
import type { FakeMakeOptions } from './make/fake-make';
import { activateLocale, storeLocale } from '../../i18n/i18n';
import { LOCALE_STORAGE_KEY, PSEUDO_LOCALE } from '../../i18n/locales';
import {
  HARDWARE_TIERS,
  onboardingProgressSchema,
  UPDATE_CHANNELS,
  type HardwareTier,
  type OnboardingProgress,
  type UpdateChannel,
} from '@taalcut/core';
import { TRANSFER_SCENARIOS, type TransferScenario } from './fake-transfer';
import { USB_SCENARIOS, type UsbScenario } from './phase3/fake-devices';
import { isLocalePreference } from './phase3/fake-locale';
import { MCP_SCENARIOS, type McpScenario } from './phase3/fake-mcp';
import type { Phase3FakeOptions } from './phase3/fake-phase3';
import { withAreaOptions } from './options';
import { UPDATE_SCENARIOS, type UpdateScenario } from './phase3/fake-updates';
import { LIMIT_SCENARIOS, type LimitScenario } from './phase3/fake-usage-summary';
import { USAGE_MODES, type FakeUsageMode } from './fake-usage';
import { fakeSystemFromStorage, fakeSystemPlatform } from './fake-system';
import { savedInterfaceSounds } from './fake-interface-sounds';

declare global {
  interface Window {
    /**
     * Only while the fake backend runs (a plain browser, no main): what
     * end-to-end tests drive, such as "make the next model call". Electron
     * never has it.
     */
    taalcutFake?: FakeControls;
    /**
     * The preview's fifth, switchable language (P3-L2's test build): the pseudo-locale turned on or off without
     * a reload, the way the developer switcher does it, so a switch test sees every string change while the
     * draft catalogues are still empty.
     */
    taalcutPseudoLocale?: (on: boolean) => Promise<void>;
  }
}

export function exposeFakeControls(fake: { client: Backend; controls: FakeControls }): Backend {
  window.taalcutFake = fake.controls;
  window.taalcutPseudoLocale = async (on) => {
    storeLocale(on ? PSEUDO_LOCALE : null);
    const state = fake.controls.phase3.locale.watch.get();
    await activateLocale(on ? PSEUDO_LOCALE : state.resolved, fakeSystemPlatform(fakeSystemFromStorage()));
  };
  return fake.client;
}

/** settings.setTheme in the fake runs against the page's own theme engine. */
export function themeTarget(engine: ThemeEngine): FakeThemeTarget {
  return {
    getPreference: () => engine.getState().preference,
    setPreference: (preference) => engine.setPreference(preference),
  };
}

/** localStorage key of the fakes' options (shared with the fake chat client). */
const FAKE_OPTIONS_KEY = 'taalcut.fake';

/**
 * The Phase 2 fakes' options from `taalcut.fake`, for demos and end-to-end
 * tests: `library` (a clip count, or 'empty'), `libraryLatencyMs`,
 * `places: 'none'` and `actions: 'none'` (LIB1-FIND: nothing for the Trip, Place or Activity pills), `keywordOnly`, `indexingTickMs` (0 holds the import still), `transfer` (a
 * scenario), `transferSpeed`, `transferStartMs`, `transferApprovalMs` (how long the
 * 'approval' scenario's request waits), `templates: 'empty'` and `pickedFolder`.
 */
export function phase2OptionsFromStorage(): Phase2FakeOptions {
  try {
    const raw: unknown = JSON.parse(window.localStorage.getItem(FAKE_OPTIONS_KEY) ?? '{}');
    if (!raw || typeof raw !== 'object') return {};
    const o = raw as Record<string, unknown>;
    const count = o.library === 'empty' ? 0 : typeof o.library === 'number' ? o.library : undefined;
    const scenario = TRANSFER_SCENARIOS.includes(o.transfer as TransferScenario)
      ? (o.transfer as TransferScenario)
      : undefined;
    return {
      library: {
        ...(count !== undefined ? { count } : {}),
        ...(typeof o.libraryLatencyMs === 'number' ? { latencyMs: o.libraryLatencyMs } : {}),
        ...(o.keywordOnly === true ? { keywordOnly: true } : {}),
        ...(o.places === 'none' ? { places: false } : {}),
        ...(o.actions === 'none' ? { actions: false } : {}),
        tickMs: typeof o.indexingTickMs === 'number' ? o.indexingTickMs : 2500,
      },
      transfer: {
        ...(scenario ? { scenario } : {}),
        ...(typeof o.transferSpeed === 'number' ? { speed: o.transferSpeed } : {}),
        ...(typeof o.transferStartMs === 'number' ? { startMs: o.transferStartMs } : {}),
        ...(typeof o.transferApprovalMs === 'number' ? { approvalTtlMs: o.transferApprovalMs } : {}),
      },
      templates: {
        ...(o.templates === 'empty' ? { empty: true } : {}),
        ...(typeof o.libraryLatencyMs === 'number' ? { latencyMs: o.libraryLatencyMs } : {}),
      },
      ...(typeof o.pickedFolder === 'string' || o.pickedFolder === null
        ? { pickedFolder: o.pickedFolder as string | null }
        : {}),
    };
  } catch {
    return {};
  }
}

/**
 * UI round 2b's options from `taalcut.fake`: `onboarding` ('done', 'fresh' or 'midway'), `downloadTickMs`,
 * `models` ('missing' or 'broken') and `downloads` ('midway' or 'paused'; fake-downloads.ts), `localOnly` and
 * `telemetry` (start with them on). The build's channel is Phase 3's (`channel`, below); the free disk space the
 * download checks is its probe's (`freeDiskGb`).
 */
export function phase2bOptionsFromStorage(): Phase2bFakeOptions {
  try {
    const raw: unknown = JSON.parse(window.localStorage.getItem(FAKE_OPTIONS_KEY) ?? '{}');
    if (!raw || typeof raw !== 'object') return {};
    const o = raw as Record<string, unknown>;
    const scenario = o.onboarding === 'fresh' || o.onboarding === 'midway' ? o.onboarding : undefined;
    // UX2-MODELS: the indexing models missing (a clip waits for them), or one of them that won't download.
    const models = o.models === 'missing' || o.models === 'broken' ? o.models : undefined;
    // UX2-DOWNLOADER: a download under way when the page opens, or paused.
    const downloads = o.downloads === 'midway' || o.downloads === 'paused' ? o.downloads : undefined;
    return {
      onboarding: {
        ...savedOnboarding(),
        ...(scenario ? { scenario } : {}),
        ...(typeof o.downloadTickMs === 'number' ? { downloadTickMs: o.downloadTickMs } : {}),
        ...(models ? { models } : {}),
        ...(downloads ? { downloads } : {}),
      },
      privacy: {
        ...(o.localOnly === true ? { localOnly: true } : {}),
        ...(o.telemetry === true ? { telemetry: { enabled: true, changedAt: 0 } } : {}),
      },
    };
  } catch {
    return {};
  }
}

/** First run's progress across reloads of the preview, as the agent keeps it in its settings. */
const ONBOARDING_KEY = 'taalcut.fake.onboarding';
function savedOnboarding(): Pick<FakeOnboardingOptions, 'saved' | 'persist'> {
  const persist = (progress: OnboardingProgress) => {
    try {
      window.localStorage.setItem(ONBOARDING_KEY, JSON.stringify(progress));
    } catch {
      // Storage blocked: a reload starts first run again, which the preview can live with.
    }
  };
  try {
    const parsed = onboardingProgressSchema.safeParse(
      JSON.parse(window.localStorage.getItem(ONBOARDING_KEY) ?? 'null'),
    );
    return parsed.success ? { saved: parsed.data, persist } : { persist };
  } catch {
    return { persist };
  }
}

/**
 * The Make fakes' options from `taalcut.fake`: `projects: 'empty'`, `renderTickMs` (0 holds every render
 * still) and `libraryLatencyMs` (reads wait, to see skeletons).
 */
export function makeOptionsFromStorage(): FakeMakeOptions {
  try {
    const raw: unknown = JSON.parse(window.localStorage.getItem(FAKE_OPTIONS_KEY) ?? '{}');
    if (!raw || typeof raw !== 'object') return {};
    const o = raw as Record<string, unknown>;
    return {
      ...(o.projects === 'empty' ? { empty: true } : {}),
      ...(typeof o.renderTickMs === 'number' ? { renderTickMs: o.renderTickMs } : {}),
      ...(typeof o.libraryLatencyMs === 'number' ? { latencyMs: o.libraryLatencyMs } : {}),
    };
  } catch {
    return {};
  }
}

const pick = <T extends string>(values: readonly T[], value: unknown): T | undefined =>
  values.includes(value as T) ? (value as T) : undefined;

/**
 * Phase 3's options from `taalcut.fake`: `channel` (the build's update channel; 'alpha' shows the alpha step,
 * 'beta' the beta one), `update` (idle, downloading, ready, rolled-back), `systemLanguages` (the Mac's, in
 * order), `mcp` (off, on, sessions, error), `limits` (none, one, three), `usb` (none, iphone, android,
 * iphone-icloud) with `usbTickMs`, `starters: 'error'`, and the probe's machine (`system`: mac, linux-nvidia,
 * linux-cpu, LNX1-TRM's linux-nvidia-old-driver, linux-nouveau, linux-pascal, and UX3's linux-amd and linux-intel),
 * `tier`, `freeDiskGb` and
 * `probe: 'error'`. The language
 * preference is the developer's stored one (`taalcut.locale`, migrated into the setting as main does once), else
 * Match the Mac.
 */
export function phase3OptionsFromStorage(): Phase3FakeOptions {
  try {
    const raw: unknown = JSON.parse(window.localStorage.getItem(FAKE_OPTIONS_KEY) ?? '{}');
    const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const channel = pick<UpdateChannel>(UPDATE_CHANNELS, o.channel);
    const update = pick<UpdateScenario>(UPDATE_SCENARIOS, o.update);
    const mcp = pick<McpScenario>(MCP_SCENARIOS, o.mcp);
    const limits = pick<LimitScenario>(LIMIT_SCENARIOS, o.limits);
    const usb = pick<UsbScenario>(USB_SCENARIOS, o.usb);
    const tier = pick<HardwareTier>(HARDWARE_TIERS, o.tier);
    const system = Array.isArray(o.systemLanguages)
      ? o.systemLanguages.filter((tag): tag is string => typeof tag === 'string')
      : undefined;
    const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    return {
      locale: {
        ...(system ? { system } : {}),
        ...(isLocalePreference(stored) ? { preference: stored } : {}),
        // As main keeps it in its settings: a reload of the preview opens in the language chosen.
        persist: (preference) => {
          try {
            if (preference === 'system') window.localStorage.removeItem(LOCALE_STORAGE_KEY);
            else window.localStorage.setItem(LOCALE_STORAGE_KEY, preference);
          } catch {
            // Storage blocked: the next reload follows the Mac's language again.
            return;
          }
        },
      },
      updates: { ...(channel ? { channel } : {}), ...(update ? { scenario: update } : {}) },
      ...(mcp ? { mcp: { scenario: mcp } } : {}),
      ...(limits ? { limits } : {}),
      usb: {
        ...(usb ? { scenario: usb } : {}),
        ...(typeof o.usbTickMs === 'number' ? { tickMs: o.usbTickMs } : {}),
      },
      ...(o.starters === 'error' ? { starters: { failing: true } } : {}),
      hardware: {
        system: fakeSystemFromStorage(),
        ...(tier ? { tier } : {}),
        ...(typeof o.freeDiskGb === 'number' ? { freeDiskBytes: o.freeDiskGb * 1024 ** 3 } : {}),
        ...(o.probe === 'error' ? { failing: true } : {}),
      },
    };
  } catch {
    return {};
  }
}

/** Settings › Usage's states from `taalcut.fake`: `usage` ('empty', 'slow' or 'failing'). */
function usageModeFromStorage(): { usageMode?: FakeUsageMode } {
  try {
    const raw: unknown = JSON.parse(window.localStorage.getItem(FAKE_OPTIONS_KEY) ?? '{}');
    const mode =
      raw && typeof raw === 'object'
        ? pick<FakeUsageMode>(USAGE_MODES, (raw as { usage?: unknown }).usage)
        : undefined;
    return mode ? { usageMode: mode } : {};
  } catch {
    return {};
  }
}

/** The preview's backend: the fake, driving the page's theme, with its controls on window. */
export function startPreviewBackend(engine: ThemeEngine): Backend {
  // Phase 3 (ui-make): each area's own options (options/<area>.ts) join the base ones.
  const areas = withAreaOptions({
    phase2: phase2OptionsFromStorage(),
    make: makeOptionsFromStorage(),
    phase3: phase3OptionsFromStorage(),
  });
  return exposeFakeControls(
    createFakeBackend({
      interfaceSounds: savedInterfaceSounds(),
      theme: themeTarget(engine),
      phase2: areas.phase2,
      phase2b: phase2bOptionsFromStorage(),
      make: areas.make,
      phase3: areas.phase3,
      // The usage dashboard has a month to show in the preview; unit tests keep the short seed.
      usageHistory: true,
      ...usageModeFromStorage(),
    }),
  );
}
