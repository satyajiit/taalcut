// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · Operate · DESIGN.md: one compact desktop USB cable workspace, parallel to WifiWorkspace.
 * States: unavailable off macOS, waiting for a phone, found/opening, phone access prompts, ready, and errors. */
import { Trans, useLingui } from '@lingui/react/macro';
import { callRpc, type DevicesState, type DeviceView, type TaalcutError } from '@taalcut/core';
import {
  Button,
  CONCEPT_ICONS,
  ErrorLine,
  KaatuMoment,
  UserContent,
  usePlatformFeatures,
  VERB_ICONS,
} from '@taalcut/ui';
import { Link } from '@tanstack/react-router';
import { Cable, CirclePause, LoaderCircle } from 'lucide-react';
import { useState } from 'react';
import { useBackend } from '../../../../backend/backend';
import { useRpcStream } from '../../../../backend/use-rpc';
import { accessWordsFor, canRetryDeviceAccess } from '../../../../onboarding/setup/sources/device-words';
import { ImportError } from '../../imports/import-error';
import type { StepState } from '../session/connection';
import { Step } from './steps';

type Beats = readonly [StepState, StepState, StepState];

function cableBeats(device: DeviceView | undefined): Beats {
  if (!device) return ['current', 'next', 'next'];
  if (device.access === 'ready') return ['done', 'done', 'current'];
  return ['done', 'current', 'next'];
}

function CableDevicePrompt({
  device,
  pending,
  opening,
  onOpen,
  onConnect,
}: {
  device: DeviceView;
  pending: boolean;
  opening: boolean;
  onOpen: (deviceKey: string) => void;
  onConnect: (deviceKey: string) => void;
}) {
  const { i18n } = useLingui();
  const name = <UserContent translate="no">{device.label}</UserContent>;
  const retryable = canRetryDeviceAccess(device);
  const busy = pending || opening;
  if (device.bridge === null || device.access === 'opening') {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-rule-subtle bg-well px-3 py-2">
        <p className="m-0 min-w-0 flex-1 type-body text-ink">
          <Trans>Found {name}.</Trans>
        </p>
        <Button
          size="sm"
          variant="secondary"
          data-action="open-device"
          loading={busy || device.access === 'opening'}
          disabled={busy}
          onClick={() => onOpen(device.key)}
        >
          <Trans>Use this phone</Trans>
        </Button>
      </div>
    );
  }
  if (device.access === 'ready') {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-rule-subtle bg-well px-3 py-2">
        <p className="m-0 min-w-0 flex-1 type-body text-ink">
          <Trans>Found {name}.</Trans>
        </p>
        <Button size="sm" variant="secondary" loading={pending} disabled={busy} onClick={() => onConnect(device.key)}>
          <Trans>Use this phone</Trans>
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-start gap-2 rounded-lg border border-rule-subtle bg-well px-3 py-2">
      <p role="status" className="m-0 flex items-start gap-2 type-body text-ink">
        {retryable || device.access === 'unsupported' ? null : (
          <LoaderCircle aria-hidden className="mt-1 size-4 shrink-0 animate-spin text-ink-2" />
        )}
        <span>{i18n._(accessWordsFor(device))}</span>
      </p>
      {retryable ? (
        <Button
          size="sm"
          variant="secondary"
          icon={VERB_ICONS.retry}
          loading={busy}
          disabled={busy}
          onClick={() => onOpen(device.key)}
        >
          <Trans>Try again</Trans>
        </Button>
      ) : null}
    </div>
  );
}

