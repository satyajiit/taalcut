// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: phones connected now · genre: atmospheric studio app (chrome modern-minimal) · system: DESIGN.md v0.3
 * hairline rows: the phone glyph, its name as written, since when, Disconnect (a ghost Button: it spins while the
 *   server lets the phone go; a failure says why under the row)
 * states: connected · disconnecting (loading) · failed (ErrorLine) · gone (the row leaves)
 */
import { Trans, useLingui } from '@lingui/react/macro';
import type { Result, TransferDevice, TransferSession } from '@taalcut/core';
import { Button, ErrorLine, UserContent } from '@taalcut/ui';
import { Smartphone } from 'lucide-react';
import { useState } from 'react';

function DeviceRow({
  device,
  onDisconnect,
}: {
  device: TransferDevice;
  onDisconnect: () => Promise<Result<TransferSession> | undefined>;
}) {
  const { t, i18n } = useLingui();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<Result<TransferSession> | null>(null);
  const since = i18n.date(new Date(device.connectedAt), { timeStyle: 'short' });
  const disconnect = async () => {
    setBusy(true);
    setFailed(null);
    const result = await onDisconnect();
    setBusy(false);
    if (result && !result.ok) setFailed(result);
  };
  return (
    <li data-slot="phone-device" className="flex flex-col gap-1 py-2.5">
      <div className="flex items-center gap-3">
        <Smartphone aria-hidden className="size-4 shrink-0 text-ink-2" />
        <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
          <UserContent translate="no" className="type-label text-ink">
            {device.label}
          </UserContent>
          <span className="type-meta text-ink-3">
            <Trans>Connected since {since}</Trans>
          </span>
        </div>
        <Button size="sm" variant="ghost" loading={busy} onClick={() => void disconnect()}>
          {t`Disconnect`}
        </Button>
      </div>
      {failed && !failed.ok ? <ErrorLine error={failed.error} className="ps-7" /> : null}
    </li>
  );
}

export function PhoneDevices({
  devices,
  onDisconnect,
}: {
  devices: readonly TransferDevice[];
  onDisconnect: (id: TransferDevice['id']) => Promise<Result<TransferSession> | undefined>;
}) {
  if (devices.length === 0) return null;
  return (
    <ul data-slot="phone-devices" className="m-0 list-none divide-y divide-rule-subtle p-0">
      {devices.map((device) => (
        <DeviceRow key={device.id} device={device} onDisconnect={() => onDisconnect(device.id)} />
      ))}
    </ul>
  );
}
