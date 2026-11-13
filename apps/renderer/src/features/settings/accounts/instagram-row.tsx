// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: Accounts' Instagram row (UX4) · genre: atmospheric studio app (chrome modern-minimal) ·
 *   system: DESIGN.md v0.6 + UX4 (_orch/ux4/specs/design-set.md)
 * one SettingRow, not a second sign-in: Saved on Instagram's sign-in (its warning card, its first impression) lives
 *   once, in Templates › Saved (the tpl lane's), and the account with Sign out in Saved's settings. Accounts only says
 *   how it stands, signed in as whom or not, and links there.
 * states: default · hover/focus/active (the button's) · signed out (a quiet line, Open Saved: the sign-in) · signed
 *   in (the chip, the user name, Manage: Saved's settings, where Sign out is) */
import { Trans } from '@lingui/react/macro';
import { INSTAGRAM_PROVIDER, type AccountsState } from '@taalcut/core';
import { Button, Chip, UserContent, VERB_ICONS } from '@taalcut/ui';
import { Link } from '@tanstack/react-router';
import { SettingRow, SettingRows } from '../rows';
import { ProviderMark } from './sign-ins';

type Instagram = NonNullable<AccountsState['instagram']>;

export function InstagramRow({ instagram }: { instagram: Instagram }) {
  return (
    <SettingRows>
      <SettingRow
        data-provider={INSTAGRAM_PROVIDER}
        icon={<ProviderMark provider="instagram" />}
        title={<Trans>Instagram</Trans>}
        description={
          instagram.signedIn && instagram.username ? (
            <UserContent dir="auto" translate="no">
              @{instagram.username}
            </UserContent>
          ) : instagram.signedIn ? undefined : (
            <Trans>Not signed in. Sign in from Saved to see your collections.</Trans>
          )
        }
        status={
          instagram.signedIn ? (
            <Chip tone="success">
              <Trans>Signed in</Trans>
            </Chip>
          ) : null
        }
        control={
          <Button asChild size="sm" variant="secondary" icon={VERB_ICONS.open}>
            {instagram.signedIn ? (
              <Link to="/templates/saved/settings">
                <Trans>Manage in Saved</Trans>
              </Link>
            ) : (
              <Link to="/templates/saved">
                <Trans>Open Saved</Trans>
              </Link>
            )}
          </Button>
        }
      />
    </SettingRows>
  );
}
