// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: connect over Wi-Fi · genre: atmospheric studio app (chrome modern-minimal) · system: DESIGN.md v0.3
 * warnings that change what you do, the pairing hero (QR, steps, PIN), then the standing notes on a hairline.
 *   Not listening, the QR's place holds a quiet sunken plate (no code: never a stale one) and one sentence on what
 *   starting again gives you; the band above says why and holds the one primary.
 * states: starting (the hero's bones) · listening (the hero's own) · stopped (dormant plate, Help link in the flow)
 *   · failed (the same; the band names the cause)
 */
import { Trans, useLingui } from '@lingui/react/macro';
import { QrCode as QrGlyph } from 'lucide-react';
import type { ReactNode } from 'react';
import { connectionOf } from '../session/connection';
import type { TransferSessionApi } from '../use-transfer-session';
import { NetworkFinePrint, NetworkWarnings } from './network-notes';
import { PairingHero, type QrPlateStyle } from './pairing-hero';

function Dormant({ helpLink }: { helpLink?: ((children: ReactNode) => ReactNode) | undefined }) {
  const { t } = useLingui();
  return (
    <div data-slot="pairing-dormant" className="@container">
      <div className="grid items-start gap-x-10 gap-y-6 @xl:grid-cols-[auto_minmax(0,1fr)]">
        <div
          aria-hidden
          className="flex size-[17.25rem] items-center justify-center rounded-2xl border border-rule-subtle bg-sunken"
        >
          <QrGlyph className="size-12 text-ink-disabled" strokeWidth={1.25} />
        </div>
        <div className="flex max-w-prose flex-col gap-2 pt-1">
          <p className="m-0 type-card-title text-ink">{t`No code while your Mac isn’t listening`}</p>
          <p className="m-0 type-body text-ink-2">
            <Trans>
              Starting again makes a new code and PIN. A phone that connected in the last day carries on by
              itself once Taalcut listens again.
            </Trans>
          </p>
          {helpLink ? <p className="m-0 type-body">{helpLink(t`Help with connecting`)}</p> : null}
        </div>
      </div>
    </div>
  );
}

export function WifiWay({
  transfer,
  plate = 'raised',
  transfersLink,
  helpLink,
  finePrint,
}: {
  transfer: TransferSessionApi;
  /** Flat inside another surface (the chat's card): never a card inside a card. */
  plate?: QrPlateStyle;
  /** A standing note of the surface's own, first under the QR (first run's line for iPhones). */
  finePrint?: ReactNode;
  /** In the flow: links to the Transfers and Help tabs. */
  transfersLink?: (children: ReactNode) => ReactNode;
  helpLink?: (children: ReactNode) => ReactNode;
}) {
  const connection = connectionOf(transfer);
  if (connection.kind === 'stopped' || connection.kind === 'failed') return <Dormant helpLink={helpLink} />;
  return (
    <div className="flex flex-col gap-8">
      <NetworkWarnings session={transfer.session} />
      <PairingHero
        plate={plate}
        session={transfer.session}
        pairing={transfer.pairing}
        files={transfer.files}
        approval={transfer.approval}
        onNewCode={transfer.newPairing}
        {...(transfersLink ? { transfersLink } : {})}
      />
      <NetworkFinePrint lead={finePrint} />
    </div>
  );
}
