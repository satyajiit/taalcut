// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * After the settings store is open, the store wins over userData/privacy.json.
 * Turning crash reports off, or Local only on, stops the next upload at once.
 * Turning them on waits for the next launch (the mirror is rewritten either way).
 */
import {
  CRASH_REPORTS_SETTING,
  LOCAL_ONLY_SETTING,
  PRIVACY_COMMANDS,
  type EventBus,
  type SettingsStore,
} from '@taalcut/core';
import { noteCrashReportingConsent } from './reporting';
import { privacyMirrorPath, reconcilePrivacyMirror, type PrivacyMirror } from './privacy-mirror';

export interface CrashConsentDeps {
  readonly settings: SettingsStore;
  readonly events: EventBus;
  readonly userData: string;
  /** The mirror just written, so feedback can see Local only without another read. */
  readonly onMirror?: (mirror: PrivacyMirror) => void;
}

export function watchCrashConsent(deps: CrashConsentDeps): () => void {
  const file = privacyMirrorPath(deps.userData);
  const sync = async (): Promise<void> => {
    const crash = await deps.settings.get(CRASH_REPORTS_SETTING);
    const local = await deps.settings.get(LOCAL_ONLY_SETTING);
    if (!crash.ok || !local.ok) return;
    const mirror = reconcilePrivacyMirror(
      { crashReports: crash.value, localOnly: local.value },
      file,
    );
    deps.onMirror?.(mirror);
    if (!(mirror.crashReports && !mirror.localOnly)) noteCrashReportingConsent(false);
  };
  void sync();
  return deps.events.on('command.changed', (event) => {
    const name = event.payload.name;
    if (name !== PRIVACY_COMMANDS.setCrashReports && name !== PRIVACY_COMMANDS.setLocalOnly) return;
    void sync();
  });
}
