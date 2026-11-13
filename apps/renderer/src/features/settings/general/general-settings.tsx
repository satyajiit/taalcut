// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · page: Settings › General (UX4, set lane) · genre: atmospheric studio app (chrome modern-minimal) · system:
 *   DESIGN.md v0.6 + UX4 (_orch/ux4/specs/design-set.md)
 * the everyday choices, first in Settings and found in one look: Language, the languages you speak (LIB1-LANG),
 *   Appearance, Sounds, then Kaatu and tips.
 *   They lived at the foot of About, under the hardware and twenty licence rows (critique A, P1). Updates, This Mac
 *   and About are this row's other views. One first-visit tip: ⌘K reaches any setting by its name.
 * states: each section's own (Language: loading bones, error, choosing; Appearance: the theme picker's; Sounds and
 *   Kaatu: switch rows; tips: none dismissed, some, brought back) */
import { Trans, useLingui } from '@lingui/react/macro';
import { PageSection, ThemeSwitcher, useShortcutFormat } from '@taalcut/ui';
import { PageTip } from '../../kaatu/page-tip';
import { LanguageSection } from '../language/language-section';
import { SETTINGS_ICONS } from '../settings-icons';
import { SettingsPage } from '../settings-page';
import { SoundsSection } from '../sounds/sounds-section';
import { SpokenLanguagesSection } from '../speech/spoken-languages-section';
import { GeneralViews } from './general-views';
import { KaatuSection } from './kaatu-section';

export function GeneralSettings() {
  const { t } = useLingui();
  const keys = useShortcutFormat().text('mod+k');
  return (
    <SettingsPage
      title={t`General`}
      views={<GeneralViews current="general" />}
      tip={
        <PageTip id="settings-general">
          <Trans>Looking for a setting? Press {keys} and type its name.</Trans>
        </PageTip>
      }
    >
      <LanguageSection />
      <SpokenLanguagesSection />
      <PageSection
        title={<Trans>Appearance</Trans>}
        icon={SETTINGS_ICONS.appearance}
        description={
          <Trans>
            Match the Mac follows your Mac’s light or dark setting as it changes. The sun or moon at the foot
            of the sidebar flips between light and dark.
          </Trans>
        }
      >
        <ThemeSwitcher className="self-start" />
      </PageSection>
      <SoundsSection />
      <KaatuSection />
    </SettingsPage>
  );
}
