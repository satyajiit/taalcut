// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: profile-picker · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.6 + UX4 · one SettingRows frame of ChoiceRows (UX1: rows, not a grid of cards): the kit's
 *   Radio with each profile's name and line as its words, so the whole row picks it; arrow keys move and choose
 * states: default · hover (hover surface) · focus (the radio's ring, instant) · active (the ring gives) · checked
 *   (the dot grows in, the selected wash) · disabled (n/a: a profile can always be chosen; with Local only on, the
 *   line above says what it does to this one) · loading (aria-busy while the switch is on its way) · error/success
 *   (the page's)
 */
import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import type { ModelSettings } from '@taalcut/core';
import { Chip, useHostPlatform } from '@taalcut/ui';
import { useState, type ReactNode } from 'react';
import { translateKey } from '../model-messages';
import { ChoiceRow, ChoiceRows } from '../radio-row';

const CUSTOM_LABEL = msg`Your profile`;
const CUSTOM_DESCRIPTION = msg`A profile you made.`;

/**
 * The profiles as a list of choice rows. Choosing one switches at once; the
 * choice shows while its command runs. `note` is a line above them about what
 * something else does to the choice (Privacy's Local only).
 */
export function ProfilePicker({
  settings,
  busy,
  onChoose,
  note,
}: {
  settings: ModelSettings;
  busy: boolean;
  onChoose: (profileId: string) => void;
  note?: ReactNode;
}) {
  const { t, i18n } = useLingui();
  const platform = useHostPlatform();
  // The choice shows at once; while the command runs it stands in for main's answer.
  const [chosen, setChosen] = useState<string | null>(null);
  const active = busy && chosen !== null ? chosen : settings.activeProfileId;
  return (
    <div className="flex flex-col gap-3">
      {note ? (
        <p data-slot="profile-note" className="m-0 max-w-prose type-body text-ink-2">
          {note}
        </p>
      ) : null}
      <ChoiceRows
        aria-label={t`Profile`}
        loading={busy}
        value={active}
        onValueChange={(profileId) => {
          setChosen(profileId);
          onChoose(profileId);
        }}
      >
        {settings.profiles.map((profile) => (
          <ChoiceRow
            key={profile.id}
            value={profile.id}
            label={translateKey(i18n, profile.labelKey, CUSTOM_LABEL, platform)}
            description={translateKey(i18n, profile.descriptionKey, CUSTOM_DESCRIPTION, platform)}
            trailing={
              profile.id === settings.recommendedProfileId ? (
                <Chip tone="primary" className="whitespace-normal">
                  <Trans>Recommended for this Mac</Trans>
                </Chip>
              ) : null
            }
          />
        ))}
      </ChoiceRows>
    </div>
  );
}
