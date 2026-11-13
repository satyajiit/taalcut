// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: onboarding, keep everything on this Mac · genre: atmospheric studio app · system: DESIGN.md v0.3
 * Local only as the person's two commands (privacy.setLocalOnly, then the local-only profile), then what it means
 *   on this Mac in plain words: the jobs it makes simpler or turns off (G27's labels, from the privacy overview),
 *   that the models download next, and where to change it later. Works offline.
 * states: default (Keep everything on this Mac) · hover/focus/active (Button) · disabled (n/a: always available)
 *   · loading (the button spins through both commands) · error (ErrorLine, the switch unchanged) · success (on:
 *   the explanation, announced) · on from before (the explanation at once)
 */
import { Trans, useLingui } from '@lingui/react/macro';
import { MODEL_COMMANDS, PRIVACY_COMMANDS, type PrivacyOverview, type TaalcutError } from '@taalcut/core';
import { Button, ErrorLine, useHostPlatform } from '@taalcut/ui';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useCommand } from '../../../backend/use-command';
import { changedJobs, QualityChip } from '../../../features/settings/privacy/quality-labels';

export const LOCAL_ONLY_PROFILE = 'local-only';

export function LocalOnlyWay({ privacy, onOn }: { privacy: PrivacyOverview; onOn: () => void }) {
  const { t } = useLingui();
  const mac = useHostPlatform() === 'mac';
  const command = useCommand({ toast: false });
  const [error, setError] = useState<TaalcutError | null>(null);

  const turnOn = async () => {
    setError(null);
    const local = await command.run({ name: PRIVACY_COMMANDS.setLocalOnly, payload: { enabled: true } });
    if (!local.ok) return setError(local.error);
    const profile = await command.run({
      name: MODEL_COMMANDS.setProfile,
      payload: { profileId: LOCAL_ONLY_PROFILE },
    });
    if (!profile.ok) return setError(profile.error);
    onOn();
  };

  if (!privacy.localOnly)
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="m-0 max-w-[56ch] text-sm text-ink-2">
          {mac
            ? t({
                id: 'onboarding.thinking.local.body',
                message: 'Nothing leaves this Mac. Some results are simpler.',
              })
            : t({
                id: 'onboarding.thinking.local.body.computer',
                message: 'Nothing leaves this computer. Some results are simpler.',
              })}
        </p>
        <Button
          variant="secondary"
          data-action="local-only"
          loading={command.pending}
          onClick={() => void turnOn()}
        >
          <Trans>Use Local only</Trans>
        </Button>
        {error ? <ErrorLine error={error} /> : null}
      </div>
    );

  const changed = changedJobs(privacy.quality);
  return (
    <div className="flex max-w-[60ch] flex-col gap-3">
      {changed.length > 0 ? (
        <div className="flex flex-col gap-2">
          <p className="m-0 text-sm text-ink-2">
            {mac ? (
              <Trans>On this Mac, some jobs are simpler or wait for you to go online:</Trans>
            ) : (
              <Trans>On this computer, some jobs are simpler or wait for you to go online:</Trans>
            )}
          </p>
          <ul aria-label={t`What Local only changes`} className="m-0 flex list-none flex-wrap gap-1.5 p-0">
            {changed.map((quality) => (
              <li key={quality.module}>
                <QualityChip quality={quality} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <p className="m-0 text-sm text-ink-2">
        <Trans>The models it needs download on the next step, while you carry on.</Trans>
      </p>
      <p className="m-0 text-sm text-ink-2">
        <Trans>
          You can connect an account later in{' '}
          <Link
            to="/settings/accounts"
            className="font-medium text-primary-strong underline underline-offset-2 hover:decoration-2"
          >
            Settings › Accounts
          </Link>
          . Local only is the same switch in Settings › Privacy.
        </Trans>
      </p>
    </div>
  );
}
