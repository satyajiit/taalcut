// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: onboarding, the public beta · genre: atmospheric studio app · system: DESIGN.md v0.4
 * the beta terms as three plain lines with Read the beta terms (P3-B14; Continue agrees to them), then Settings →
 *   Privacy's own Help improve rows: usage counts and crash reports, both off until the person turns them on.
 * states: loading (bones in the rows' place) · error (Try again) · the switch rows' eight · Local only on (both paused, said why)
 */
import { useLingui } from '@lingui/react/macro';
import { useBackend } from '../../backend/backend';
import { useRpcQuery, useRpcStream } from '../../backend/use-rpc';
import { SkeletonLines } from '@taalcut/ui';
import { LoadError } from '../../features/settings/fields';
import { HelpImprove } from '../../features/settings/privacy/help-improve';
import { usePersonCommand } from '../../features/settings/privacy/use-person-command';
import { BetaTermsLines } from '../../features/terms/beta-terms';

/** What the beta asks, and the two things a tester may share (both off until turned on). */
export function BetaSetup() {
  const { t } = useLingui();
  const backend = useBackend();
  const overview = useRpcStream((signal) => backend.privacy.changed(undefined, { signal }), [backend]);
  const telemetry = useRpcQuery(
    (signal) => backend.telemetry.state(undefined, { signal }),
    [backend, overview.data],
  );
  const person = usePersonCommand();
  const data = overview.data;
  return (
    <div className="flex flex-col gap-8">
      <BetaTermsLines />
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
            cohortField={false}
          />
        )}
      </section>
    </div>
  );
}
