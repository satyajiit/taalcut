// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: NVIDIA GPU setup · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.2 "Decision cards" (raised, rule hairline, xl radius, no shadow, title at 700) · LNX1-TRM:
 *   what an NVIDIA GPU still needs before Taalcut's CUDA builds use it, from the hardware report's gpuSetup (the
 *   probe and the CUDA runtime component, never a guess here): restart to load the installed libraries; update the
 *   driver to 580 or newer (the version it has, then the guide); install NVIDIA's driver (the guide); a GPU older
 *   than CUDA 13 supports (it still works through Vulkan or WebGPU; NVIDIA's list linked); reinstall the libraries
 *   (the download's start, which puts a damaged runtime back). Each says what Taalcut does meanwhile. The terms
 *   card (nvidia-terms-card.tsx) is the missing-libraries state's.
 * states: restart_needed (no button: Taalcut has no relaunch path, the words say how) · driver_old · no_driver ·
 *   gpu_too_old · runtime_damaged (Reinstall: Button's eight states) · ready and runtime_missing (nothing here)
 * pre-emit critique: P5 H4 E4 S5 R5 V4 · slop subset: pass (1-7, 10-19, 22-27, 37-38a, 40-41, 46-49)
 */
import { Trans } from '@lingui/react/macro';
import type { GpuSetup } from '@taalcut/core';
import { Button, cn } from '@taalcut/ui';
import { CircleAlert, Gpu, RotateCw } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { DriverGuide, GuideLinks } from './gpu-guide';
import type { GpuGuide } from './gpu-guides';

/** The states this card speaks for; the others are the terms card's or nothing. */
export const GUIDED_STATES = [
  'restart_needed',
  'driver_old',
  'no_driver',
  'gpu_too_old',
  'runtime_damaged',
] as const satisfies readonly GpuSetup['state'][];
export type GuidedState = (typeof GUIDED_STATES)[number];
export const isGuided = (state: GpuSetup['state']): state is GuidedState =>
  (GUIDED_STATES as readonly string[]).includes(state);

export interface GpuSetupCardProps {
  readonly setup: GpuSetup & { readonly state: GuidedState };
  /** This platform's guide (gpu-guides.ts); none where Taalcut has none. */
  readonly guide: GpuGuide | undefined;
  /** The probe's osName: which distribution's steps the guide shows. */
  readonly osName?: string | undefined;
  /** runtime_damaged's Reinstall: starts the download, which fetches the damaged runtime again. */
  readonly onReinstall: () => void;
  readonly reinstalling?: boolean;
  readonly className?: string;
}

function Card({
  state,
  title,
  children,
  className,
}: {
  state: GuidedState;
  title: ReactNode;
  children: ReactNode;
  className?: string | undefined;
}) {
  const titleId = useId();
  const Icon = state === 'restart_needed' ? RotateCw : state === 'gpu_too_old' ? Gpu : CircleAlert;
  return (
    <section
      aria-labelledby={titleId}
      data-slot="gpu-setup"
      data-state={state}
      className={cn('flex flex-col gap-3 rounded-xl border border-rule bg-raised p-5 text-ink', className)}
    >
      <header className="flex items-start gap-3">
        <Icon aria-hidden className="mt-0.5 size-5 shrink-0 text-ink-2" />
        <h3 id={titleId} className="m-0 text-lg font-bold">
          {title}
        </h3>
      </header>
      <div className="flex flex-col gap-3 ps-8 text-base">{children}</div>
    </section>
  );
}

const Meanwhile = () => (
  <p className="m-0 text-sm text-ink-2">
    <Trans>Taalcut keeps working on WebGPU or the CPU, more slowly.</Trans>
  </p>
);

export function GpuSetupCard({
  setup,
  guide,
  osName,
  onReinstall,
  reinstalling,
  className,
}: GpuSetupCardProps) {
  const gpu = <span translate="no">{setup.gpuName}</span>;
  const minDriver = setup.minDriver;
  switch (setup.state) {
    case 'restart_needed':
      return (
        <Card
          state={setup.state}
          title={<Trans>Restart Taalcut to use your GPU</Trans>}
          className={className}
        >
          <p className="m-0">
            <Trans>
              NVIDIA’s CUDA libraries are installed. Taalcut starts using them the next time it opens, so quit
              Taalcut and open it again.
            </Trans>
          </p>
          <p className="m-0 text-sm text-ink-2">
            <Trans>Until then, Taalcut keeps working on WebGPU or the CPU, more slowly.</Trans>
          </p>
        </Card>
      );
    case 'driver_old': {
      const version = <span translate="no">{setup.driverVersion ?? ''}</span>;
      return (
        <Card
          state={setup.state}
          title={<Trans>Update your NVIDIA driver to {minDriver} or newer</Trans>}
          className={className}
        >
          <p className="m-0">
            <Trans>
              Your {gpu} has NVIDIA’s driver {version}. NVIDIA’s CUDA libraries need driver {minDriver} or
              newer.
            </Trans>
          </p>
          <Meanwhile />
          {guide ? <DriverGuide guide={guide} osName={osName} minDriver={minDriver} /> : null}
        </Card>
      );
    }
    case 'no_driver':
      return (
        <Card
          state={setup.state}
          title={<Trans>Install NVIDIA’s driver to use your GPU</Trans>}
          className={className}
        >
          <p className="m-0">
            <Trans>
              This computer has {gpu}, but NVIDIA’s driver isn’t loaded, so Taalcut can’t use CUDA.
            </Trans>{' '}
            {setup.kernelDriver === 'nouveau' ? (
              <Trans>It runs on the open-source nouveau driver, which CUDA doesn’t work with.</Trans>
            ) : null}
          </p>
          <Meanwhile />
          {guide ? <DriverGuide guide={guide} osName={osName} minDriver={minDriver} /> : null}
        </Card>
      );
    case 'gpu_too_old': {
      const capability = <span translate="no">{setup.computeCapability ?? ''}</span>;
      const floor = <span translate="no">{setup.minComputeCapability}</span>;
      return (
        <Card state={setup.state} title={<Trans>Your GPU is too old for CUDA</Trans>} className={className}>
          <p className="m-0">
            <Trans>
              NVIDIA’s CUDA 13 needs a Turing GPU (GeForce GTX 16 or RTX 20 series) or newer. Your {gpu} has
              compute capability {capability}, below {floor}.
            </Trans>
          </p>
          <p className="m-0 text-sm text-ink-2">
            <Trans>
              Taalcut still uses it through Vulkan or WebGPU where it can, and the CPU otherwise. Nothing to
              install.
            </Trans>
          </p>
          {guide ? <GuideLinks links={guide.gpuLinks} /> : null}
        </Card>
      );
    }
    case 'runtime_damaged':
      return (
        <Card
          state={setup.state}
          title={<Trans>Reinstall NVIDIA’s CUDA libraries</Trans>}
          className={className}
        >
          <p className="m-0">
            <Trans>
              Some of NVIDIA’s CUDA libraries are missing from their folder, so Taalcut can’t use CUDA.
              Reinstalling downloads them again.
            </Trans>
          </p>
          <Meanwhile />
          <div>
            <Button
              variant="primary"
              data-action="reinstall-cuda"
              loading={reinstalling}
              onClick={onReinstall}
            >
              <Trans>Reinstall</Trans>
            </Button>
          </div>
        </Card>
      );
  }
}
