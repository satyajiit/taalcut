// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · Operate · DESIGN.md: live reception stays beside pairing, with only its queue scrolling.
 * States: quiet, connected/lost, incoming, per-file failures and completion; shared controls keep their behavior. */
import { useLingui } from '@lingui/react/macro';
import { Button, CONCEPT_ICONS, KaatuMoment, VERB_ICONS } from '@taalcut/ui';
import { Link } from '@tanstack/react-router';
import { connectionOf, onTheirWay } from '../session/connection';
import { PhoneDevices } from '../transfers/phone-devices';
import { LandedCount, TransferFiles } from '../transfers/transfer-files';
import type { TransferSessionApi } from '../use-transfer-session';
import { ConnectionLine } from './connection-line';

export function WifiWorkspaceIncoming({ transfer }: { transfer: TransferSessionApi }) {
  const { t } = useLingui();
  const Incoming = CONCEPT_ICONS.transfer;
  const connection = connectionOf(transfer);
  const live = ['waiting', 'connected', 'lost'].includes(connection.kind);
  return (
    <section
      aria-label={t`Incoming clips`}
      className="flex min-h-0 min-w-0 flex-col gap-3 border-l border-rule pl-5"
    >
      <h2 className="m-0 flex items-center gap-2 type-section text-ink">
        <Incoming aria-hidden className="size-5 text-ink-2" />
        {t`Incoming clips`}
      </h2>
      {live ? (
        <ConnectionLine
          connection={connection}
          arriving={onTheirWay(transfer.files)}
          approval={transfer.approval}
        />
      ) : null}
      <div
        data-slot="wifi-transfers"
        role="region"
        aria-label={t`Connected phones and incoming files`}
        tabIndex={0}
        className="scrollbar-thin min-h-0 flex-1 overflow-y-auto overscroll-contain pr-2 break-words focus-visible:outline-2 focus-visible:outline-focus"
      >
        <PhoneDevices devices={transfer.session?.devices ?? []} onDisconnect={transfer.disconnect} />
        <TransferFiles files={transfer.files} onCancel={transfer.cancelUpload} />
        {!transfer.files.length ? (
          <div className="flex min-h-40 flex-col justify-center">
            <KaatuMoment tone="tip">{t`Your clips will appear here as they arrive. Each one goes straight to your library.`}</KaatuMoment>
          </div>
        ) : null}
      </div>
      {transfer.files.length ? <LandedCount files={transfer.files} /> : null}
      <Button
        asChild
        size="sm"
        variant="ghost"
        icon={VERB_ICONS.next}
        iconPlacement="end"
        className="self-start"
      >
        <Link to="/library/imports" search={{ phones: true }}>{t`Follow reception`}</Link>
      </Button>
    </section>
  );
}
