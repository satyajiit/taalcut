// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: Settings › Models, on this Mac · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.5 (UX2) · a hairline section like the page's others: everything this Mac needs as one
 *   download (UX2-DOWNLOADER), not picks. The section's action is what the download can do now (Download with its
 *   size, Pause, Resume or Try again, a quiet Cancel that asks first); under the title one summary line over one
 *   neutral bar (bytes of bytes, speed, time left); then a row per job ("Speech", "Search", "Text in frames"…) with
 *   its parts named quietly after it, and their licence link once they are here (round 3: "Licence", or
 *   "Licences" and a menu). A part that fails says why on its row, with Try again; what stops the whole
 *   download (a disk too full) is one ErrorLine with its fix. Settings has no motion: the bars' own transform only.
 * states: loading (bones in the summary's and rows' shape) · unreadable (ErrorLine, Try again; it keeps trying) ·
 *   missing (Download and the size against the free space) · downloading · offline · paused · failed · ready
 *   (the success mark and the size; no buttons) · confirming a cancel; the buttons carry Button's eight states ·
 *   opened from main's "couldn't download" notification (#downloads-<job>): that row focused in the middle of the
 *   view, the base focus ring round it until focus moves on; #downloads: the problem's fix (Open Storage Settings)
 * pre-emit critique: P5 H4 E5 S5 R5 V4 · slop subset: pass (1-7, 10-19, 22-27, 37-38a, 40-41 via axe, 46-49)
 */
import { Trans, useLingui } from '@lingui/react/macro';
import { PageSection, useHostPlatform } from '@taalcut/ui';
import { useLocation } from '@tanstack/react-router';
import { useEffect, useRef, type RefObject } from 'react';
import { GpuSetupSettings } from '../gpu-setup/gpu-setup-surface';
import { useOnline } from '../shared/use-online';
import { SETTINGS_ICONS } from '../settings/settings-icons';
import { DownloadErrorLine } from './download-error-line';
import { DownloadsControls } from './downloads-controls';
import { downloadsTarget } from './downloads-anchor';
import { DownloadsBones, DownloadsProblems, JobList } from './downloads-parts';
import { useDownloads } from './downloads-store';
import { DownloadsSummary } from './downloads-summary';
import { useDownloadActions } from './use-download-actions';

/**
 * Main's "couldn't download" notification opens this page at a job's row (`#downloads-speech`) or at the whole
 * download (`#downloads`): once the rows are here, that row takes focus in the middle of the view, or the problem's
 * fix (a disk too full's Open Storage Settings), or the list itself; again whenever the address names another.
 * Returns what it opened on: a job, for its row, or the whole download (`named` without a job).
 */
function useFocusFromNotification(root: RefObject<HTMLDivElement | null>, shown: boolean) {
  const hash = useLocation({ select: (location) => location.hash });
  const target = downloadsTarget(hash);
  const job = target?.job;
  const named = target !== undefined;
  useEffect(() => {
    if (!shown || !named || !root.current) return;
    const row = job ? root.current.querySelector<HTMLElement>(`li[data-job="${job}"]`) : null;
    const fix = root.current.querySelector<HTMLElement>('[data-slot=downloads-problems] button');
    const focus = row ?? fix ?? root.current;
    focus.focus();
    focus.scrollIntoView({ block: 'center' });
  }, [job, named, shown, root]);
  return { job, named };
}

/** Settings › Models › Downloads: everything this Mac needs, downloading as one, with its controls (UX2-DOWNLOADER). */
export function ModelsOnThisMac() {
  const { t } = useLingui();
  const mac = useHostPlatform() === 'mac';
  const online = useOnline();
  const { downloads, error, refresh } = useDownloads();
  const actions = useDownloadActions();
  const root = useRef<HTMLDivElement>(null);
  const opened = useFocusFromNotification(root, downloads !== null);
  // The whole takes focus when the notification names no job here (and no fix is there to take it).
  const whole =
    opened.named &&
    !downloads?.components.some((each) => opened.job !== undefined && each.job === opened.job);
  return (
    <PageSection
      icon={SETTINGS_ICONS.downloads}
      // Not "On this Mac": that is a profile's name on the next view. First run's list has this title too.
      title={mac ? <Trans>Models for this Mac</Trans> : <Trans>Models for this computer</Trans>}
      description={
        mac ? (
          <Trans>
            Everything Taalcut runs on this Mac: speech, search, shots, beats, writing and more. Each part
            downloads once, then works offline.
          </Trans>
        ) : (
          <Trans>
            Everything Taalcut runs on this computer: speech, search, shots, beats, writing and more. Each
            part downloads once, then works offline.
          </Trans>
        )
      }
      actions={downloads ? <DownloadsControls downloads={downloads} actions={actions} /> : null}
    >
      {downloads === null ? (
        error ? (
          <DownloadErrorLine key={error.code} error={error} onRetry={refresh} />
        ) : (
          <DownloadsBones rows={8} />
        )
      ) : (
        <div
          ref={root}
          data-slot="models-on-mac"
          // Focused from main's notification when it names no job and nothing here has a fix; never by Tab.
          tabIndex={whole ? -1 : undefined}
          className="flex flex-col gap-4 rounded-sm focus:outline-2 focus:outline-offset-2 focus:outline-focus"
        >
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
              target={opened.job}
              licences
            />
          ) : null}
          {/* LNX1-TRM: NVIDIA's CUDA libraries, held on their terms or installed, and what the GPU still needs. */}
          <GpuSetupSettings />
        </div>
      )}
    </PageSection>
  );
}
