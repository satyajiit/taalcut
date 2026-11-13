// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: a cable import run · genre: atmospheric studio app · system: DESIGN.md v0.3
 * one hairline block, neutral like all background work: the phone's name, "84 of 120 · 3.1 of 6.2 GB · 2 min left",
 *   an ink-3 bar on transform; Pause and Carry on; done says what came in, with duplicates and iCloud counted.
 * states: running (bar) · paused by you (Carry on) · paused by the phone (the reason, Carry on) · succeeded (the
 *   check and the counts, announced) · failed (ErrorLine) · cancelled (one line) · loading (first read: bones)
 * motion: the bar's transform (--dur-short); reduced motion: base.css stops it moving
 */
import type { MessageDescriptor } from '@lingui/core';
import { msg, plural } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import { callRpc, type DeviceImportRunId, type DeviceRun } from '@taalcut/core';
import { Button, ErrorLine, SkeletonLines, UserContent, useHostPlatform, VERB_ICONS } from '@taalcut/ui';
import { CircleCheck, Smartphone } from 'lucide-react';
import { useEffect, useId } from 'react';
import { useBackend } from '../../../backend/backend';
import { useRpcStream } from '../../../backend/use-rpc';
import { JobBar } from '../../../features/downloads/job-bar';
import { formatTimeLeft } from '../../../features/downloads/time-left';
import { formatBytes } from '../../../features/shared/format';

const PAUSED: Record<NonNullable<DeviceRun['pauseReason']>, MessageDescriptor> = {
  person: msg`Paused.`,
  'device-gone': msg`The phone was unplugged. Plug it in again to carry on.`,
  locked: msg`The phone locked. Unlock it to carry on.`,
  'disk-full': msg`This Mac is out of space. Free some up to carry on.`,
  'originals-offline': msg`The drive Taalcut keeps imports on isn’t connected.`,
};
/** The same, off a Mac (UX3). */
const DISK_FULL_COMPUTER = msg`This computer is out of space. Free some up to carry on.`;

type RunCall = 'pauseDeviceImport' | 'resumeDeviceImport';

/** A finished run: what came in, with the duplicates counted. */
function RunDone({ totals }: { totals: DeviceRun['totals'] }) {
  return (
    <p role="status" className="m-0 flex items-center gap-1.5 text-sm font-medium text-ink">
      <CircleCheck aria-hidden className="size-4 text-success-strong" />
      {totals.duplicates > 0
        ? plural(totals.duplicates, {
            one: `${plural(totals.imported, { one: '# clip imported.', other: '# clips imported.' })} # was already here.`,
            other: `${plural(totals.imported, { one: '# clip imported.', other: '# clips imported.' })} # were already here.`,
          })
        : plural(totals.imported, { one: '# clip imported.', other: '# clips imported.' })}
    </p>
  );
}

/** How far a run got: "84 of 120 · 3.1 of 6.2 GB · 2 min left". */
function RunCounts({ run }: { run: DeviceRun }) {
  const { t, i18n } = useLingui();
  const { totals } = run;
  const done = i18n.number(totals.done);
  const all = i18n.number(totals.items);
  const bytesDone = formatBytes(i18n, totals.bytesDone);
  const bytes = formatBytes(i18n, totals.bytes);
  const counts = t`${done} of ${all}`;
  const sizes = t`${bytesDone} of ${bytes}`;
  const left = run.etaMs && run.state === 'running' ? formatTimeLeft(i18n, run.etaMs) : null;
  return (
    <p className="m-0 flex flex-wrap gap-x-2 text-sm text-ink-2 tabular-nums">
      <span>{counts}</span>
      <span aria-hidden>·</span>
      <span>{sizes}</span>
      {left ? (
        <>
          <span aria-hidden>·</span>
          <span>
            <Trans>{left} left</Trans>
          </span>
        </>
      ) : null}
    </p>
  );
}

/** Pause while it runs; while paused, why, and Carry on. */
function RunControls({ run, act }: { run: DeviceRun; act: (call: RunCall) => void }) {
  const { i18n } = useLingui();
  const mac = useHostPlatform() === 'mac';
  const reason = run.pauseReason ?? 'person';
  if (run.state === 'paused')
    return (
      <div className="flex flex-wrap items-center gap-3">
        <p role="status" className="m-0 text-sm text-ink-2">
          {i18n._(reason === 'disk-full' && !mac ? DISK_FULL_COMPUTER : PAUSED[reason])}
        </p>
        <Button
          size="sm"
          variant="secondary"
          icon={VERB_ICONS.play}
          onClick={() => act('resumeDeviceImport')}
        >
          <Trans>Carry on</Trans>
        </Button>
      </div>
    );
  if (run.state !== 'running') return null;
  return (
    <Button
      size="sm"
      variant="ghost"
      icon={VERB_ICONS.pause}
      className="-ml-3 self-start"
      onClick={() => act('pauseDeviceImport')}
    >
      <Trans>Pause</Trans>
    </Button>
  );
}

/** The run as it stands: done, stopped, or its counts, bar and controls. */
function RunBody({ run, titleId, act }: { run: DeviceRun; titleId: string; act: (call: RunCall) => void }) {
  const { totals } = run;
  if (run.state === 'succeeded') return <RunDone totals={totals} />;
  if (run.state === 'cancelled')
    return (
      <p role="status" className="m-0 text-sm text-ink-2">
        <Trans>Stopped. What came in is in your Library.</Trans>
      </p>
    );
  return (
    <>
      <RunCounts run={run} />
      <JobBar labelledBy={titleId} fraction={totals.bytes > 0 ? totals.bytesDone / totals.bytes : 0} />
      <RunControls run={run} act={act} />
    </>
  );
}

export function DeviceRunBlock({
  runId,
  onRun,
}: {
  runId: DeviceImportRunId;
  /** Every change of the run: the step follows it. */
  onRun?: (run: DeviceRun) => void;
}) {
  const { i18n } = useLingui();
  const backend = useBackend();
  const titleId = useId();
  const stream = useRpcStream(
    (signal) => backend.transfer.deviceRun({ runId }, { signal }),
    [backend, runId],
  );
  const run = stream.data;
  useEffect(() => {
    if (run) onRun?.(run);
  }, [run, onRun]);
  if (!run) {
    if (stream.error) return <ErrorLine error={stream.error} />;
    return <SkeletonLines lines={2} className="max-w-xl" />;
  }
  const inICloud = i18n.number(run.totals.inICloud);
  const act = (call: RunCall) => void callRpc(backend.transfer[call]({ runId }));

  return (
    <section
      aria-labelledby={titleId}
      data-run-state={run.state}
      className="flex max-w-xl flex-col gap-2 border-t border-rule-subtle pt-4"
    >
      <h2 id={titleId} className="m-0 flex items-center gap-2 text-base font-semibold text-ink">
        <Smartphone aria-hidden className="size-4 shrink-0 text-ink-3" />
        <UserContent translate="no">{run.deviceLabel}</UserContent>
      </h2>
      <RunBody run={run} titleId={titleId} act={act} />
      {run.totals.inICloud > 0 ? (
        <p className="m-0 text-sm text-ink-2">
          <Trans>{inICloud} are in iCloud, not on the phone. Import them over Wi-Fi.</Trans>
        </p>
      ) : null}
      {run.error ? <ErrorLine error={run.error} /> : null}
    </section>
  );
}
