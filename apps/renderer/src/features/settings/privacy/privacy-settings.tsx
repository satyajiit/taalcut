// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · page: Settings › Privacy › What leaves · genre: atmospheric studio app (chrome modern-minimal) · system:
 *   DESIGN.md v0.6 + UX4 (_orch/ux4/specs/design-set.md)
 * the question people bring to Privacy, first and alone: Local only (the one switch that changes the rest, its words
 *   the hit area), then what each job sends, then the uploads you always allow. Help improve and the app's own
 *   traffic are the Sharing view (critique A: five unrelated groups on one 2,200 px scroll).
 * states: loading (the named skeleton) · error (Try again) · Local only on (a success line, its tick the
 *   reassurance critique A asked for; jobs without a model here say so) · a job with nothing sent · the switch's write failing (the
 *   cause under it, the switch back) */

import { Trans, useLingui } from '@lingui/react/macro';
import { PRIVACY_COMMANDS } from '@taalcut/core';
import { Button, PageSection, Skeleton, VERB_ICONS } from '@taalcut/ui';
import { Link } from '@tanstack/react-router';
import { LoadError, Notice } from '../fields';
import { SETTINGS_ICONS } from '../settings-icons';
import { SettingsPage } from '../settings-page';
import { SwitchRow } from '../switch-row';
import { PrivacyBones } from './privacy-bones';
import { PrivacyViews } from './privacy-views';
import { StandingConsents } from './standing-consents';
import { usePrivacy } from './use-privacy';
import { WhatLeaves } from './what-leaves';

/**
 * Settings → Privacy (P2-X2, G9): Keep everything on this Mac, what each job sends (the CloudCall log's last 30
 * days, the rows Usage shows), and the uploads you always allow.
 */
export function PrivacySettings() {
  const { t } = useLingui();
  const { overview, retry, person } = usePrivacy();
  const data = overview.data;
  const page = (children: React.ReactNode) => (
    <SettingsPage
      title={t`Privacy`}
      views={<PrivacyViews current="leaves" />}
      description={<Trans>What leaves this Mac, and when.</Trans>}
    >
      {children}
    </SettingsPage>
  );

  if (!data)
    return page(
      overview.status === 'error' ? (
        <LoadError error={overview.error} onRetry={retry} what={<Trans>Privacy didn’t load.</Trans>} />
      ) : (
        <Skeleton name="settings-privacy" loading fixture={<PrivacyBones />}>
          {null}
        </Skeleton>
      ),
    );

  const localOnly = data.localOnly;
  const localOnlyError = person.error('local-only');
  return page(
    <Skeleton name="settings-privacy" loading={false} fixture={<PrivacyBones />}>
      <div className="flex flex-col gap-10 [&>[data-slot=page-section]]:mt-0!">
        {/* The page's one switch that changes the rest stands first, on its own: its words are the hit area. */}
        <div className="flex flex-col gap-3">
          <SwitchRow
            data-setting="local-only"
            label={<Trans>Local only</Trans>}
            description={
              <Trans>
                Keep everything on this Mac. Nothing of yours leaves it: no cloud models, uploads, reel links,
                feedback or usage counts, whichever profile Models has. Update checks and model downloads
                still run; they send nothing of yours.
              </Trans>
            }
            checked={localOnly}
            busy={person.busy('local-only')}
            disabled={person.anyBusy && !person.busy('local-only')}
            error={localOnlyError}
            onChange={(enabled) => void person.run('local-only', PRIVACY_COMMANDS.setLocalOnly, { enabled })}
          />
          {localOnly && !localOnlyError ? (
            <Notice tone="success" role="status">
              <Trans>
                Local only is on. Jobs with a model on this Mac use it; the others are off until you turn this
                off. The On this Mac profile in Models runs the most jobs here.
              </Trans>
            </Notice>
          ) : null}
        </div>
        <PageSection
          title={<Trans>What leaves this Mac</Trans>}
          icon={SETTINGS_ICONS.whatLeaves}
          description={
            <Trans>
              Each job, where it runs and what it sends. The numbers are the last 30 days of requests, the
              same ones Usage lists.
            </Trans>
          }
          actions={
            <Button asChild variant="secondary" icon={VERB_ICONS.settings}>
              <Link to="/settings/models">
                <Trans>Choose models</Trans>
              </Link>
            </Button>
          }
        >
          <WhatLeaves overview={data} />
        </PageSection>
        <StandingConsents />
      </div>
    </Skeleton>,
  );
}
