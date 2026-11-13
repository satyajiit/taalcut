// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · page: not found · plain text (shell/plain-message): a heading, one sentence, one link
 * in the app shell (v0.4, UX1): the sidebar, Back and the areas are all there to go on from; the one link goes
 * back to the area the address was in (UX4, B23), or to the chat outside one */
import { Trans, useLingui } from '@lingui/react/macro';
import { AreaWayOn } from '../shell-states/area-way-on';
import { ShellFrame } from './app-shell';
import { MESSAGE_LINK, PlainMessage } from './plain-message';

/**
 * Any address the app doesn't know, including a link with a malformed id: in
 * the shell, so Back, the sidebar and ⌘K are where they always are.
 */
export function NotFound() {
  const { t } = useLingui();
  return (
    <ShellFrame>
      <PlainMessage
        inShell
        name={t`Page not found`}
        title={<Trans>This page doesn't exist</Trans>}
        sentence={<Trans>The link may be old, or the item was deleted. Your chats and clips are safe.</Trans>}
        link={<AreaWayOn className={MESSAGE_LINK} />}
      />
    </ShellFrame>
  );
}
