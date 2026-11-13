// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · Operate · DESIGN.md: one compact desktop pairing workspace, never an implicit network start.
 * States: off, starting, waiting, connected/lost, stopped and failed. Only the incoming queue scrolls. */
import { useLingui } from '@lingui/react/macro';
import { Button, CONCEPT_ICONS } from '@taalcut/ui';
import { Link } from '@tanstack/react-router';
import { connectionOf } from '../session/connection';
import { StatusBand } from '../status/status-band';
import type { TransferSessionApi } from '../use-transfer-session';
import { NetworkWarnings } from './network-notes';
import { WifiWorkspaceIncoming } from './wifi-workspace-incoming';
import { WifiWorkspacePairing } from './wifi-workspace-pairing';

export function WifiWorkspace({
  transfer,
  onConnect,
}: {
  transfer: TransferSessionApi;
  onConnect: () => void;
}) {
  const { t } = useLingui();
  const connection = connectionOf(transfer);
  const dormant = ['off', 'stopped', 'failed'].includes(connection.kind);
  const Phone = CONCEPT_ICONS.phone;
  const Wifi = CONCEPT_ICONS.wifi;
  const Trust = CONCEPT_ICONS.privacy;
  return (
    <div
      data-slot="wifi-workspace"
      data-phone-state={connection.kind}
      className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)_auto] gap-4"
    >
      {transfer.enabled ? (
        <StatusBand transfer={transfer} />
      ) : (
        <div data-slot="listening" data-state="off" className="flex items-center gap-3">
          <Wifi aria-hidden className="size-5 shrink-0 text-ink-2" />
          <div role="status" className="min-w-0 flex-1">
            <h2 className="m-0 type-section text-ink">{t`Connect your phone`}</h2>
            <p className="mt-1 mb-0 type-body text-ink-2">{t`Nothing listens on your network until you connect.`}</p>
          </div>
          <Button
            data-action="wifi-connect"
            variant="primary"
            icon={CONCEPT_ICONS.wifi}
            onClick={onConnect}
          >{t`Connect`}</Button>
        </div>
      )}
      <div className="grid min-h-0 grid-cols-[minmax(0,1fr)_minmax(230px,0.55fr)] gap-6 border-t border-rule pt-4">
        <section aria-label={t`Phone pairing`} className="flex min-h-0 min-w-0 flex-col justify-center gap-3">
          <NetworkWarnings session={transfer.session} />
          {dormant ? (
            <div
              data-slot="pairing-dormant"
              className="grid grid-cols-[224px_minmax(0,1fr)] items-center gap-5"
            >
              <div
                aria-hidden
                className="flex size-56 items-center justify-center rounded-xl border border-dashed border-rule-strong bg-well"
              >
                <Phone className="size-12 text-ink-3" />
              </div>
              <div className="flex min-w-0 flex-col gap-3">
                <h2 className="m-0 type-page-title text-balance text-ink">{t`From your phone to your next video.`}</h2>
                <p className="m-0 type-body text-ink-2">
                  {connection.kind === 'off'
                    ? t`Connect to show a private QR code. Scan it, approve your phone here, then choose the clips to send.`
                    : t`No code while your computer isn’t listening. Start again to make a fresh code and PIN.`}
                </p>
              </div>
            </div>
          ) : (
            <WifiWorkspacePairing transfer={transfer} />
          )}
        </section>
        <WifiWorkspaceIncoming transfer={transfer} />
      </div>
      <footer className="flex items-start gap-4 border-t border-rule pt-3">
        <Trust aria-hidden className="mt-0.5 size-4 shrink-0 text-ink-2" />
        <div className="min-w-0 flex-1 type-meta text-ink-2">
          <p className="m-0">{t`Keep both devices on the same Wi-Fi. Reception continues when you leave this page.`}</p>
          <p className="mt-1 mb-0">{t`Clips travel over your Wi-Fi without encryption, so use this on a network you trust. On public Wi-Fi, bring them in with a cable instead.`}</p>
        </div>
        <Button asChild size="sm" variant="ghost" icon={CONCEPT_ICONS.help}>
          <Link
            to="/library/import/$method/help"
            params={{ method: 'phone-wifi' }}
          >{t`Connection help`}</Link>
        </Button>
      </footer>
    </div>
  );
}
