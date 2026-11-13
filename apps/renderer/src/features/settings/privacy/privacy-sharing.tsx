// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · page: Settings › Privacy › Sharing (UX4) · genre: atmospheric studio app (chrome modern-minimal) ·
 *   system: DESIGN.md v0.6 + UX4 (_orch/ux4/specs/design-set.md)
 * what Taalcut itself sends, apart from your work: Help improve Taalcut (usage counts and crash reports, both off
 *   until you turn them on, each a switch row whose words are its hit area) and every other thing that uses the
 *   internet, listed once (the two switched above aren't repeated under them).
 * states: loading (the named skeleton) · error (Try again) · Local only on (both switches paused, said why) · a
 *   switch's write failing (the cause under it, the switch back) · the alpha code (checked before it is sent) */

import { Trans, useLingui } from '@lingui/react/macro';
import { PageSection, Skeleton } from '@taalcut/ui';
import { LoadError } from '../fields';
import { SETTINGS_ICONS } from '../settings-icons';
import { SettingsPage } from '../settings-page';
import { HELP_IMPROVE_ANCHOR, HelpImprove } from './help-improve';
import { OtherFlows } from './other-flows';
import { SharingBones } from './privacy-bones';
import { PrivacyViews } from './privacy-views';
import { usePrivacy } from './use-privacy';

export function PrivacySharing() {
  const { t } = useLingui();
  const { overview, retry, telemetry, person } = usePrivacy();
  const data = overview.data;
  return (
    <SettingsPage
      title={t`Privacy`}
      detail={t`Sharing`}
      views={<PrivacyViews current="sharing" />}
      description={<Trans>What leaves this Mac, and when.</Trans>}
    >
      {!data && overview.status === 'error' ? (
        <LoadError error={overview.error} onRetry={retry} what={<Trans>Privacy didn’t load.</Trans>} />
      ) : null}
      <Skeleton name="settings-privacy-sharing" loading={!data && overview.status !== 'error'} fixture={<SharingBones />}>
        {data ? (
          <div className="flex flex-col gap-10 [&>[data-slot=page-section]]:mt-0!">
            <PageSection
              id={HELP_IMPROVE_ANCHOR}
              className="scroll-mt-24"
              title={<Trans>Help improve Taalcut</Trans>}
              icon={SETTINGS_ICONS.sharing}
              description={
                <Trans>Both are off until you turn them on, and you can turn them off at any time.</Trans>
              }
            >
              <HelpImprove
                localOnly={data.localOnly}
                telemetry={{ enabled: telemetry.data?.enabled ?? false, cohort: telemetry.data?.cohort }}
                crashReports={data.switches.crashReports}
                person={person}
                onChanged={telemetry.reload}
              />
            </PageSection>
            <PageSection
              title={<Trans>Other things that use the internet</Trans>}
              icon={SETTINGS_ICONS.updates}
              description={t`What else Taalcut sends, and whether Local only allows it.`}
            >
              <OtherFlows overview={data} />
            </PageSection>
          </div>
        ) : null}
      </Skeleton>
    </SettingsPage>
  );
}
