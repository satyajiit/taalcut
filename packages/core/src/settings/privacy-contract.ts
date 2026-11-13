// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Settings → Privacy (P2-X2, G9): Local only, telemetry and crash reports,
 * and an overview of what leaves the Mac, per model module and per other
 * network flow. `appContract.privacy` (owner agent) reads; changes are the
 * PRIVACY_COMMANDS, audited but never undone and never the agent's: define
 * them with `sources: PERSON_SOURCES` and no inverse (handlers in
 * @taalcut/agent, over the settings store). Main mirrors crash reporting to
 * its bootstrap file on `command.changed`.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { defineError } from '../basics/errors';
import { eventIterator, ipc } from '../ipc/contract';
import { defineSetting } from '../ports/preferences';
import { uploadConsentSchema } from './consents-contract';
import { moduleIdSchema } from './models-contract';

/** Nothing of the user's leaves the Mac: no cloud models, uploads, reference links, feedback or telemetry. */
export const LOCAL_ONLY_SETTING = defineSetting('privacy.localOnly', z.boolean(), false);

export const CRASH_REPORTS_SETTING = defineSetting(
  'privacy.crashReports',
  z.object({ enabled: z.boolean(), changedAt: z.int().nonnegative() }),
  { enabled: false, changedAt: 0 },
);

export const PRIVACY_COMMANDS = {
  setLocalOnly: 'privacy.setLocalOnly',
  setTelemetry: 'privacy.setTelemetry',
  setCrashReports: 'privacy.setCrashReports',
} as const;

/** The alpha cohort code the product owner gives a creator. */
export const COHORT_CODE_PATTERN = /^[A-Z0-9]{6}$/;

export const privacyCommandPayloads = {
  [PRIVACY_COMMANDS.setLocalOnly]: z.object({ enabled: z.boolean() }),
  /** Writes TELEMETRY_SETTING with changedAt now; a new install id each time it is turned on. */
  [PRIVACY_COMMANDS.setTelemetry]: z.object({
    enabled: z.boolean(),
    cohort: z.string().regex(COHORT_CODE_PATTERN).optional(),
  }),
  [PRIVACY_COMMANDS.setCrashReports]: z.object({ enabled: z.boolean() }),
};

/** P3: stock media search and import (V18) and the template hub (B12) are refused under Local only too. */
export const LOCAL_ONLY_REFUSALS = [
  'model',
  'upload',
  'reference',
  'feedback',
  'telemetry',
  'stock',
  'hub',
] as const;

/** Refused because Local only is on. Fix: open Settings → Privacy. */
export const LocalOnly = defineError<{ what: (typeof LOCAL_ONLY_REFUSALS)[number] }>('core.local_only', {
  fix: { command: 'go.privacy', payload: {}, labelKey: 'fix.openPrivacy' },
});

export const SENT_KINDS = [
  'messages',
  'tool-results',
  'frames',
  'audio',
  'transcripts',
  'prompts',
  'memory',
] as const;
export const OTHER_NETWORK_FLOWS = [
  'update-checks',
  'component-downloads',
  'reference-links',
  'telemetry',
  'crash-reports',
  'feedback',
  'stock-media',
  'template-hub',
] as const;

/** P3-B10: how well a module works under the current settings (Local only can lower it). */
export const MODULE_QUALITIES = ['full', 'lowerQuality', 'unavailable'] as const;
export const moduleQualitySchema = z.object({
  module: moduleIdSchema,
  quality: z.enum(MODULE_QUALITIES),
  /** i18n key: "Lower quality on this Mac", "Needs internet". */
  labelKey: z.string().min(1),
});
export type ModuleQuality = z.output<typeof moduleQualitySchema>;

export const privacyOverviewSchema = z.object({
  localOnly: z.boolean(),
  modules: z.array(
    z.object({
      module: moduleIdSchema,
      runsOn: z.enum(['this-mac', 'cloud', 'both', 'off']),
      /** Provider ids in chain order (shown as names); empty when it runs only here. */
      providers: z.array(z.string().min(1)),
      sends: z.array(z.enum(SENT_KINDS)),
      consent: uploadConsentSchema.nullable(),
      /** From the CloudCall log, the same rows as usage.list. */
      last30Days: z.object({
        calls: z.int().nonnegative(),
        cloudCalls: z.int().nonnegative(),
        bytesSent: z.int().nonnegative(),
        lastCloudAt: z.int().nonnegative().optional(),
      }),
    }),
  ),
  other: z.array(
    z.object({
      flow: z.enum(OTHER_NETWORK_FLOWS),
      enabled: z.boolean(),
      /** Still allowed with Local only on (downloads and update checks send nothing of the user's). */
      allowedLocalOnly: z.boolean(),
      lastAt: z.int().nonnegative().optional(),
    }),
  ),
  /**
   * The person's saved choices, so a switch shows them while Local only pauses the flow (`other[].enabled`
   * is the effective value). `cohort` is the alpha code kept with telemetry.
   */
  switches: z.object({
    telemetry: z.boolean(),
    crashReports: z.boolean(),
    cohort: z.string().regex(COHORT_CODE_PATTERN).optional(),
  }),
  /** P3-B10: each module's quality as things stand. */
  quality: z.array(moduleQualitySchema).max(16).default([]),
});
export type PrivacyOverview = z.output<typeof privacyOverviewSchema>;

/** appContract.privacy, owner agent. */
export const privacyContract = {
  overview: ipc.output(privacyOverviewSchema),
  /** The current overview first, then after every change. */
  changed: ipc.output(eventIterator(privacyOverviewSchema)),
};
