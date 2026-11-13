// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · page: Settings › General › This Mac (UX4, out of About) · genre: atmospheric studio app (chrome
 *   modern-minimal) · system: DESIGN.md v0.6 + UX4 (_orch/ux4/specs/design-set.md)
 * what this Mac is and what runs on it: the hardware tier and facts, where each local job runs (GPU first), the
 *   NVIDIA setup when this computer needs it, and the parts Taalcut downloaded. Read when something is slow or a
 *   job runs on the CPU; never needed to make a video, so it sits behind General's row.
 * states: loading (the named skeleton, settings-about's shape) · error (each part names what didn't load, Try
 *   again) · off a Mac ("This computer", Processor, System) */
import { Trans, useLingui } from '@lingui/react/macro';
import { Skeleton } from '@taalcut/ui';
import { useBackend } from '../../../backend/backend';
import { useRpcQuery } from '../../../backend/use-rpc';
import { GpuSetupSurface } from '../../gpu-setup/gpu-setup-surface';
import { LoadError } from '../fields';
import { GeneralViews } from '../general/general-views';
import { SettingsPage } from '../settings-page';
import { AboutBones } from './about-bones';
import { InstalledParts } from './installed-parts';
import { LocalCompute } from './local-compute';
import { ThisMacFacts } from './this-mac-facts';

export function ThisMacSettings() {
  const { t } = useLingui();
  const backend = useBackend();
  const hardware = useRpcQuery((signal) => backend.system.hardware(undefined, { signal }), [backend]);
  const components = useRpcQuery((signal) => backend.system.components(undefined, { signal }), [backend]);
  const compute = useRpcQuery((signal) => backend.system.compute(undefined, { signal }), [backend]);
  return (
    <SettingsPage title={t`General`} detail={t`This Mac`} views={<GeneralViews current="this-mac" />}>
      {hardware.status === 'error' ? (
        <LoadError
          error={hardware.error}
          onRetry={hardware.reload}
          what={<Trans>This Mac’s details didn’t load.</Trans>}
        />
      ) : null}
      <Skeleton
        name="settings-this-mac"
        loading={hardware.status === 'loading' || components.status === 'loading'}
        fixture={<AboutBones />}
      >
        <div className="flex flex-col gap-10 [&>[data-slot=page-section]]:mt-0!">
          {hardware.data ? <ThisMacFacts report={hardware.data} gpu={compute.data?.gpu} /> : null}
          {compute.data ? <LocalCompute report={compute.data} /> : null}
          {/* LNX1-TRM: beside the modules on WebGPU or the CPU, what the NVIDIA GPU needs for CUDA. */}
          <GpuSetupSurface />
          {components.status === 'error' ? (
            <LoadError
              error={components.error}
              onRetry={components.reload}
              what={<Trans>The installed parts didn’t load.</Trans>}
            />
          ) : null}
          {components.data ? <InstalledParts components={components.data} /> : null}
        </div>
      </Skeleton>
    </SettingsPage>
  );
}
