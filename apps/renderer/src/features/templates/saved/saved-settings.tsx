// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · Operate · component: Saved on Instagram's settings (/templates/saved/settings; UX4 tpl) · system:
 *   DESIGN.md v0.6 + UX4 (PageSection, ListRows framed, Switch with its words; design-tpl.md)
 * the page's one job is how Taalcut uses the Instagram account: who is signed in, where the session is kept (and,
 *   since REF1, that each Reel's video and music stay on this Mac with its template), and Sign out; then one framed row per collection with Watch this collection and Read new reels automatically.
 *   Settings › Accounts links here: this is the one place for the Instagram account (research C13)
 * states: signed in (the page) · signing out (Sign out spins; then the sign-in) · the switches' (watch-bar.tsx)
 */
import { Trans, useLingui } from '@lingui/react/macro';
import { Button, ListRows, PageSection, VERB_ICONS } from '@taalcut/ui';
import { TEMPLATE_ICONS } from '../template-icons';
import type { Saved } from './use-saved';
import { WatchSwitches } from './watch-bar';

export function SavedSettings({ saved }: { saved: Saved }) {
  const { t } = useLingui();
  const handle = saved.username ? `@${saved.username}` : null;
  return (
    <div className="flex max-w-[44rem] flex-col" data-slot="saved-settings">
      <PageSection
        icon={TEMPLATE_ICONS.saved}
        title={t`Instagram account`}
        description={t`Taalcut keeps the session in your Mac’s Keychain, and each Reel’s video and music on this Mac with its template.`}
        actions={
          <Button
            size="sm"
            icon={VERB_ICONS.signOut}
            loading={saved.signingOut}
            onClick={() => void saved.signOut()}
            data-slot="saved-sign-out"
          >
            <Trans>Sign out</Trans>
          </Button>
        }
      >
        <p className="m-0 type-body text-ink" data-slot="saved-signed-in-as">
          {handle ? (
            <Trans>
              Signed in as{' '}
              <span dir="auto" translate="no">
                {handle}
              </span>
            </Trans>
          ) : (
            <Trans>Signed in</Trans>
          )}
        </p>
      </PageSection>
      <PageSection
        icon={TEMPLATE_ICONS.watched}
        title={t`Watched collections`}
        description={t`A watched collection shows new saves without a sync, and Taalcut can read each one into a template.`}
      >
        <ListRows framed aria-label={t`Collections`}>
          {saved.collections.map((collection) => (
            <WatchSwitches key={collection.id} collection={collection} onChanged={saved.reload} />
          ))}
        </ListRows>
      </PageSection>
    </div>
  );
}
