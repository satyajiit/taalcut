// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: local-compute · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.6 + UX4 · Settings › General › This Mac: one SettingRow per local job (its name, the runtime
 *   as meta), the backend at the row's end (a "you" badge on the GPU, a warning chip on the CPU with the logged
 *   reason as the row's line)
 * states: default · on the GPU · on the CPU (the reason, ink-2)
 */
import type { MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import { Fragment, type ReactNode } from 'react';
import type { ModelComputeBackend, ComputeReport, GpuSummary, HardwareReport } from '@taalcut/core';
import { Badge, Chip, PageSection, useHostPlatform } from '@taalcut/ui';
import { formatCount, formatMemory } from '../../shared/format';
import { translateKey } from '../model-messages';
import { SettingRow, SettingRows } from '../rows';
import { SETTINGS_ICONS } from '../settings-icons';

const BACKENDS: Record<ModelComputeBackend, MessageDescriptor> = {
  metal: msg`GPU (Metal)`,
  mlx: msg`GPU (MLX)`,
  coreml: msg`GPU and Neural Engine (Core ML)`,
  ane: msg`Neural Engine`,
  webgpu: msg`GPU (WebGPU)`,
  cuda: msg`GPU (CUDA)`,
  rocm: msg`GPU (ROCm)`,
  directml: msg`GPU (DirectML)`,
  vulkan: msg`GPU (Vulkan)`,
  cpu: msg`CPU`,
};

/**
 * Reasons the runtime logs when it falls back to the CPU (GPU first, ADR 0002): models' own keys (core's
 * CPU_FALLBACK_REASON_KEYS), then core's compute.fallback.<reason> for every COMPUTE_FALLBACK_REASONS entry.
 */
export const FALLBACK_REASONS: readonly MessageDescriptor[] = [
  msg({ id: 'compute.fallback.no_gpu_kernels', message: 'This model has no GPU version yet.' }),
  msg({ id: 'compute.fallback.gpu_out_of_memory', message: 'The GPU didn’t have enough free memory.' }),
  msg({
    id: 'compute.fallback.gpu_unsupported',
    message: 'This GPU isn’t supported by the model’s runtime.',
  }),
  // The runtime started on the GPU twice and exited both times; the next start tries the GPU again.
  msg({
    id: 'compute.fallback.gpu_failed_at_runtime',
    message:
      'This model didn’t load on the GPU, so it runs on the CPU for now. Restart Taalcut to try the GPU again.',
  }),
  // Core's reasons (compute/backend.ts), LNX1: none of this job's GPU backends exists here (a GPU hidden, none at all).
  msg({
    id: 'compute.fallback.no_accelerator',
    message: 'Taalcut found no graphics chip it can run this on, so it runs on the CPU.',
  }),
  msg({
    id: 'compute.fallback.unsupported_input',
    message: 'The GPU can’t take this kind of file or model, so this part runs on the CPU.',
  }),
  msg({
    id: 'compute.fallback.accelerator_failed',
    message: 'The GPU was tried and failed, so this runs on the CPU for now.',
  }),
  msg({
    id: 'compute.fallback.out_of_memory',
    message: 'The GPU ran out of memory, so this runs on the CPU.',
  }),
  // TAALCUT_FORCE_CPU=1 (the CPU-only gate) or a setting: the GPU is never tried.
  msg({
    id: 'compute.fallback.disabled',
    message: 'GPU acceleration is turned off, so this runs on the CPU.',
  }),
];
const UNKNOWN_REASON = msg`The GPU couldn’t be used.`;
const JOB = msg`Another job`;

/** What the Graphics fact shows of the primary GPU: the compute report's, or the probe's summary. */
export interface GraphicsInfo {
  readonly name: string;
  /** Apple's GPU cores. */
  readonly cores?: number;
  /** As the runtime names it ('Metal 3', 'CUDA'), shown as is. */
  readonly api?: string;
  readonly vramBytes?: number;
  readonly driverVersion?: string;
}

/** GPU_APIS as their makers write them. Product names, never translated. */
/* eslint-disable lingui/no-unlocalized-strings -- product names */
const API_NAMES: Record<GpuSummary['apis'][number], string> = {
  metal: 'Metal',
  cuda: 'CUDA',
  rocm: 'ROCm',
  directml: 'DirectML',
  vulkan: 'Vulkan',
};
/* eslint-enable lingui/no-unlocalized-strings */

/** The primary GPU: the compute report's when it has one, else the first the probe found (LNX1). */
export function primaryGpu(
  gpu: ComputeReport['gpu'],
  gpus: HardwareReport['info']['gpus'],
): GraphicsInfo | undefined {
  if (gpu) return gpu;
  const first = gpus?.[0];
  if (!first) return undefined;
  const api = first.apis[0];
  return {
    name: first.name,
    ...(api ? { api: API_NAMES[api] } : {}),
    ...(first.vramBytes === undefined ? {} : { vramBytes: first.vramBytes }),
    ...(first.driverVersion === undefined ? {} : { driverVersion: first.driverVersion }),
  };
}

/** The GPU's facts after its name: "16-core GPU · Metal 3", "24 GB · CUDA · driver 615.71.09". Callers key them. */
export function useGraphicsFacts(gpu: GraphicsInfo): ReactNode[] {
  const { i18n } = useLingui();
  const cores = gpu.cores === undefined ? null : formatCount(i18n, gpu.cores);
  const vram = gpu.vramBytes === undefined ? null : formatMemory(i18n, gpu.vramBytes);
  const driver = gpu.driverVersion;
  return [
    cores === null ? null : <Trans>{cores}-core GPU</Trans>,
    vram === null ? null : <span>{vram}</span>,
    gpu.api ? <span translate="no">{gpu.api}</span> : null,
    driver ? (
      <Trans>
        driver <span translate="no">{driver}</span>
      </Trans>
    ) : null,
  ].filter(Boolean);
}

/** "Apple M2 Pro · 16-core GPU · Metal 3", "NVIDIA GeForce RTX 4090 · 24 GB · CUDA · driver 615.71.09". */
export function GraphicsFact({ gpu }: { gpu: GraphicsInfo }) {
  const facts = useGraphicsFacts(gpu);
  return (
    <>
      <span translate="no">{gpu.name}</span>
      {facts.map((fact, i) => (
        <Fragment key={i}>
          {' · '}
          {fact}
        </Fragment>
      ))}
    </>
  );
}

/** Which runtime and backend each local job uses; a CPU fallback shows its logged reason. */
export function LocalCompute({ report }: { report: ComputeReport }) {
  const { t, i18n } = useLingui();
  const platform = useHostPlatform();
  if (report.modules.length === 0) return null;
  return (
    <PageSection
      title={<Trans>Where work runs on this Mac</Trans>}
      icon={SETTINGS_ICONS.gpu}
      description={<Trans>Taalcut uses the graphics chip first, and the CPU only when it has to.</Trans>}
    >
      <SettingRows aria-label={t`Jobs`}>
        {report.modules.map((m) => {
          const job = translateKey(i18n, `models.module.${m.module}.label`, JOB);
          const onCpu = m.backend === 'cpu';
          return (
            <SettingRow
              key={m.module}
              title={job}
              description={
                <span className="flex flex-col gap-0.5">
                  <span className="text-ink-3" translate="no">
                    {m.runtime}
                  </span>
                  {onCpu ? (
                    <span>{translateKey(i18n, m.fallbackReasonKey ?? '', UNKNOWN_REASON, platform)}</span>
                  ) : null}
                </span>
              }
              status={
                onCpu ? (
                  <Chip tone="warning" className="whitespace-normal">
                    {i18n._(BACKENDS[m.backend])}
                  </Chip>
                ) : (
                  <Badge tone="you">{i18n._(BACKENDS[m.backend])}</Badge>
                )
              }
            />
          );
        })}
      </SettingRows>
    </PageSection>
  );
}
