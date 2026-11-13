// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · pre-emit critique: P4 H4 E4 S4 R5 V4
 * Hallmark · component: update status row · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.3 · one hairline row on the raised list: what the updater is doing in plain words, a quiet
 *   second line (when it last checked, how far a download is), and the one action that fits (Check now, See
 *   what's new, Try again). A download is a background job: neutral bar scaled by transform, a spinner, no violet.
 * states: default (up to date · Check now) · hover/focus/active (Button) · disabled (off in this build: no
 *   action) · loading (checking: the spinner and "Checking for updates…"; Check now spins) · error (the cause,
 *   UpdateErrorLine, Try again) · success (ready: "Taalcut 0.3.0 is ready", See what's new and Restart now, which
 *   spins while main quits and says why if main refuses) · downloading
 *   (version, percent, the bar)
 * contrast: pass (ink and ink-2 on raised, the bar's ink-3 on sunken 3:1)
 */
import { Trans, useLingui } from '@lingui/react/macro';
import type { TaalcutError, UpdateState } from '@taalcut/core';
import { Button, errorMessage } from '@taalcut/ui';
import { CircleCheck, Download, LoaderCircle, PowerOff } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { formatDateTime, formatPercent } from '../shared/format';
import { openUpdateDialog } from './update-dialog-state';
import { UpdateErrorLine } from './update-error-line';
import { useCheckNow, useInstallNow } from './use-updates';

/** The ready row's second line: when it installs, or why Restart now didn't. */
function RestartDetail({ failure }: { failure: TaalcutError | null }) {
  const { i18n } = useLingui();
  if (failure)
    return (
      <span role="alert" className="text-danger-strong">
        {errorMessage(i18n, failure)}
      </span>
    );
  return <Trans>It installs when you restart Taalcut, or now with Restart now.</Trans>;
}

function Row({
  icon,
  title,
  detail,
  action,
}: {
  icon: ReactNode;
  title: ReactNode;
  detail?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-h-12 flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2.5">
      <div className="flex min-w-0 flex-[1_1_18rem] items-start gap-3">
        <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center text-ink-2">{icon}</span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="m-0 type-label text-ink">{title}</p>
          {detail ? <div className="type-meta text-ink-2 tabular-nums">{detail}</div> : null}
        </div>
      </div>
      {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
    </div>
  );
}

/** Settings › General › Updates' first row: the updater's status, live from updates.changed. */
export function UpdateStatus({ state }: { state: UpdateState }) {
  const { t, i18n } = useLingui();
  const check = useCheckNow();
  const install = useInstallNow();
  // Main refused to restart (desktop.update_not_ready): the row says why, and the update still installs on quit.
  const [restartFailure, setRestartFailure] = useState<TaalcutError | null>(null);
  const checkNow = (label: ReactNode) => (
    <Button size="sm" variant="secondary" loading={check.pending} onClick={() => void check.run()}>
      {label}
    </Button>
  );
  const { status } = state;
  switch (status.kind) {
    case 'off':
      return (
        <Row
          icon={<PowerOff aria-hidden className="size-4" />}
          title={<Trans>Updates are off in this build</Trans>}
          detail={<Trans>A build from the download page updates itself.</Trans>}
        />
      );
    case 'idle': {
      const at = status.checkedAt;
      const checked = at === undefined ? null : formatDateTime(i18n, at);
      return (
        <Row
          icon={<CircleCheck aria-hidden className="size-4 text-success-strong" />}
          title={<Trans>Taalcut is up to date</Trans>}
          detail={
            checked && at !== undefined ? (
              <Trans>
                Last checked{' '}
                <time dateTime={new Date(at).toISOString()} className="font-sans">
                  {checked}
                </time>
              </Trans>
            ) : null
          }
          action={checkNow(<Trans>Check now</Trans>)}
        />
      );
    }
    case 'checking':
      return (
        <div role="status">
          <Row
            icon={<LoaderCircle aria-hidden className="size-4 animate-spin" />}
            title={<Trans>Checking for updates…</Trans>}
          />
        </div>
      );
    case 'downloading': {
      const version = status.version;
      const percent = formatPercent(i18n, status.percent / 100);
      return (
        <Row
          icon={<LoaderCircle aria-hidden className="size-4 animate-spin" />}
          title={
            <Trans>
              Downloading Taalcut <span translate="no">{version}</span>
            </Trans>
          }
          detail={
            <div className="flex flex-col gap-2">
              <span>
                {status.delta ? (
                  <Trans>{percent} · only the parts that changed</Trans>
                ) : (
                  <Trans>{percent} · you can keep working</Trans>
                )}
              </span>
              <div
                role="progressbar"
                aria-label={t`Update download`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(status.percent)}
                className="h-1 w-full max-w-sm overflow-hidden rounded-pill bg-sunken"
              >
                <div
                  className="h-full origin-left bg-ink-3 transition-transform duration-(--dur-short) ease-(--ease-out) rtl:origin-right"
                  style={{ transform: `scaleX(${status.percent / 100})` }}
                />
              </div>
            </div>
          }
        />
      );
    }
    case 'ready': {
      const version = status.version;
      return (
        <Row
          icon={<Download aria-hidden className="size-4 text-primary-strong" />}
          title={
            <Trans>
              Taalcut <span translate="no">{version}</span> is ready
            </Trans>
          }
          detail={<RestartDetail failure={restartFailure} />}
          action={
            <>
              <Button size="sm" variant="ghost" data-action="see-whats-new" onClick={openUpdateDialog}>
                <Trans>See what’s new</Trans>
              </Button>
              <Button
                size="sm"
                variant="secondary"
                loading={install.pending}
                onClick={() =>
                  void install.run().then((result) => setRestartFailure(result.ok ? null : result.error))
                }
              >
                <Trans>Restart now</Trans>
              </Button>
            </>
          }
        />
      );
    }
    case 'error':
      return (
        <Row
          icon={<Download aria-hidden className="size-4" />}
          title={<Trans>The last update didn’t install</Trans>}
          detail={<UpdateErrorLine error={status.error} />}
          action={checkNow(<Trans>Try again</Trans>)}
        />
      );
  }
}
