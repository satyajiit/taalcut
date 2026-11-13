// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: Settings › General › This Mac, the facts (UX4, out of About) · genre: atmospheric studio app
 *   (chrome modern-minimal) · system: DESIGN.md v0.6 + UX4
 * the hardware tier in a chip with what it means here, then this Mac as a definition list in one hairline frame, as
 *   About This Mac shows it (the name left in ink-2, the value right in ink, tabular figures), and any shortfall as a
 *   warning notice. No fact tiles (UX1).
 * states: default · a shortfall (warning notice) · off a Mac (Processor, System, "This computer") */
import type { MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import type { ComputeReport, HardwareReport, HardwareTier } from '@taalcut/core';
import { Chip, PageSection, useHostPlatform } from '@taalcut/ui';
import type { ReactNode } from 'react';
import { ChipName } from '../../hardware/chip-name';
import { gpuVendorOf, vendorOfName } from '../../hardware/chip-vendor';
import { formatBytes, formatCount, formatMemory } from '../../shared/format';
import { Notice } from '../fields';
import { translateKey } from '../model-messages';
import { SETTINGS_ICONS } from '../settings-icons';
import { GraphicsFact, primaryGpu } from './local-compute';

/**
 * What a hardware tier means for where work runs (Settings › This Mac and first run). Off a Mac the catalogue says
 * "this computer" (settings-platform-words.ts), as for every sentence on this page that names the Mac.
 */
export const TIER_MEANS: Record<HardwareTier, MessageDescriptor> = {
  minimum: msg`Taalcut runs well here. Some work, like describing your clips, goes to cloud models.`,
  recommended: msg`Clips are described on this Mac, and a model on this Mac can stand in for the agent.`,
  high: msg`Everything can run on this Mac, including the larger models.`,
};
const TIER = msg`Unknown`;

/** One fact about this Mac: a row of the definition list, the name left and the value right (as About This Mac). */
function Fact({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-11 flex-wrap items-baseline justify-between gap-x-6 gap-y-0.5 border-t border-rule-subtle px-3 py-2.5 first:border-t-0">
      <dt className="type-body text-ink-2">{label}</dt>
      <dd className="m-0 min-w-0 type-data text-ink">{children}</dd>
    </div>
  );
}

export function ThisMacFacts({ report, gpu }: { report: HardwareReport; gpu: ComputeReport['gpu'] }) {
  const { t, i18n } = useLingui();
  const mac = useHostPlatform() === 'mac';
  const { info } = report;
  const cpu = formatCount(i18n, info.cpuCores.total);
  const gpuCores = info.gpuCores === undefined ? null : formatCount(i18n, info.gpuCores);
  const tier = translateKey(i18n, report.labelKey, TIER);
  const graphics = primaryGpu(gpu, info.gpus);
  const name = t`This Mac`;
  return (
    <PageSection
      title={<Trans>Hardware</Trans>}
      icon={SETTINGS_ICONS.thisMac}
      description={<Trans>Taalcut picks models that suit it. You can change them under Models.</Trans>}
    >
      <p className="m-0 flex flex-wrap items-center gap-x-2 gap-y-1 type-body text-ink-2">
        <Chip tone="primary">
          <Trans>{tier} tier</Trans>
        </Chip>
        {i18n._(TIER_MEANS[report.tier])}
      </p>
      <dl
        aria-label={name}
        className="m-0 flex flex-col overflow-hidden rounded-lg border border-rule-subtle bg-raised"
      >
        <Fact label={mac ? <Trans>Chip</Trans> : <Trans>Processor</Trans>}>
          <ChipName name={info.chip} vendor={vendorOfName(info.chip)}>
            <span translate="no">{info.chip}</span>
          </ChipName>
        </Fact>
        {graphics ? (
          <Fact label={<Trans>Graphics</Trans>}>
            <ChipName name={graphics.name} vendor={gpuVendorOf(graphics, info.gpus)}>
              <GraphicsFact gpu={graphics} />
            </ChipName>
          </Fact>
        ) : null}
        <Fact label={<Trans>Memory</Trans>}>{formatMemory(i18n, info.memoryBytes)}</Fact>
        <Fact label={<Trans>Free space</Trans>}>{formatBytes(i18n, info.freeDiskBytes)}</Fact>
        {mac ? (
          <Fact label={<Trans>macOS</Trans>}>
            <span translate="no">{info.osVersion}</span>
          </Fact>
        ) : (
          // The OS as it names itself ("Ubuntu 24.04.5 LTS"); its version alone for a probe from before LNX1.
          <Fact label={<Trans>System</Trans>}>
            <span translate="no">{info.osName ?? info.osVersion}</span>
          </Fact>
        )}
        <Fact label={<Trans>Cores</Trans>}>
          {gpuCores === null ? (
            <Trans>{cpu} CPU</Trans>
          ) : (
            <Trans>
              {cpu} CPU · {gpuCores} GPU
            </Trans>
          )}
        </Fact>
      </dl>
      {report.shortfallKeys.map((key) => (
        <Notice key={key} tone="warning">
          {translateKey(i18n, key, TIER)}
        </Notice>
      ))}
    </PageSection>
  );
}
