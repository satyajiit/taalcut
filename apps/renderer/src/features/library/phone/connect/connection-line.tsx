// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: the live connection line · genre: atmospheric studio app · system: DESIGN.md v0.3
 * one line above the steps that says where the phone is, announced politely as it changes: waiting (a phone glyph,
 *   ink-3), connected to "<phone>" (the success check and its name), stopped sending part-way (the warning glyph, and
 *   that its clips carry on by themselves); never colour alone. Under waiting, a quiet line when a phone's request
 *   to pair went unanswered or the phone stopped asking (UX3: the dialog that asked closed by itself)
 * states: waiting (and a request that lapsed) · connected (one phone, or "and 2 more") · on the way (a link to
 *   Transfers) · lost
 */
import { plural } from '@lingui/core/macro';
import { Plural, Trans, useLingui } from '@lingui/react/macro';
import type { TransferApproval } from '@taalcut/core';
import { UserContent } from '@taalcut/ui';
import { CircleCheck, Smartphone, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Connection } from '../session/connection';

export function ConnectionLine({
  connection,
  arriving,
  approval = null,
  transfersLink,
}: {
  connection: Connection;
  /** Files on their way, for "3 on the way". */
  arriving: number;
  /** The latest phone asking to pair (UX3): one that lapsed or stopped asking is said under waiting. */
  approval?: TransferApproval | null;
  /** In the flow: a link to the Transfers tab, wrapping its words. */
  transfersLink?: (children: ReactNode) => ReactNode;
}) {
  const { t } = useLingui();
  const onTheWay =
    arriving > 0
      ? plural(arriving, { one: '# clip on the way', other: '# clips on the way' })
      : t`See what arrives`;
  if (connection.kind === 'connected') {
    const [first] = connection.devices;
    const more = connection.devices.length - 1;
    const name = <UserContent translate="no">{first?.label ?? ''}</UserContent>;
    return (
      <div role="status" data-slot="connection" data-connection="connected" className="flex flex-col gap-1">
        <p className="m-0 flex items-center gap-2 type-card-title text-ink">
          <CircleCheck aria-hidden className="size-4 shrink-0 text-success-strong" />
          <span>
            {more > 0 ? (
              <Trans>
                Connected to {name} and <Plural value={more} one="# more phone" other="# more phones" />
              </Trans>
            ) : (
              <Trans>Connected to {name}</Trans>
            )}
          </span>
        </p>
        {transfersLink ? <p className="m-0 ps-6 type-body">{transfersLink(onTheWay)}</p> : null}
      </div>
    );
  }
  if (connection.kind === 'lost') {
    const name = connection.device ? (
      <UserContent translate="no">{connection.device.label}</UserContent>
    ) : null;
    return (
      <div role="status" data-slot="connection" data-connection="lost" className="flex flex-col gap-1">
        <p className="m-0 flex items-center gap-2 type-card-title text-ink">
          <TriangleAlert aria-hidden className="size-4 shrink-0 text-warning-strong" />
          <span>
            {name ? <Trans>{name} stopped sending</Trans> : <Trans>Your phone stopped sending</Trans>}
          </span>
        </p>
        <p className="m-0 max-w-prose ps-6 type-body text-ink-2">
          <Trans>
            Its clips carry on by themselves once it’s back on this Wi-Fi with the page open and the screen
            on.
          </Trans>
        </p>
      </div>
    );
  }
  const lapsed = approval?.state === 'expired' || approval?.state === 'withdrawn' ? approval : null;
  const asker = lapsed ? <UserContent translate="no">{lapsed.device.label}</UserContent> : null;
  return (
    <div role="status" data-slot="connection" data-connection="waiting" className="flex flex-col gap-1">
      <p className="m-0 flex items-center gap-2 type-card-title text-ink">
        <Smartphone aria-hidden className="size-4 shrink-0 text-ink-3" />
        {t`Waiting for your phone`}
      </p>
      {lapsed ? (
        <p data-slot="approval-lapsed" className="m-0 max-w-prose ps-6 type-body text-ink-2">
          {lapsed.state === 'expired' ? (
            <Trans>The request from {asker} ran out of time.</Trans>
          ) : (
            <Trans>{asker} stopped asking.</Trans>
          )}
        </p>
      ) : null}
    </div>
  );
}
