// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · page: Transfers (/library/phone/transfers) · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.3 · two hairline sections on the canvas: Arriving now (the phones connected, then each file
 *   travelling and landing, then a cable import started here) and Earlier from your phones (the library's record)
 * states: arriving (rows, "2 of 4 in your library" announced) · nothing yet (the shape of what will arrive: three
 *   still ghost rows, the words, and Show the code when no phone is connected) · stopped (the band says why; what
 *   arrived stays) · history (phone-history.tsx)
 */
import { Trans, useLingui } from '@lingui/react/macro';
import { Button, EmptyState, UserContent } from '@taalcut/ui';
import { Link } from '@tanstack/react-router';
import { useId } from 'react';
import { DeviceRunBlock } from '../../../../onboarding/setup/sources/device-run';
import { PHONE_TAB_PATHS } from '../flow/phone-tabs';
import { connectionOf, type Connection } from '../session/connection';
import { usePhoneFlow } from '../session/phone-flow';
import { PhoneDevices } from './phone-devices';
import { PhoneHistory } from './phone-history';
import { LandedCount, TransferFiles } from './transfer-files';

/** Three still rows in a file row's shape: what will fill this list. */
function GhostRows() {
  return (
    <ul aria-hidden className="m-0 flex list-none flex-col divide-y divide-rule-subtle p-0">
      {[11, 8, 13].map((width) => (
        <li key={width} className="flex items-center gap-3 py-3.5">
          <span className="size-4 shrink-0 rounded-pill border border-rule-strong" />
          <span className="h-2.5 rounded-pill bg-rule-subtle" style={{ width: `${width}rem` }} />
          <span className="h-2 w-12 rounded-pill bg-rule-subtle/70" />
          <span className="ms-auto h-2.5 w-24 rounded-pill bg-rule-subtle/70" />
        </li>
      ))}
    </ul>
  );
}

function ArrivingEmpty({ connection }: { connection: Connection }) {
  const { t } = useLingui();
  const connected = connection.kind === 'connected' ? connection.devices[0]?.label : undefined;
  return (
    <EmptyState
      titleAs="h3"
      title={t`Nothing on its way yet`}
      description={
        connected ? (
          <Trans>
            <UserContent translate="no">{connected}</UserContent> is connected. Pick clips on the phone and
            they show up here as they travel.
          </Trans>
        ) : connection.kind === 'off' ? (
          t`Your Mac isn’t listening on Wi-Fi yet. Show the code, scan it with your phone, and its clips show up here as they travel.`
        ) : (
          t`Clips your phone sends show up here as they travel, then land in your library.`
        )
      }
      action={
        connected ? undefined : (
          <Button asChild variant="secondary">
            <Link to={PHONE_TAB_PATHS.wifi} replace>
              {t`Show the code`}
            </Link>
          </Button>
        )
      }
    >
      <GhostRows />
    </EmptyState>
  );
}

export function TransfersView() {
  const { t } = useLingui();
  const titleId = useId();
  const { transfer, cableRun } = usePhoneFlow();
  const { session, files } = transfer;
  const devices = session?.state === 'listening' ? session.devices : [];
  const anything = devices.length > 0 || files.length > 0 || cableRun !== null;
  return (
    <div className="flex flex-col gap-12">
      <section aria-labelledby={titleId} data-slot="arriving" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 id={titleId} className="m-0 type-section text-ink">
            {t`Arriving now`}
          </h2>
          {files.length > 0 ? <LandedCount files={files} /> : null}
        </div>
        {anything ? (
          // One list on hairlines: the phones, then their files, then a cable import started here.
          <div className="flex flex-col divide-y divide-rule-subtle">
            <PhoneDevices devices={devices} onDisconnect={transfer.disconnect} />
            <TransferFiles files={files} onCancel={transfer.cancelUpload} />
            {cableRun ? (
              <div className="pt-4">
                <DeviceRunBlock runId={cableRun} />
              </div>
            ) : null}
          </div>
        ) : (
          <ArrivingEmpty connection={connectionOf(transfer)} />
        )}
      </section>
      <PhoneHistory />
    </div>
  );
}
