// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · Operate · component: a template's kept reel (REF1) · system: DESIGN.md v0.7 (Button, ErrorLine, the
 *   icon registry; the neutral bar of a background job)
 * one line under where the template came from, for a template read from a reel. Kept: "The reel's video and music
 *   are kept on this Mac" and its size, led by the this-computer glyph. Not kept but with a link (read before REF1):
 *   why its music can't go in a video yet, and Get the reel's video and music (secondary, the download glyph), which
 *   fetches the link again. Getting: the button spins with its words, and under it the job's neutral bar, its stage,
 *   the percent in mono and the time left. Failed: the ErrorLine (the cause; Try again when it can work). From a file
 *   with nothing kept: one line saying why
 * states: kept · silent reel (kept, no sound) · not kept · getting (waiting to start, then the download) · failed ·
 *   no link · the button's (default, hover, focus-visible, active, loading)
 * contrast: ink-2 lines on the canvas (7:1); the bar is ink-2 on sunken (3:1)
 * motion: the bar scales by transform (--dur-short, ease-out); the button's spinner. Reduced motion: the bar jumps
 */
import { Trans, useLingui } from '@lingui/react/macro';
import type { JobProgress, Template, TemplateSummary } from '@taalcut/core';
import { Button, CONCEPT_ICONS, ErrorLine, VERB_ICONS } from '@taalcut/ui';
import { formatBytes, formatPercent } from '../../shared/format';
import { Duration } from '../../shared/time';
import { useReelMedia } from './use-reel-media';

const LINE = 'm-0 flex min-w-0 items-start gap-2 type-body text-ink-2';
const GLYPH = 'mt-[0.1875rem] size-4 shrink-0 text-ink-3';

/** The link the reel came from, which `templates.fetchMedia` fetches again; null for a file or a recording. */
const originLink = (template: Template) =>
  template.origin.kind === 'reference' ? template.origin.url : null;

/** The fetch job's progress: the neutral bar, the downloader's stage, the percent and the time left. */
function FetchProgress({ progress }: { progress: JobProgress | null }) {
  const { t, i18n } = useLingui();
  const key = progress?.stageKey;
  const stage = key && key in i18n.messages ? i18n._(key) : t`Waiting to start`;
  const fraction = progress?.fraction ?? 0;
  const eta = progress?.etaMs;
  return (
    <div className="flex w-full max-w-sm flex-col gap-1.5" data-slot="reel-media-progress">
      <div
        role="progressbar"
        aria-label={stage}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(fraction * 100)}
        className="h-1 w-full overflow-hidden rounded-pill bg-sunken"
      >
        <div
          className="h-full origin-left rounded-pill bg-ink-2 transition-transform duration-(--dur-short) ease-(--ease-out) motion-reduce:transition-none"
          style={{ transform: `scaleX(${fraction})` }}
        />
      </div>
      <p className="m-0 flex flex-wrap gap-x-2 type-meta text-ink-2">
        <span className="text-ink">{stage}</span>
        {progress && progress.fraction !== null ? (
          <span className="font-mono">{formatPercent(i18n, fraction)}</span>
        ) : null}
        {eta !== undefined && eta > 0 ? (
          <span>
            <Trans>
              About <Duration ms={eta} /> left
            </Trans>
          </span>
        ) : null}
      </p>
    </div>
  );
}

export function ReelMedia({ summary, template }: { summary: TemplateSummary; template: Template }) {
  const { t, i18n } = useLingui();
  const { state, get } = useReelMedia(template.id);
  if (template.origin.kind !== 'reference') return null;
  const media = summary.media ?? (state.status === 'kept' ? state.media : null);
  const Kept = CONCEPT_ICONS.thisComputer;
  const Reel = CONCEPT_ICONS.reel;

  if (media)
    return (
      <p className={LINE} data-slot="reel-media" data-state="kept">
        <Kept aria-hidden className={GLYPH} />
        <span className="min-w-0">
          {media.hasAudio
            ? t`The reel’s video and music are kept on this Mac`
            : t`The reel’s video is kept on this Mac. It has no sound of its own.`}
          <span aria-hidden className="px-1.5 text-ink-3">
            ·
          </span>
          <span className="tabular-nums">{formatBytes(i18n, media.bytes)}</span>
        </span>
      </p>
    );

  if (!originLink(template))
    return (
      <p className={LINE} data-slot="reel-media" data-state="no-link">
        <Reel aria-hidden className={GLYPH} />
        <span className="min-w-0 max-w-prose">
          {t`This reel came from a file Taalcut didn’t keep, so its music can’t go in your videos.`}
        </span>
      </p>
    );

  const getting = state.status === 'getting';
  return (
    <div className="flex max-w-3xl flex-col gap-3" data-slot="reel-media" data-state={state.status}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <p className={LINE}>
          <Reel aria-hidden className={GLYPH} />
          <span className="min-w-0 max-w-prose">
            {t`Taalcut didn’t keep this reel when it read it, so its music can’t go in your videos yet.`}
          </span>
        </p>
        <Button
          size="sm"
          variant="secondary"
          icon={VERB_ICONS.download}
          loading={getting}
          onClick={get}
          data-slot="get-reel-media"
        >
          {getting ? t`Getting the reel’s video and music` : t`Get the reel’s video and music`}
        </Button>
      </div>
      {state.status === 'getting' ? <FetchProgress progress={state.progress} /> : null}
      {state.status === 'failed' ? (
        <ErrorLine key={state.error.code} error={state.error} onRetry={get} />
      ) : null}
    </div>
  );
}
