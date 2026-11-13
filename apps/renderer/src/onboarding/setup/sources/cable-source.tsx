// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: onboarding, my phone with a cable · genre: atmospheric studio app · system: DESIGN.md v0.4
 * "Plug your phone in" until one is; then Use <phone> opens it, and the phone's own prompts (Unlock, Trust, File
 *   transfer, Allow) are said in words as they come; ready shows the picker; a run shows its block. An unfinished
 *   run from before offers Carry on.
 * states: waiting for a phone (status line) · found (Use <phone>, secondary) · opening (the button spins) · a prompt
 *   on the phone (its words, announced) · busy (Try again) · unsupported (use Wi-Fi) · ready (the picker) ·
 *   importing (the run block) · error (ErrorLine; the phone list unreadable: ErrorLine and Try again, v0.4, UX1) ·
 *   not on this system yet (off a Mac, UX3-MAC: says so and points at the Wi-Fi way, never a wait for a phone)
 */
import { Trans, useLingui } from '@lingui/react/macro';
import {
  callRpc,
  type DeviceImportRunId,
  type DeviceRun,
  type DeviceView,
  type TaalcutError,
} from '@taalcut/core';
import {
  Button,
  ErrorLine,
  UserContent,
  usePlatformChoice,
  usePlatformFeatures,
  VERB_ICONS,
} from '@taalcut/ui';
import { Cable, LoaderCircle } from 'lucide-react';
import { useState } from 'react';
import { useBackend } from '../../../backend/backend';
import { useRpcStream } from '../../../backend/use-rpc';
import { CablePicker } from './cable-picker';
import { DeviceRunBlock } from './device-run';
import { accessWordsFor, canRetryDeviceAccess } from './device-words';

function Phone({ device, onStarted }: { device: DeviceView; onStarted: (runId: DeviceImportRunId) => void }) {
  const { i18n } = useLingui();
  const backend = useBackend();
  const [opening, setOpening] = useState(false);
  const [opened, setOpened] = useState(device.bridge !== null);
  const [error, setError] = useState<TaalcutError | null>(null);
  const open = async () => {
    if (opening) return;
    setOpening(true);
    setError(null);
    const result = await callRpc(backend.transfer.openDevice({ deviceKey: device.key }));
    setOpening(false);
    if (!result.ok) return setError(result.error);
    setOpened(true);
  };
  const resume = async (runId: DeviceImportRunId) => {
    const result = await callRpc(backend.transfer.resumeDeviceImport({ runId }));
    if (!result.ok) return setError(result.error);
    onStarted(runId);
  };
  const name = <UserContent translate="no">{device.label}</UserContent>;
  const retryable = canRetryDeviceAccess(device);

  if (device.unfinishedRunId) {
    const runId = device.unfinishedRunId;
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="m-0 text-base text-ink">
          <Trans>The last import from {name} stopped part-way.</Trans>
        </p>
        <Button variant="primary" onClick={() => void resume(runId)}>
          <Trans>Carry on importing</Trans>
        </Button>
        {error ? <ErrorLine error={error} /> : null}
      </div>
    );
  }
  if (!opened || device.access === 'opening')
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="m-0 text-base text-ink">
          <Trans>Found {name}.</Trans>
        </p>
        <Button
          variant="secondary"
          data-action="open-device"
          loading={opening || device.access === 'opening'}
          onClick={() => void open()}
        >
          <Trans>Use this phone</Trans>
        </Button>
        {error ? <ErrorLine error={error} /> : null}
      </div>
    );
  if (device.access === 'ready') return <CablePicker device={device} onStarted={onStarted} />;
  return (
    <div className="flex flex-col items-start gap-3">
      <p role="status" className="m-0 flex items-start gap-2 text-base text-ink">
        {retryable || device.access === 'unsupported' ? null : (
          <LoaderCircle aria-hidden className="mt-1 size-4 shrink-0 animate-spin text-ink-2" />
        )}
        {i18n._(accessWordsFor(device))}
      </p>
      {retryable ? (
        <Button
          size="sm"
          variant="secondary"
          icon={VERB_ICONS.retry}
          loading={opening}
          onClick={() => void open()}
        >
          <Trans>Try again</Trans>
        </Button>
      ) : null}
      {error ? <ErrorLine error={error} /> : null}
    </div>
  );
}

/** Off a Mac the cable isn't here yet (platform-features.ts; the Library's cable tab says the same). */
function CableNotYet() {
  const { t } = useLingui();
  const choose = usePlatformChoice();
  const wifi = t({ id: 'onboarding.sources.wifi.title', message: 'My phone, over Wi-Fi' });
  return (
    <div data-slot="cable-way" data-state="unavailable" className="flex flex-col gap-2">
      <p className="m-0 text-base font-medium text-ink">
        {choose({
          mac: null,
          computer: <Trans>Bringing clips in with a cable isn’t on Linux yet</Trans>,
          windows: <Trans>Bringing clips in with a cable isn’t on Windows yet</Trans>,
        })}
      </p>
      <p className="m-0 max-w-[60ch] text-sm text-ink-2">
        <Trans>Choose “{wifi}” instead. The phone needs no app, only its browser.</Trans>
      </p>
    </div>
  );
}

/** The cable way's panel: a run under way, else a phone to plug in where the system has the cable (a Mac). */
export function CableSource(props: {
  /** The run this step started, if any (kept by the step, so a resume shows it). */
  runId: DeviceImportRunId | null;
  onStarted: (runId: DeviceImportRunId) => void;
  onRun?: (run: DeviceRun) => void;
}) {
  const { cableImport } = usePlatformFeatures();
  if (!cableImport && !props.runId) return <CableNotYet />;
  return <CableWait {...props} />;
}

function CableWait({
  runId,
  onRun,
  onStarted,
}: {
  /** The run this step started, if any (kept by the step, so a resume shows it). */
  runId: DeviceImportRunId | null;
  onStarted: (runId: DeviceImportRunId) => void;
  onRun?: (run: DeviceRun) => void;
}) {
  const backend = useBackend();
  // Try again opens the stream afresh: the round is a dependency, so the old stream ends and a new one starts.
  const [round, setRound] = useState(0);
  const devices = useRpcStream((signal) => backend.transfer.devices(undefined, { signal }), [backend, round]);
  if (runId) return <DeviceRunBlock runId={runId} {...(onRun ? { onRun } : {})} />;
  const device = devices.data?.devices.find((each) => each.connected);
  if (devices.error)
    return (
      <div className="flex flex-col items-start gap-2">
        <ErrorLine error={devices.error} />
        <Button
          size="sm"
          variant="secondary"
          data-action="retry-devices"
          icon={VERB_ICONS.retry}
          onClick={() => setRound((n) => n + 1)}
        >
          <Trans>Try again</Trans>
        </Button>
      </div>
    );
  if (!device)
    return (
      <div className="flex flex-col gap-2">
        <p role="status" className="m-0 flex items-center gap-2 text-base text-ink">
          <Cable aria-hidden className="size-4 shrink-0 text-ink-3" />
          <Trans>Plug your phone into this Mac with its cable.</Trans>
        </p>
        <p className="m-0 max-w-[60ch] text-sm text-ink-2">
          <Trans>
            An iPhone asks you to unlock it and tap Trust. An Android phone asks what the cable is for: choose
            File transfer.
          </Trans>
        </p>
      </div>
    );
  return <Phone key={device.key} device={device} onStarted={onStarted} />;
}
