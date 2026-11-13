// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · pre-emit critique: P5 H4 E4 S5 R5 V4
 * Hallmark · component: the Wi-Fi import in one view (P2-L3, P2-L11), where it sits inside another surface: first
 *   run's sources step and the chat's source picker · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.3 · the same parts as /library/phone, without its tabs: the listening band first (the only
 *   time the Mac listens on the network), the QR hero with its steps, then the phones and files arriving. The QR's
 *   plate is flat inside the chat's card; on first run's canvas it is raised, as on /library/phone (UX3)
 * states: the band's (starting with bones, listening, stopped and why, failed) · the hero's (bones, waiting,
 *   connected, lost, dormant) · arriving (phones, file rows) · a phone asking to pair (the dialog over it all, UX3)
 */
import { useLingui } from '@lingui/react/macro';
import { useEffect, useId, type ReactNode } from 'react';
import { Button } from '@taalcut/ui';
import { usePhoneFlow } from './session/phone-flow';
import type { QrPlateStyle } from './connect/pairing-hero';
import { WifiWay } from './connect/wifi-way';
import { StatusBand } from './status/status-band';
import { PhoneDevices } from './transfers/phone-devices';
import { LandedCount, TransferFiles } from './transfers/transfer-files';
import { type TransferState } from './use-transfer-session';

/**
 * `onState`: what first run follows (a phone connected, files arriving) to say so and enable Continue. `plate`: the
 * QR's (flat inside a card, raised on a canvas). `finePrint`: a standing note of the surface's own, under the QR.
 */
export function PhonePage({
  onState,
  plate = 'flat',
  finePrint,
}: { onState?: (state: TransferState) => void; plate?: QrPlateStyle; finePrint?: ReactNode } = {}) {
  const { t } = useLingui();
  const titleId = useId();
  const { transfer, connect } = usePhoneFlow();
  const { session, pairing, files, error } = transfer;
  useEffect(() => {
    onState?.({ session, pairing, files, error });
  }, [onState, session, pairing, files, error]);
  const devices = session?.state === 'listening' ? session.devices : [];

  return (
    <div className="flex flex-col gap-8">
      {!transfer.enabled ? (
        <Button data-action="wifi-connect" variant="primary" onClick={connect}>{t`Connect`}</Button>
      ) : (
        <>
          <div className="border-b border-rule-subtle pb-5">
            <StatusBand transfer={transfer} />
          </div>
          <WifiWay transfer={transfer} plate={plate} finePrint={finePrint} />
          {devices.length > 0 || files.length > 0 ? (
            <section aria-labelledby={titleId} className="flex flex-col gap-2">
              <div className="flex flex-wrap items-baseline gap-x-3">
                <h2 id={titleId} className="m-0 type-section text-ink">
                  {t`Arriving now`}
                </h2>
                {files.length > 0 ? <LandedCount files={files} /> : null}
              </div>
              <PhoneDevices devices={devices} onDisconnect={transfer.disconnect} />
              <TransferFiles files={files} onCancel={transfer.cancelUpload} />
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
