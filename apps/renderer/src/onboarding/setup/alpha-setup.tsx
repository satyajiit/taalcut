// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: onboarding, the alpha · genre: atmospheric studio app · system: DESIGN.md v0.4
 * the alpha terms as three plain lines with their date (Continue agrees to them), then Settings → Privacy's own
 *   Help improve rows: usage counts with the alpha code, and crash reports. Both start off: nothing is shared
 *   until the tester turns it on.
 * states: loading (bones in the rows' place, v0.4, UX1: no lone spinner) · error (Try again) · the switch rows' eight · Local only on (both paused, said why) */

import { Trans, useLingui } from '@lingui/react/macro';
import { ALPHA_TERMS as CORE_ALPHA_TERMS } from '@taalcut/core';
import { useBackend } from '../../backend/backend';
import { useRpcQuery, useRpcStream } from '../../backend/use-rpc';
import { SkeletonLines, useHostPlatform } from '@taalcut/ui';
import { LoadError } from '../../features/settings/fields';
import { HelpImprove } from '../../features/settings/privacy/help-improve';
import { usePersonCommand } from '../../features/settings/privacy/use-person-command';

/**
 * The alpha terms a tester agrees to by continuing, kept as an acknowledgement
 * (core's ALPHA_TERMS: the feature, and the terms' date as the version), like
 * the reel-link warning, in the UI kit's `topic` form.
 */
export const ALPHA_TERMS = {
  topic: CORE_ALPHA_TERMS.featureId,
  termsVersion: CORE_ALPHA_TERMS.termsVersion,
} as const;

/** What the alpha asks of a tester, and the two things they may share (both off until turned on). */
export function AlphaSetup() {
  const { t, i18n } = useLingui();
  const mac = useHostPlatform() === 'mac';
  const backend = useBackend();
  const overview = useRpcStream((signal) => backend.privacy.changed(undefined, { signal }), [backend]);
  const telemetry = useRpcQuery(
    (signal) => backend.telemetry.state(undefined, { signal }),
    [backend, overview.data],
  );
  const person = usePersonCommand();
  const [year = 2026, month = 1, day = 1] = ALPHA_TERMS.termsVersion.split('-').map(Number);
  const version = i18n.date(new Date(year, month - 1, day), { dateStyle: 'medium' });
  const data = overview.data;
  return (
    <div className="flex flex-col gap-8">
      <section aria-label={t`The alpha terms`} className="flex flex-col gap-3">
        <ul className="m-0 flex max-w-prose list-disc flex-col gap-2 ps-5 type-prose text-ink marker:text-ink-3">
          <li>
            <Trans>Taalcut is unfinished. Things will break, and features may change or go.</Trans>
          </li>
          <li>
            {mac ? (
              <Trans>
                Your footage stays on this Mac unless a step you allow sends it. Settings › Privacy lists
                every step that did.
              </Trans>
            ) : (
              <Trans>
                Your footage stays on this computer unless a step you allow sends it. Settings › Privacy lists
                every step that did.
              </Trans>
            )}
          </li>
          <li>
            <Trans>You can stop testing at any time: remove the app and its library folder.</Trans>
          </li>
        </ul>
        <p className="m-0 type-body text-ink-2">
          <Trans>
            Alpha terms of{' '}
            <time dateTime={ALPHA_TERMS.termsVersion} className="font-sans">
              {version}
            </time>
            . Continuing means you agree to them.
          </Trans>
        </p>
      </section>
      <section aria-label={t`What you share`} className="flex flex-col gap-1">
        {!data ? (
          overview.status === 'error' ? (
            <LoadError error={overview.error} />
          ) : (
            <SkeletonLines lines={4} className="max-w-xl" />
          )
        ) : (
          <HelpImprove
            localOnly={data.localOnly}
            telemetry={{ enabled: telemetry.data?.enabled ?? false, cohort: telemetry.data?.cohort }}
            crashReports={data.switches.crashReports}
            person={person}
            onChanged={telemetry.reload}
          />
        )}
      </section>
    </div>
  );
}
