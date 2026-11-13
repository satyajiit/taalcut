// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · pre-emit critique: P5 H5 E4 S5 R5 V4
 * Hallmark · component: hub blocked (/templates/hub, /templates/hub/$hubId) · genre: atmospheric studio app (chrome
 *   modern-minimal) · system: DESIGN.md v0.3 · the empty surface when the hub is off: Kaatu beside the words (an
 *   empty surface, never a work one), the reason and its one way out (Privacy for Local only; nothing to do in a
 *   copy of Taalcut without the hub; UX1 M22: no "this build")
 * states: Local only (Open Privacy: default · hover · focus-visible · active, the Button's) · not set up (words
 *   only) · n/a: disabled, loading, error, success
 */
import { Trans } from '@lingui/react/macro';
import { Button, EmptyState } from '@taalcut/ui';
import { Link } from '@tanstack/react-router';
import type { HubBlock } from './use-hub-status';

export function HubBlocked({ block }: { readonly block: Exclude<HubBlock, null> }) {
  return (
    <div data-hub-block={block}>
      {block === 'localOnly' ? (
        <EmptyState
          titleAs="h2"
          title={<Trans>The hub is off while Local only is on</Trans>}
          description={
            <Trans>
              Local only keeps Taalcut from using the internet, so you can’t browse, share or rate templates.
              Your own templates still work.
            </Trans>
          }
          action={
            <Button asChild>
              <Link to="/settings/privacy">
                <Trans>Open Privacy</Trans>
              </Link>
            </Button>
          }
        />
      ) : (
        <EmptyState
          title={<Trans>The hub isn’t set up in this copy of Taalcut</Trans>}
          description={
            <Trans>
              This copy doesn’t know where the template hub is, so there’s nothing to browse here. Your own
              templates and the starters still work.
            </Trans>
          }
        />
      )}
    </div>
  );
}
