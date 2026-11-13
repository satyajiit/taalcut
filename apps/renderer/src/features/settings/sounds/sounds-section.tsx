// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Settings › General › Sounds. One global switch; persisted through the command bus.
 * Loading stays silent, turning off stops audio immediately, and a saved enable previews one cue.
 * Errors keep sound muted with a retry; the switch follows other windows. */
import { Trans } from '@lingui/react/macro';
import { Button, PageSection, VERB_ICONS } from '@taalcut/ui';
import { useInterfaceSounds } from '../../sounds/interface-sounds';
import { SETTINGS_ICONS } from '../settings-icons';
import { SwitchRow } from '../switch-row';

export function SoundsSection() {
  const sound = useInterfaceSounds();
  return (
    <PageSection title={<Trans>Sounds</Trans>} icon={SETTINGS_ICONS.sound}>
      <SwitchRow
        data-setting="interface-sounds"
        label={<Trans>Interface sounds</Trans>}
        description={
          <Trans>
            Quiet sounds for sending prompts, editing and completed work. Silent during playback and
            recording.
          </Trans>
        }
        checked={sound.enabled}
        busy={sound.pending || (!sound.ready && !sound.error)}
        onChange={sound.setEnabled}
        error={sound.error}
      >
        {sound.error ? (
          <Button variant="secondary" size="sm" icon={VERB_ICONS.retry} onClick={sound.retry}>
            <Trans>Try again</Trans>
          </Button>
        ) : null}
      </SwitchRow>
    </PageSection>
  );
}
