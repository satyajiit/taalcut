// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* component: launch error · genre: atmospheric studio app · system: DESIGN.md v0.6 "Message pages" (UX4) +
 *   _orch/ux4/specs/design-onb.md
 * the launch couldn't read where first run got to: the message pages' one implementation (shell/plain-message.tsx:
 *   Kaatu, a heading, one sentence), the cause as an ErrorLine, then the way on: Try again (with the retry glyph,
 *   it spins while it reads again) and Open Taalcut as words (the chat). It never skips first run quietly.
 * states: Try again: default · hover · focus (base ring) · active (gives 2 %) · loading (spins while it reads
 *   again) · disabled n/a · error (the new cause replaces the line) · success (the screen it reads opens); Open
 *   Taalcut: a link (underlined, primary-strong; thicker underline on hover)
 */
import { Trans, useLingui } from '@lingui/react/macro';
import type { TaalcutError } from '@taalcut/core';
import { Button, ErrorLine, VERB_ICONS } from '@taalcut/ui';
import { Link } from '@tanstack/react-router';
import { MESSAGE_LINK, PlainMessage } from '../shell/plain-message';

export function LaunchError({
  error,
  retrying,
  onRetry,
}: {
  error: TaalcutError;
  retrying: boolean;
  onRetry: () => void;
}) {
  const { t } = useLingui();
  return (
    <PlainMessage
      name={t`Taalcut couldn’t open`}
      // The cause is the alert (ErrorLine); the heading and sentence stay calm.
      section={{ 'data-slot': 'launch-error' }}
      title={<Trans>Taalcut couldn’t check your setup</Trans>}
      sentence={
        <Trans>
          It reads where first run got to before it opens. Try again, or open Taalcut and finish setting up
          later from Settings › About.
        </Trans>
      }
      link={
        <>
          <ErrorLine error={error} className="basis-full" />
          <Button
            variant="secondary"
            icon={VERB_ICONS.retry}
            loading={retrying}
            onClick={onRetry}
            data-action="retry-launch"
          >
            <Trans>Try again</Trans>
          </Button>
          <Link to="/chat" replace className={MESSAGE_LINK}>
            <Trans>Open Taalcut</Trans>
          </Link>
        </>
      }
    />
  );
}
