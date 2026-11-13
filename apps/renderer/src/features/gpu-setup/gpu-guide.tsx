// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: the NVIDIA driver guide · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.5 · under the GPU setup card's words when the driver is missing or too old: on Ubuntu, the
 *   two ways to install it (Additional Drivers, or the one command in the mono face with a copy button, never run
 *   for the person), then the restart; then the pages behind it, each a BrowserLink. Another distribution gets the
 *   pages only. The driver is NVIDIA's, installed by the system: the guide says so.
 * states: Ubuntu (steps and pages) · another distribution (pages) · copy (CopyButton's: Copied, Couldn't copy) ·
 *   links (BrowserLink's) · no guide for this platform (nothing)
 * pre-emit critique: P4 H4 E4 S5 R5 V4 · slop subset: pass (1-7, 10-19, 22-27, 37-38a, 40-41, 46-49)
 */
import { Trans, useLingui } from '@lingui/react/macro';
import { BrowserLink } from '../../chat/external-link';
import { CopyButton } from '../library/phone/connect/copy-button';
import { stepsFor, type GpuGuide, type GpuGuideLink } from './gpu-guides';

export function GuideLinks({ links }: { links: readonly GpuGuideLink[] }) {
  const { i18n } = useLingui();
  return (
    <ul className="m-0 flex list-none flex-col gap-1 p-0">
      {links.map((link) => (
        <li key={link.url}>
          <BrowserLink href={link.url}>{i18n._(link.label)}</BrowserLink>
        </li>
      ))}
    </ul>
  );
}

/** How to install or update NVIDIA's driver here: the distribution's steps when the guide has them, then the pages. */
export function DriverGuide({
  guide,
  osName,
  minDriver,
}: {
  guide: GpuGuide;
  osName: string | undefined;
  minDriver: string;
}) {
  const { i18n } = useLingui();
  const steps = stepsFor(guide, osName);
  return (
    <div data-slot="driver-guide" className="flex flex-col gap-3">
      {steps ? (
        <ol className="m-0 flex list-decimal flex-col gap-2 ps-5 text-sm text-ink">
          <li>{i18n._({ ...steps.settings, values: { minDriver } })}</li>
          <li className="flex flex-col gap-1.5">
            <span>
              <Trans>Or run this in a terminal:</Trans>
            </span>
            <span className="flex flex-wrap items-center gap-2">
              <code translate="no" className="rounded-sm bg-chip px-2 py-1 font-mono text-sm text-ink">
                {steps.command}
              </code>
              <CopyButton value={steps.command}>
                <Trans>Copy</Trans>
              </CopyButton>
            </span>
          </li>
          <li>{i18n._(steps.then)}</li>
        </ol>
      ) : null}
      <p className="m-0 text-xs text-ink-3">
        <Trans>The driver is NVIDIA’s, and your system installs it. Taalcut never installs it for you.</Trans>
      </p>
      <GuideLinks links={guide.driverLinks} />
    </div>
  );
}
