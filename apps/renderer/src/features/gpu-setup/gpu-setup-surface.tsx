// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: NVIDIA GPU setup, where it shows · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.5 · LNX1-TRM: one surface in first run's This computer step, Settings › Models and About's
 *   Local compute. While the download holds NVIDIA's CUDA libraries back on their terms: the terms card (first run
 *   and About; "Not now" for the session), or in Settings › Models a row with "Review terms and install" that opens
 *   it. Once they are accepted and installed, Settings › Models' row says whose they are and links NVIDIA's terms.
 *   Any other state the hardware report's gpuSetup names: the GPU setup card. Nothing on a machine without an
 *   NVIDIA GPU, and nothing when it is ready.
 * states: reading (nothing until the hardware report is in) · terms (card, or the row and its card) · accepting ·
 *   declined · accepted (the ownership row) · restart · old driver · no driver · old GPU · damaged · ready (nothing)
 * pre-emit critique: P5 H4 E4 S5 R5 V4 · slop subset: pass (1-7, 10-19, 22-27, 37-38a, 40-41, 46-49)
 */
import { Trans, useLingui } from '@lingui/react/macro';
import type { GpuSetup, HardwareReport } from '@taalcut/core';
import { Button, cn, useHostPlatform } from '@taalcut/ui';
import { useId, useState, type ReactNode } from 'react';
import { useBackend } from '../../backend/backend';
import { useRpcQuery } from '../../backend/use-rpc';
import { useDownloads } from '../downloads/downloads-store';
import { useDownloadActions } from '../downloads/use-download-actions';
import { formatBytes } from '../shared/format';
import { gpuGuideFor } from './gpu-guides';
import { GpuSetupCard, isGuided, type GuidedState } from './gpu-setup-card';
import {
  CUDA_RUNTIME,
  hasTerms,
  NVIDIA_OWNER,
  useAcceptTerms,
  useDeclined,
  type TermsComponent,
} from './nvidia-terms';
import { NvidiaTermsCard, TermsDocuments } from './nvidia-terms-card';
import { OwnershipLine } from './ownership-line';

/**
 * The hardware report (its gpuSetup), read again whenever the CUDA runtime's row or hold changes, so accepting,
 * installing and repairing move the card on; the CUDA runtime as the download has it, held back or listed.
 */
export function useGpuSetup() {
  const backend = useBackend();
  const { downloads } = useDownloads();
  const listed = downloads?.components.find((each) => each.id === CUDA_RUNTIME);
  const hold = downloads?.awaitingTerms?.find((each) => each.component.id === CUDA_RUNTIME)?.component;
  const key = `${listed?.status ?? '-'}:${hold ? 'held' : '-'}`;
  const hardware = useRpcQuery((signal) => backend.system.hardware(undefined, { signal }), [backend, key]);
  const nvidia = (component: typeof hold) =>
    component && hasTerms(component) && component.terms.owner === NVIDIA_OWNER ? component : undefined;
  // Until the first report is in (or has failed: the card then says "your NVIDIA GPU"), the card waits.
  const reading = hardware.status === 'loading' && hardware.data === undefined;
  return { report: hardware.data, reading, held: nvidia(hold), listed: nvidia(listed) };
}

const guided = (setup: GpuSetup | undefined): setup is GpuSetup & { state: GuidedState } =>
  setup !== undefined && isGuided(setup.state);

/** The GPU the CUDA libraries are for: the setup's, else the first NVIDIA GPU the probe lists. */
const gpuNameOf = (report: HardwareReport | undefined) =>
  report?.gpuSetup?.gpuName ?? report?.info.gpus?.find((gpu) => gpu.vendor === 'nvidia')?.name;

function Guided({
  report,
  className,
}: {
  report: HardwareReport | undefined;
  className?: string | undefined;
}) {
  const platform = useHostPlatform();
  const actions = useDownloadActions();
  const setup = report?.gpuSetup;
  if (!guided(setup)) return null;
  return (
    <GpuSetupCard
      setup={setup}
      guide={gpuGuideFor(platform)}
      osName={report?.info.osName}
      onReinstall={() => actions.start()}
      reinstalling={actions.pending === 'start'}
      className={className}
    />
  );
}

/** First run's This computer step and About's Local compute: the card the machine needs now, if any. */
export function GpuSetupSurface({ className }: { className?: string }) {
  const { report, reading, held } = useGpuSetup();
  const accept = useAcceptTerms();
  const [declined, decline] = useDeclined(CUDA_RUNTIME);
  if (held) {
    if (declined || reading) return null;
    return (
      <NvidiaTermsCard
        component={held}
        gpuName={gpuNameOf(report)}
        accept={accept}
        onDecline={decline}
        className={className}
      />
    );
  }
  return <Guided report={report} className={className} />;
}

/** A row of Settings › Models' NVIDIA part: its name, then what it says and does. */
function Row({ component, children }: { component: TermsComponent; children: ReactNode }) {
  return (
    <div
      data-slot="cuda-runtime-row"
      data-component={component.id}
      className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-t border-rule-subtle pt-3"
    >
      {children}
    </div>
  );
}

/** Settings › Models: NVIDIA's CUDA libraries, held on their terms or installed, and what the GPU still needs. */
export function GpuSetupSettings() {
  const { i18n } = useLingui();
  const { report, held, listed } = useGpuSetup();
  const accept = useAcceptTerms();
  const [open, setOpen] = useState(false);
  const cardId = useId();
  const size = held ? formatBytes(i18n, held.sizeBytes) : '';
  return (
    <>
      {held ? (
        <Row component={held}>
          <span className="flex min-w-0 flex-col gap-0.5 text-sm">
            <span className="font-medium text-ink" translate="no">
              {held.name}
            </span>
            <span className="text-xs text-ink-3">
              <Trans>Not installed · {size} · waits for NVIDIA’s terms</Trans>
            </span>
          </span>
          {open ? null : (
            <Button size="sm" aria-controls={cardId} aria-expanded={false} onClick={() => setOpen(true)}>
              <Trans>Review terms and install</Trans>
            </Button>
          )}
          {open ? (
            <div id={cardId} className="basis-full">
              <NvidiaTermsCard
                component={held}
                gpuName={gpuNameOf(report)}
                accept={accept}
                onDecline={() => setOpen(false)}
              />
            </div>
          ) : null}
        </Row>
      ) : listed?.terms.accepted ? (
        <Row component={listed}>
          <span className="flex min-w-0 flex-col gap-1 text-sm">
            <span className="font-medium text-ink" translate="no">
              {listed.name}
            </span>
            <OwnershipLine component={listed} />
            <TermsDocuments component={listed} />
          </span>
        </Row>
      ) : null}
      <Guided report={report} className={cn(held || listed ? 'mt-1' : undefined)} />
    </>
  );
}
