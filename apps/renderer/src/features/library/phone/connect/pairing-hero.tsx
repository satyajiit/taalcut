// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: pairing, the QR as the hero · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.3 · the QR on its white plate, left; beside it the live connection line and the three steps as
 *   beats: scan (or, when the camera can't, type the short address, the setup code and the PIN, set in JetBrains
 *   Mono, with Copy address and Copy PIN), choose Allow when the computer asks (UX3: a scanned QR pairs only on the
 *   person's Allow), pick clips; New code and PIN under them. One column under 36rem (the chat card, onboarding),
 *   two above.
 * states: starting (boneyard bones in this exact shape: the QR square, the line, the steps, the PIN, the buttons)
 *   · waiting · connected (steps 1–2 done) · on the way · landed (all done) · lost · new code (QR, code and PIN change
 *   together; the button spins) · new code failed (the cause under it, Try again) · Copy (copy-button.tsx)
 */
import { Trans, useLingui } from '@lingui/react/macro';
import type { Result, TransferApproval, TransferFile, TransferPairing, TransferSession } from '@taalcut/core';
import { Button, cn, ErrorLine, Skeleton, VERB_ICONS } from '@taalcut/ui';
import { useState, type ReactNode } from 'react';
import { QrCode } from '../qr-code';
import { connectionOf, onTheirWay, stepStates, type Connection } from '../session/connection';
import { FIXTURE_PAIRING, FIXTURE_SESSION } from '../session/fixtures';
import { ConnectionLine } from './connection-line';
import { CopyButton } from './copy-button';
import { PinDisplay, Step } from './steps';

/** The setup code in two groups of four, as people read codes aloud. */
const grouped = (code: string) => `${code.slice(0, 4)} ${code.slice(4)}`;

const CORNERS = [
  cn('top-0 left-0 rounded-tl-md border-t-2 border-l-2'),
  cn('top-0 right-0 rounded-tr-md border-t-2 border-r-2'),
  cn('bottom-0 left-0 rounded-bl-md border-b-2 border-l-2'),
  cn('right-0 bottom-0 rounded-br-md border-r-2 border-b-2'),
];

/**
 * How the QR sits: on a raised plate on the page's canvas; flat inside another surface (the chat's card, first
 * run), never a card inside a card. The padding stays, so the bones line up either way.
 */
export type QrPlateStyle = 'raised' | 'flat';

/**
 * `standIn`: the bones' fixture. A plain square of the QR's size, because the capture draws a square SVG as a
 * circle; no corner marks either, so the bones show one rounded square where the code will be.
 */
function QrPlate({
  pairing,
  plate,
  standIn = false,
}: {
  pairing: TransferPairing;
  plate: QrPlateStyle;
  standIn?: boolean;
}) {
  const { t } = useLingui();
  return (
    <figure
      data-plate={plate}
      className={cn(
        'm-0 flex flex-col items-center gap-3.5 self-start rounded-2xl border p-5',
        plate === 'raised' ? 'border-rule bg-raised shadow-xs' : 'border-transparent',
      )}
    >
      <div className="relative p-1.5">
        {standIn ? <div className="size-56 rounded-xl bg-sunken" /> : null}
        {standIn
          ? null
          : CORNERS.map((corner) => (
              <span
                key={corner}
                aria-hidden
                className={cn('pointer-events-none absolute size-3.5 border-primary-strong/70', corner)}
              />
            ))}
        {standIn ? null : <QrCode text={pairing.qrText} label={t`QR code to connect your phone`} />}
      </div>
      <figcaption className="type-label text-ink-2">{t`Scan with your phone’s camera`}</figcaption>
    </figure>
  );
}

function NewCode({ onNewCode }: { onNewCode: () => Promise<Result<TransferPairing> | undefined> }) {
  const { t } = useLingui();
  const [renewing, setRenewing] = useState(false);
  const [failed, setFailed] = useState<Result<TransferPairing> | null>(null);
  const renew = async () => {
    setRenewing(true);
    setFailed(null);
    const result = await onNewCode();
    setRenewing(false);
    if (result && !result.ok) setFailed(result);
  };
  return (
    <div className="flex flex-col items-start gap-2 ps-10">
      <Button
        size="sm"
        variant="ghost"
        icon={VERB_ICONS.checkAgain}
        loading={renewing}
        onClick={() => void renew()}
        className="-ms-3"
      >
        {t`New code and PIN`}
      </Button>
      {failed && !failed.ok ? <ErrorLine error={failed.error} onRetry={() => void renew()} /> : null}
    </div>
  );
}

interface HeroProps {
  plate: QrPlateStyle;
  session: TransferSession;
  pairing: TransferPairing;
  connection: Connection;
  files: readonly TransferFile[];
  /** The latest phone asking to pair, for the line's note once it lapses. */
  approval?: TransferApproval | null | undefined;
  onNewCode?: () => Promise<Result<TransferPairing> | undefined>;
  transfersLink?: ((children: ReactNode) => ReactNode) | undefined;
  /** The bones' fixture (QrPlate's stand-in). */
  standIn?: boolean;
}

function Hero({
  plate,
  session,
  pairing,
  connection,
  files,
  approval,
  onNewCode,
  transfersLink,
  standIn,
}: HeroProps) {
  const { t } = useLingui();
  const [scan, allow, pick] = stepStates(connection, files);
  const address = session.url ?? '';
  const code = grouped(pairing.code);
  return (
    <div className="grid items-start gap-x-10 gap-y-8 @xl:grid-cols-[auto_minmax(0,1fr)]">
      <QrPlate pairing={pairing} plate={plate} standIn={standIn ?? false} />
      <div className="flex min-w-0 flex-col gap-6 pt-1">
        <ConnectionLine
          connection={connection}
          arriving={onTheirWay(files)}
          approval={approval ?? null}
          {...(transfersLink ? { transfersLink } : {})}
        />
        <ol className="m-0 flex list-none flex-col gap-5 p-0">
          <Step n={1} state={scan} title={t`Scan the code with your phone`}>
            <p className="m-0 max-w-prose type-body text-ink-2">
              <Trans>
                Camera won’t scan? Open{' '}
                <span translate="no" className="font-medium text-ink tabular-nums">
                  {address}
                </span>{' '}
                in the phone’s browser, type the setup code{' '}
                <span
                  translate="no"
                  className="rounded-sm bg-chip px-1.5 py-0.5 font-medium tracking-wider whitespace-nowrap text-ink tabular-nums"
                >
                  {code}
                </span>
                , then this PIN:
              </Trans>
            </p>
            <PinDisplay pin={pairing.pin} size="md" />
            <div className="-ms-3 flex flex-wrap gap-x-1 gap-y-2">
              <CopyButton value={address}>{t`Copy address`}</CopyButton>
              <CopyButton value={pairing.pin}>{t`Copy PIN`}</CopyButton>
            </div>
          </Step>
          <Step n={2} state={allow} title={t`Choose Allow here when Taalcut asks`}>
            <p className="m-0 max-w-prose type-body text-ink-2">
              {t`A phone that scans the code waits for your Allow, so a photo of the code alone can’t connect.`}
            </p>
          </Step>
          <Step n={3} state={pick} last title={t`Pick your clips`}>
            <p className="m-0 max-w-prose type-body text-ink-2">
              {t`Keep this page open on your phone until they arrive. Taalcut adds each one to your library as it lands.`}
            </p>
          </Step>
        </ol>
        {onNewCode ? <NewCode onNewCode={onNewCode} /> : <NewCodeShape />}
      </div>
    </div>
  );
}

/** The New code button's shape for the bones: the same size, no action. */
function NewCodeShape() {
  const { t } = useLingui();
  return (
    <div className="ps-10">
      <Button size="sm" variant="ghost" icon={VERB_ICONS.checkAgain} className="-ms-3">
        {t`New code and PIN`}
      </Button>
    </div>
  );
}

export interface PairingHeroProps {
  plate: QrPlateStyle;
  session: TransferSession | null;
  pairing: TransferPairing | null;
  files: readonly TransferFile[];
  /** The latest phone asking to pair (UX3): the connection line says when one lapsed. */
  approval?: TransferApproval | null;
  onNewCode: () => Promise<Result<TransferPairing> | undefined>;
  /** In the flow: wraps words in a link to the Transfers tab. */
  transfersLink?: (children: ReactNode) => ReactNode;
}

/** The QR, the PIN and the steps; bones in their shape until the session's pairing arrives. */
export function PairingHero({
  plate,
  session,
  pairing,
  files,
  approval,
  onNewCode,
  transfersLink,
}: PairingHeroProps) {
  const { t } = useLingui();
  const ready = session !== null && pairing !== null;
  const fixture = (
    <Hero
      plate={plate}
      session={FIXTURE_SESSION}
      pairing={FIXTURE_PAIRING}
      connection={{ kind: 'waiting' }}
      files={[]}
      standIn
    />
  );
  return (
    <div className="@container" data-slot="pairing">
      {ready ? null : (
        <p role="status" className="sr-only">
          {t`Getting a code and PIN…`}
        </p>
      )}
      <Skeleton name="phone-pairing" loading={!ready} fixture={fixture}>
        {ready ? (
          <Hero
            plate={plate}
            session={session}
            pairing={pairing}
            connection={connectionOf({ session, files, error: null })}
            files={files}
            approval={approval}
            onNewCode={onNewCode}
            transfersLink={transfersLink}
          />
        ) : (
          // The real layout with stand-in values, hidden under the bones so they scale to it.
          <div inert>{fixture}</div>
        )}
      </Skeleton>
    </div>
  );
}
