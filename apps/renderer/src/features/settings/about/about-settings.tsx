// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · page: Settings › General › About (UX4: version, licences and links) · genre: atmospheric studio app
 *   (chrome modern-minimal) · system: DESIGN.md v0.6 + UX4
 * the brand moment on the canvas, unboxed: Kaatu (112 px, named for screen readers: About is where Kaatu is
 *   introduced, and it stays when Show Kaatu is off), the four-colour Logo, the version in words, the line and the
 *   project's links; then one list of every licence, then Feedback and setup. Updates, This Mac and the everyday
 *   choices moved to their own pages under General (critique A, P1: About was a junk drawer).
 * states: default · loading (the licences' named skeleton) · error (LoadError, Try again) · a development build
 *   ("Development build", never 0.0.0) · the version waits for the app's own answer, so it never reads
 *   "Development build" and then changes
 */
import { Trans, useLingui } from '@lingui/react/macro';
import { Kaatu, Logo, Skeleton, useIdleMood } from '@taalcut/ui';
import { useBackend } from '../../../backend/backend';
import { useRpcQuery } from '../../../backend/use-rpc';
import { GitHubAboutLinks } from '../../../shell/github-links';
import { BoneRows, BoneSection, type BoneRowShape } from '../bones';
import { LoadError } from '../fields';
import { useUpdateState } from '../../updates/use-updates';
import { GeneralViews } from '../general/general-views';
import { SettingsPage } from '../settings-page';
import { HelpSection } from './help-section';
import { LicencesSection } from './licences-section';

/** What the interface built from source calls itself: only a packaged app has a release number. */
const DEV_VERSION = '0.0.0';

const LICENCE_BONES: readonly BoneRowShape[] = ['12%', '22%', '18%', '26%', '16%'].map((title) => ({
  title,
  lines: ['30%'],
  control: 'button',
}));

/** Settings › General › About: who Taalcut is, its version, its licences and its links. */
export function AboutSettings() {
  const { t } = useLingui();
  const backend = useBackend();
  const components = useRpcQuery((signal) => backend.system.components(undefined, { signal }), [backend]);
  const updates = useUpdateState();
  // A packaged build with an update channel reports its own release number; without one this is a build from source.
  const version = updates.data?.channel != null ? updates.data.version : __TAALCUT_VERSION__;
  const known = updates.status !== 'loading' || updates.data !== undefined;
  const mood = useIdleMood();
  return (
    <SettingsPage title={t`General`} detail={t`About`} views={<GeneralViews current="about" />}>
      <section data-slot="about-brand" className="flex flex-wrap items-center gap-6">
        <Kaatu spot="about" mood={mood} labelled />
        <div className="flex min-w-0 flex-1 basis-64 flex-col items-start gap-2">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <Logo label={t`Taalcut`} colourway="four-colour" className="h-9 self-center" />
            <span data-slot="about-version" className="type-meta text-ink-3 tabular-nums">
              {/* A build from source has no release number: say what it is instead of "0.0.0" (L4). */}
              {!known ? null : version === DEV_VERSION ? (
                <Trans>Development build</Trans>
              ) : (
                <Trans>
                  Version <span translate="no">{version}</span>
                </Trans>
              )}
            </span>
          </div>
          <p className="m-0 type-card-title text-ink">
            <Trans>Cut your clips to the beat of a reel you love.</Trans>
          </p>
          <p className="m-0 max-w-prose type-body text-ink-2">
            <Trans>
              Meet Kaatu, from{' '}
              <span lang="hi" translate="no">
                काटना
              </span>
              , “to cut”. Beavers cut, and Taalcut cuts your clips to the beat.
            </Trans>
          </p>
          <GitHubAboutLinks className="pt-1.5" />
        </div>
      </section>
      {components.status === 'error' ? (
        <LoadError
          error={components.error}
          onRetry={components.reload}
          what={<Trans>The licences didn’t load.</Trans>}
        />
      ) : null}
      <Skeleton
        name="settings-about"
        loading={components.status === 'loading'}
        fixture={
          <BoneSection title="14%" lines={['52%']}>
            <BoneRows rows={LICENCE_BONES} />
          </BoneSection>
        }
      >
        <LicencesSection components={components.data} />
      </Skeleton>
      <HelpSection />
    </SettingsPage>
  );
}
