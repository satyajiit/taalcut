// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: update channel choice, its rows · genre: atmospheric studio app (chrome modern-minimal)
 *   · system: DESIGN.md v0.6 + UX4 (a ChoiceRow: the kit's Radio, its words the hit area)
 * a channel row (the channel's name and one line on what it means; the chosen row on the selected wash), the beta
 *   terms step that opens under Beta (the kit's Collapse, so the row under it moves with it: three lines, Agree and
 *   switch to Beta as the one marigold fill, Cancel), and a team build's channel as a fact.
 * states: default · hover · focus (the radio's ring) · active · checked · disabled (while a switch runs) · loading
 *   (the row spins; Agree spins) · error (the choice's) · success (the choice's)
 */
import { Trans } from '@lingui/react/macro';
import type { PublicUpdateChannel } from '@taalcut/core';
import { Button, Collapse } from '@taalcut/ui';
import { LoaderCircle } from 'lucide-react';
import { ChoiceRow } from '../settings/radio-row';
import { BetaTermsLines } from '../terms/beta-terms';

/** A channel's name and what it means. */
function channelWords(channel: PublicUpdateChannel) {
  return channel === 'stable'
    ? { label: <Trans>Stable</Trans>, description: <Trans>The tested releases.</Trans> }
    : {
        label: <Trans>Beta</Trans>,
        description: <Trans>New things first, and more often. Things can still break.</Trans>,
      };
}

export function ChannelRow({
  channel,
  pending,
  askingTerms,
  onAgree,
  onCancel,
}: {
  channel: PublicUpdateChannel;
  pending: PublicUpdateChannel | null;
  askingTerms: boolean;
  onAgree: () => void;
  onCancel: () => void;
}) {
  const words = channelWords(channel);
  return (
    <ChoiceRow
      value={channel}
      label={words.label}
      description={words.description}
      disabled={pending !== null}
      trailing={
        pending === channel && !askingTerms ? (
          <LoaderCircle aria-hidden className="size-4 shrink-0 animate-spin text-ink-2" />
        ) : null
      }
    >
      {channel === 'beta' ? (
        <Collapse open={askingTerms}>
          <BetaTermsStep busy={pending === 'beta'} onAgree={onAgree} onCancel={onCancel} />
        </Collapse>
      ) : null}
    </ChoiceRow>
  );
}

function BetaTermsStep({
  busy,
  onAgree,
  onCancel,
}: {
  busy: boolean;
  onAgree: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="border-t border-rule-subtle bg-well px-4 py-4 ps-9">
      <div className="flex flex-col gap-4">
        <p className="m-0 type-label text-ink">
          <Trans>Before you switch, the beta in three lines:</Trans>
        </p>
        <BetaTermsLines />
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" loading={busy} onClick={onAgree}>
            <Trans>Agree and switch to Beta</Trans>
          </Button>
          <Button variant="ghost" disabled={busy} onClick={onCancel}>
            <Trans>Cancel</Trans>
          </Button>
        </div>
      </div>
    </div>
  );
}

export function TeamChannel({ channel }: { channel: 'internal' | 'alpha' }) {
  return (
    <p className="m-0 max-w-prose type-body text-ink-2">
      {channel === 'alpha' ? (
        <Trans>This is a team build. It updates itself from the alpha channel.</Trans>
      ) : (
        <Trans>This is a team build. It updates itself from the team’s internal channel.</Trans>
      )}
    </p>
  );
}
