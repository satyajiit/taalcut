// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: onboarding, everything this Mac needs · genre: atmospheric studio app · system:
 *   DESIGN.md v0.5
 * first run's download (UX2-DOWNLOADER; UX4: it starts quietly when the steps open, quiet-start.ts, and this section
 *   shows only when it needs the person, under the last step's moment, quiet-checks.tsx): nothing to pick, since
 *   every model is needed. A titled hairline section with the one summary line over its neutral bar, the controls
 *   (Pause, a Cancel that asks first) and a row per job. The steps' "Getting ready" line keeps it in view. A disk
 *   too full says so with its fix (Open Storage Settings) and Try again; a part that fails says why on its row.
 * states: reading (bones in the summary's and rows' shape) · unreadable (ErrorLine, Try again) · starting (the
 *   size, Download loading) · downloading · offline · paused · failed (the rows' reasons, Try again) · not enough
 *   space (ErrorLine with its fix) · ready (the success mark); the buttons carry Button's eight states
 * pre-emit critique: P5 H4 E4 S5 R5 V4 · slop subset: pass (1-7, 10-19, 22-27, 37-38a, 40-41 via axe, 46-49)
 */
import { Trans, useLingui } from '@lingui/react/macro';
import { useHostPlatform } from '@taalcut/ui';
import { useId } from 'react';
import { DownloadErrorLine } from '../../features/downloads/download-error-line';
import { DownloadsControls } from '../../features/downloads/downloads-controls';
import { DownloadsBones, DownloadsProblems, JobList } from '../../features/downloads/downloads-parts';
import { useDownloads } from '../../features/downloads/downloads-store';
import { DownloadsSummary } from '../../features/downloads/downloads-summary';
import { useDownloadActions } from '../../features/downloads/use-download-actions';
import { GpuSetupSurface } from '../../features/gpu-setup/gpu-setup-surface';
import { useOnline } from '../../features/shared/use-online';
import { useQuietStart } from '../quiet-start';

/** Everything this Mac needs, downloading in the background since first run's steps opened. */
export function ThisMacDownloads() {
  const { t } = useLingui();
  const mac = useHostPlatform() === 'mac';
  const online = useOnline();
  const titleId = useId();
  const { downloads, error, refresh } = useDownloads();
  const actions = useDownloadActions();
  useQuietStart();

  return (
    <section aria-labelledby={titleId} className="flex max-w-xl flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <div className="flex min-w-0 flex-[1_1_18rem] flex-col gap-1">
          <h2 id={titleId} className="m-0 type-card-title text-ink">
            {mac ? <Trans>Models for this Mac</Trans> : <Trans>Models for this computer</Trans>}
          </h2>
          <p className="m-0 type-body text-ink-2">
            {mac
              ? t({
                  id: 'onboarding.downloads.lead',
                  message:
                    'Taalcut runs these on this Mac. They download while you carry on, then work offline.',
                })
              : t({
                  id: 'onboarding.downloads.lead.computer',
                  message:
                    'Taalcut runs these on this computer. They download while you carry on, then work offline.',
                })}
          </p>
        </div>
        {downloads ? <DownloadsControls downloads={downloads} actions={actions} /> : null}
      </div>
      {/* LNX1-TRM: NVIDIA's terms before its CUDA libraries download, or what the NVIDIA GPU still needs. */}
      <GpuSetupSurface />
      {downloads === null ? (
        error ? (
          <DownloadErrorLine key={error.code} error={error} onRetry={refresh} />
        ) : (
          <DownloadsBones rows={6} />
        )
      ) : (
        <>
          <DownloadsSummary downloads={downloads} online={online} />
          <DownloadsProblems
            downloads={downloads}
            readError={error}
            actions={actions}
            onReadAgain={refresh}
          />
          {downloads.components.length > 0 ? (
            <JobList
              components={downloads.components}
              online={online}
              actions={actions}
              label={mac ? t`What this Mac needs, by job` : t`What this computer needs, by job`}
              rowRetry={downloads.state !== 'failed'}
            />
          ) : null}
        </>
      )}
    </section>
  );
}