export function CableWorkspace({
  pending,
  error,
  onConnect,
}: {
  pending: boolean;
  error: TaalcutError | null;
  onConnect: (deviceId?: string) => void;
}) {
  const { t, i18n } = useLingui();
  const cableAvailable = usePlatformFeatures().cableImport;
  const backend = useBackend();
  const [round, setRound] = useState(0);
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState<TaalcutError | null>(null);
  const devices = useRpcStream<DevicesState>(
    async (signal) =>
      cableAvailable
        ? backend.transfer.devices(undefined, { signal })
        : (async function* () {
            yield { devices: [], runs: [] };
          })(),
    [backend, cableAvailable, round],
  );
  const connected = devices.data?.devices.filter((each) => each.connected) ?? [];
  const device = connected[0];
  const [plug, allow, pick] = cableBeats(device);
  const Trust = CONCEPT_ICONS.privacy;

  const openDevice = async (deviceKey: string) => {
    if (opening || pending) return;
    setOpening(true);
    setOpenError(null);
    const result = await callRpc(backend.transfer.openDevice({ deviceKey }));
    setOpening(false);
    if (!result.ok) {
      setOpenError(result.error);
      return;
    }
    if (result.value.access === 'ready') onConnect(deviceKey);
  };

  if (!cableAvailable) {
    return (
      <div
        data-slot="cable-workspace"
        data-state="unavailable"
        className="flex min-h-0 flex-1 flex-col justify-between gap-4"
      >
        <div className="flex flex-col items-start gap-4 rounded-xl border border-rule-subtle bg-well p-5">
          <p className="m-0 type-body text-ink">
            <Trans>Cable import is unavailable on this computer. Use phone Wi-Fi instead.</Trans>{' '}
            <Link
              to="/library/import/$method"
              params={{ method: 'phone-wifi' }}
              className="underline underline-offset-4"
            >
              {t`Connect over Wi-Fi`}
            </Link>
          </p>
        </div>
        <footer className="flex items-center justify-end border-t border-rule pt-3">
          <Button asChild size="sm" variant="ghost" icon={CONCEPT_ICONS.help}>
            <Link
              to="/library/import/$method/help"
              params={{ method: 'phone-cable' }}
            >{t`Connection help`}</Link>
          </Button>
        </footer>
      </div>
    );
  }

  const activeError = error ?? openError;
  const name = device ? <UserContent translate="no">{device.label}</UserContent> : null;

  return (
    <div
      data-slot="cable-workspace"
      data-phone-state={device ? device.access : 'waiting'}
      className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)_auto] gap-4"
    >
      <div data-slot="cable-status" className="flex items-center gap-3">
        <Cable aria-hidden className="size-5 shrink-0 text-ink-2" />
        <div role="status" className="min-w-0 flex-1">
          <h2 className="m-0 type-section text-ink">
            {device ? <Trans>Found {name}.</Trans> : t`Plug your phone into this Mac`}
          </h2>
          <p className="mt-1 mb-0 type-body text-ink-2">
            {device && device.access !== 'ready'
              ? i18n._(accessWordsFor(device))
              : t`Connect a phone and choose its originals.`}
          </p>
        </div>
        <Button
          data-action="import-connect"
          variant="primary"
          loading={pending || opening}
          onClick={() => onConnect(device?.key)}
        >
          {t`Connect`}
        </Button>
      </div>

      <div className="grid min-h-0 grid-cols-[minmax(0,1fr)_minmax(230px,0.55fr)] gap-6 border-t border-rule pt-4">
        <section
          aria-label={t`Plug your phone into this Mac`}
          className="flex min-h-0 min-w-0 flex-col justify-center gap-3"
        >
          <ol className="m-0 flex list-none flex-col gap-3 p-0">
            <Step n={1} state={plug} title={t`Plug your phone into this Mac`}>
              <p className="m-0 max-w-prose type-meta text-ink-2">
                {t`Taalcut looks for a phone on a cable only while this tab is open.`}
              </p>
              {devices.status === 'error' ? (
                <ErrorLine error={devices.error} onRetry={() => setRound((was) => was + 1)} />
              ) : null}
            </Step>
            <Step n={2} state={allow} title={t`Allow it on the phone`}>
              {device ? (
                <CableDevicePrompt
                  device={device}
                  pending={pending}
                  opening={opening}
                  onOpen={(key) => void openDevice(key)}
                  onConnect={(key) => onConnect(key)}
                />
              ) : (
                <p className="m-0 max-w-prose type-meta text-ink-2">
                  {t`An iPhone asks you to unlock it and tap Trust. An Android phone asks what the cable is for: choose File transfer.`}
                </p>
              )}
            </Step>
            <Step n={3} state={pick} last title={t`Choose what to bring in`}>
              <p className="m-0 max-w-prose type-meta text-ink-2">
                {t`The last 30 days of videos and Live Photos, only what’s new, or choose others.`}
              </p>
              {connected.length > 1 ? (
                <div className="flex flex-wrap gap-2">
                  {connected.map((each) => (
                    <Button
                      key={each.key}
                      size="sm"
                      variant="secondary"
                      disabled={pending}
                      onClick={() => onConnect(each.key)}
                    >
                      <span translate="no">{each.label}</span>
                    </Button>
                  ))}
                </div>
              ) : null}
            </Step>
          </ol>
          {activeError ? (
            <ImportError
              error={activeError}
              onRetry={() => {
                setOpenError(null);
                onConnect(device?.key);
              }}
            />
          ) : null}
        </section>

        <section
          aria-label={t`Choose what to bring in`}
          className="flex min-h-0 min-w-0 flex-col justify-between gap-3 border-l border-rule pl-5"
        >
          <div className="flex flex-col gap-3">
            <KaatuMoment tone="tip">
              {t`Live Photos keep their motion over a cable. Sent over Wi-Fi from the phone’s browser, they arrive as stills.`}
            </KaatuMoment>
            <p className="m-0 flex items-start gap-2 type-meta text-ink-2">
              <CirclePause aria-hidden className="mt-0.5 size-4 shrink-0 text-ink-2" />
              {t`Leaving this page doesn’t stop an import. Unplugging pauses it, and plugging back in carries on.`}
            </p>
          </div>
          <p className="m-0 type-meta text-ink-2">
            <Trans>
              You can still send clips{' '}
              <Link
                to="/library/import/$method"
                params={{ method: 'phone-wifi' }}
                className="underline underline-offset-4"
              >
                over Wi-Fi
              </Link>
              .
            </Trans>
          </p>
        </section>
      </div>

      <footer className="flex items-start justify-between gap-4 border-t border-rule pt-3">
        <div className="flex min-w-0 flex-1 items-start gap-3 type-meta text-ink-2">
          <Trust aria-hidden className="mt-0.5 size-4 shrink-0 text-ink-2" />
          <p className="m-0">{t`No network needed, and nothing travels over Wi-Fi. Use it on public networks too.`}</p>
        </div>
        <Button asChild size="sm" variant="ghost" icon={CONCEPT_ICONS.help}>
          <Link
            to="/library/import/$method/help"
            params={{ method: 'phone-cable' }}
          >{t`Connection help`}</Link>
        </Button>
      </footer>
    </div>
  );
}
