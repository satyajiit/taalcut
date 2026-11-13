// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: approval, consent and budget-cap cards, who is asking · genre: atmospheric studio app
 * (chrome modern-minimal) · system: DESIGN.md v0.3 · P3-V4 (round P3-3 adds consent and budgetCap): an external
 *   agent's ask names it ("Claude Code (an external agent) is asking", the
 *   person's own session name as written, translate="no" on the name only, a long name wraps) and links to what it
 *   may do (a ghost Button; its label never wraps: a long name cuts the label short, the full name stays its
 *   accessible name)
 * states: the line is text · the link: default · hover · focus · active · disabled (Button) · loading, error and
 *   success (n/a: it navigates)
 */
import { Trans } from '@lingui/react/macro';
import type { CardRequester } from '@taalcut/core';
import { Button } from '#components/button';
import { useCardActions } from './card-actions';
import { UserContent } from './card-frame';

type Requester = CardRequester;

/** "Claude Code (an external agent) is asking", above the summary (the approval, consent and budget-cap cards). */
export function ApprovalRequester({ requester }: { requester: Requester }) {
  const agentName = requester.name;
  return (
    <p data-slot="approval-requester" className="m-0 text-sm text-ink-2 [overflow-wrap:anywhere]">
      <Trans>
        <UserContent translate="no" className="font-semibold text-ink">
          {agentName}
        </UserContent>{' '}
        (an external agent) is asking
      </Trans>
    </p>
  );
}

/** "Change what Claude Code can do": Settings › External agents at that session. */
export function RequesterSettingsLink({ requester }: { requester: Requester }) {
  const { navigate } = useCardActions();
  if (!navigate) return null;
  const agentName = requester.name;
  return (
    <Button
      size="sm"
      variant="ghost"
      // UX4 (kit request): a long name wraps onto a second line instead of being cut, so nothing needs a tooltip.
      className="-ms-3 h-auto min-h-8 max-w-[calc(100%+0.75rem)] self-start py-1 text-start whitespace-normal"
      onClick={() => navigate({ to: 'settings', section: 'external-agents', sessionId: requester.sessionId })}
    >
      {/* One text run (the button lays its children out with a gap). */}
      <span className="min-w-0 [overflow-wrap:anywhere]">
        <Trans>
          Change what <UserContent translate="no">{agentName}</UserContent> can do
        </Trans>
      </span>
    </Button>
  );
}
