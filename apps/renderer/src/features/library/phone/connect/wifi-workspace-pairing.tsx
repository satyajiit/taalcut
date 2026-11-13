// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · Operate · DESIGN.md: a full-size scanning target with a compact, reversible manual path.
 * States: starting, live pairing, renewed/failed renewal and manual entry; reduced motion skips the reveal. */
import { useLingui } from '@lingui/react/macro';
import type { Result, TransferPairing } from '@taalcut/core';
import {
  Button,
  DUR,
  EASE_OUT,
  ErrorLine,
  motion,
  Skeleton,
  useReducedMotion,
  UserContent,
  VERB_ICONS,
} from '@taalcut/ui';
import { useEffect, useRef, useState } from 'react';
import { QrCode } from '../qr-code';
import { connectionOf, stepStates } from '../session/connection';
import type { TransferSessionApi } from '../use-transfer-session';
import { CopyButton } from './copy-button';
import { PinDisplay, Step } from './steps';

function PairingShape() {
  return (
    <div aria-hidden inert className="grid grid-cols-[224px_minmax(0,1fr)] gap-5">
      <div className="flex flex-col items-center gap-3">
        <div className="size-56 rounded-xl bg-well" />
        <div className="h-8 w-44 rounded-md bg-well" />
      </div>
      <div className="flex flex-col gap-5 pt-2">
        <div className="h-9 rounded-md bg-well" />
        <div className="h-14 rounded-md bg-well" />
        <div className="h-14 rounded-md bg-well" />
        <div className="h-8 w-32 rounded-md bg-well" />
      </div>
    </div>
  );
}

export function WifiWorkspacePairing({ transfer }: { transfer: TransferSessionApi }) {
  const { t } = useLingui();
  const reduced = useReducedMotion();
  const [manual, setManual] = useState(false);
  const switched = useRef(false);
  const pathButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (switched.current) pathButton.current?.focus();
  }, [manual]);
  const showManual = (next: boolean) => {
    switched.current = true;
    setManual(next);
  };
  const [renewing, setRenewing] = useState(false);
  const [failed, setFailed] = useState<Result<TransferPairing> | null>(null);
  const { session, pairing } = transfer;
  const ready = session !== null && pairing !== null;
  const [scan, allow, pick] = stepStates(connectionOf(transfer), transfer.files);
  const renew = async () => {
    setRenewing(true);
    setFailed(null);
    const result = await transfer.newPairing();
    setRenewing(false);
    if (result && !result.ok) setFailed(result);
  };
  const address = session?.url ?? '';
  const code = pairing ? `${pairing.code.slice(0, 4)} ${pairing.code.slice(4)}` : '';
  return (
    <div data-slot="pairing" className="min-w-0">
      {!ready ? <p role="status" className="sr-only">{t`Getting a code and PIN…`}</p> : null}
      <Skeleton name="phone-pairing" loading={!ready} fixture={<PairingShape />}>
        {ready ? (
          <div className="grid min-w-0 grid-cols-[224px_minmax(0,1fr)] items-start gap-5">
            <figure className="m-0 flex flex-col items-center gap-3">
              <QrCode text={pairing.qrText} label={t`QR code to connect your phone`} />
              <div className="flex flex-wrap items-center justify-center gap-1 [&_[data-slot=pin]]:text-2xl">
                <PinDisplay pin={pairing.pin} size="md" />
                <CopyButton value={pairing.pin} className="gap-1 px-1">{t`Copy PIN`}</CopyButton>
              </div>
              <figcaption className="type-caption text-ink-2">{t`PIN for manual connection`}</figcaption>
            </figure>
            <div className="flex min-w-0 flex-col gap-3">
              <motion.div
                key={manual ? 'manual' : 'scan'}
                initial={reduced ? false : { opacity: 0.6, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: reduced ? 0 : DUR.short, ease: EASE_OUT }}
              >
                {manual ? (
                  <div data-slot="wifi-manual" className="flex min-w-0 flex-col gap-3">
                    <h2 className="m-0 type-section text-ink">{t`Connect manually`}</h2>
                    <div>
                      <p className="m-0 type-meta text-ink-2">{t`Open this address on your phone`}</p>
                      <UserContent className="mt-1 block break-all type-body text-ink">{address}</UserContent>
                      <CopyButton value={address} className="-ml-2 px-2">{t`Copy address`}</CopyButton>
                    </div>
                    <div>
                      <p className="m-0 type-meta text-ink-2">{t`Enter this setup code`}</p>
                      <UserContent className="mt-1 block font-mono type-section text-ink tabular-nums">
                        {code}
                      </UserContent>
                    </div>
                    <p className="m-0 type-meta text-ink-2">{t`Then enter the PIN below the QR code.`}</p>
                    <Button
                      ref={pathButton}
                      data-action="wifi-scan"
                      size="sm"
                      variant="ghost"
                      icon={VERB_ICONS.back}
                      className="self-start"
                      onClick={() => showManual(false)}
                    >{t`Back to scanning`}</Button>
                  </div>
                ) : (
                  <>
                    <ol className="m-0 flex list-none flex-col gap-3 p-0">
                      <Step n={1} state={scan} title={t`Scan with your phone’s camera`} />
                      <Step n={2} state={allow} title={t`Choose Allow here`}>
                        <p className="m-0 type-meta text-ink-2">{t`Approve the request on this computer.`}</p>
                      </Step>
                      <Step n={3} state={pick} last title={t`Pick your clips`}>
                        <p className="m-0 type-meta text-ink-2">{t`Keep the phone’s page open until they arrive.`}</p>
                      </Step>
                    </ol>
                    <Button
                      ref={pathButton}
                      data-action="wifi-manual"
                      size="sm"
                      variant="ghost"
                      icon={VERB_ICONS.copyLink}
                      className="mt-3"
                      onClick={() => showManual(true)}
                    >{t`Connect manually`}</Button>
                  </>
                )}
              </motion.div>
              <Button
                size="sm"
                variant="ghost"
                icon={VERB_ICONS.checkAgain}
                loading={renewing}
                className="self-start"
                onClick={() => void renew()}
              >{t`New code and PIN`}</Button>
              {failed && !failed.ok ? <ErrorLine error={failed.error} onRetry={() => void renew()} /> : null}
            </div>
          </div>
        ) : (
          <PairingShape />
        )}
      </Skeleton>
    </div>
  );
}
