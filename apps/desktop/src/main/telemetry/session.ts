// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The two events main records (P2-X7): session.started once the first window
 * is showing, and recovery.offered when the recovery prompt is offered.
 * Facts the catalogue rejects are not recorded. A missing agent does not
 * throw: record() never fails the window.
 */
import {
  APP_LOCALES,
  callRpc,
  TELEMETRY_PROFILES,
  type AppLocale,
  type RecoveryReport,
  type Telemetry,
  type UpdateChannel,
} from '@taalcut/core';
import { recordRecoveryOffered, recordSessionStarted } from '../../utility/telemetry/events';
import { resolveMainLocale, type LocaleSources } from '../i18n/resolve-main-locale';
import type { UtilityHost } from '../rpc/utility-host';

type Host = Pick<UtilityHost, 'client'>;

function desktopTelemetry(host: Host): Telemetry {
  return {
    record(event) {
      void callRpc(host.client('agent').telemetryIngest.record({ event }));
    },
  };
}

function osMajor(version: string): number {
  const major = Number(version.split('.')[0]);
  return Number.isInteger(major) ? major : 0;
}

function appLocale(locale: string): AppLocale | undefined {
  return (APP_LOCALES as readonly string[]).includes(locale) ? (locale as AppLocale) : undefined;
}

function telemetryProfile(id: string): (typeof TELEMETRY_PROFILES)[number] {
  return (TELEMETRY_PROFILES as readonly string[]).includes(id)
    ? (id as (typeof TELEMETRY_PROFILES)[number])
    : 'custom';
}

export interface SessionShownFacts extends LocaleSources {
  readonly appVersion: string;
  /** '' when this build has no channel. That session is not recorded. */
  readonly channel: '' | UpdateChannel;
}

/** Once the first window is showing. No channel, or facts the catalogue rejects: nothing is sent. */
export async function recordSessionShown(host: Host, facts: SessionShownFacts): Promise<void> {
  if (facts.channel === '') return;
  const hardware = await callRpc(host.client('agent').system.hardware());
  if (!hardware.ok) return;
  const models = await callRpc(host.client('agent').models.settings());
  if (!models.ok) return;
  const locale = appLocale(resolveMainLocale(facts));
  if (!locale) return;
  recordSessionStarted(desktopTelemetry(host), {
    appVersion: facts.appVersion,
    channel: facts.channel,
    osMajor: osMajor(hardware.value.info.osVersion),
    tier: hardware.value.tier,
    locale,
    profile: telemetryProfile(models.value.activeProfileId),
  });
}

/** Launch, and again when an agent crash offers the prompt. A seen report is skipped. */
export function noteRecoveryOffered(host: Host, report: RecoveryReport): void {
  if (!report.needsAttention) return;
  recordRecoveryOffered(desktopTelemetry(host), {
    runs: report.unfinishedRuns.length,
    jobs: report.reclaimedJobs.length,
    restored: report.restoredFromBackup !== null,
  });
}
