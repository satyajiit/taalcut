// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: the way out of waiting for models · genre: atmospheric studio app · system: DESIGN.md v0.5
 * inside the clip's waiting card, under its heading ("Waiting for the speech and search models"): the one download
 *   of everything this Mac needs (UX2-DOWNLOADER), seen from this clip. One button puts the clip's models first: it
 *   starts the download ("Download the models · 315 MB"), moves them to the front of a download under way
 *   ("Download these first"), or resumes a paused one with them first; then the clip's jobs as the shared job rows
 *   (features/downloads: the job, its parts in ink-3, a neutral bar while it downloads). A failed part says why
 *   on its row with Try again, the button stepping aside; a disk too full is an ErrorLine with its fix. A model
 *   this Mac doesn't fetch points at Settings › Models. While the download carries other parts too, one line under
 *   the rows says what the whole download is doing (bytes, speed, time left) and how many more parts are on their
 *   way, with a link to them all: a row alone moves at its share of the speed, and read as the download, it looked
 *   slow. Once they're here, one quiet line: the steps start by themselves.
 * states: reading (a bone in the button's shape) · to download · queued behind others · paused · downloading
 *   (rows with bars) · failed (the row's ErrorLine, Try again) · can't fetch here (a link) · here (one quiet line);
 *   the button carries Button's eight states (loading while it asks; error and success are the rows')
 * contrast: words ink and ink-2 on raised ≥ 7:1; the bars are ink-3 decoration beside their words
 */
import { Plural, Trans, useLingui } from '@lingui/react/macro';
import { Button } from '@taalcut/ui';
import { Link } from '@tanstack/react-router';
import { Download, Play } from 'lucide-react';
import { DownloadErrorLine } from '../../../downloads/download-error-line';
import { DownloadsProblems, JobList } from '../../../downloads/downloads-parts';
import { useDownloads } from '../../../downloads/downloads-store';
import { DownloadsLine } from '../../../downloads/downloads-summary';
import { useModelDownloads } from '../../../downloads/use-model-downloads';
import { formatBytes } from '../../../shared/format';
import { useOnline } from '../../../shared/use-online';

/** Gets the models these components are, first; one line once they're on this Mac. */
export function ClipModels({ ids }: { ids: readonly string[] }) {
  const { t, i18n } = useLingui();
  const online = useOnline();
  const view = useDownloads();
  const models = useModelDownloads(ids);
  const { actions } = models;

  if (models.components === null)
    return view.error ? (
      <DownloadErrorLine key={view.error.code} error={view.error} onRetry={view.refresh} />
    ) : (
      <span aria-hidden className="tc-bone block h-8 w-56 max-w-full rounded-md bg-hover" />
    );
  if (models.ready)
    return (
      <p data-slot="clip-models" data-state="here" className="m-0 text-sm text-ink-2">
        {t`The models are on this Mac. The steps start by themselves.`}
      </p>
    );

  const size = formatBytes(i18n, models.bytesLeft);
  const fetchable = models.components.length > 0;
  // A failed part's row offers Try again; while one of them moves, the rows say how far.
  // Once asked for here, the rows say how they're doing ("Waiting" until their turn): the button doesn't come back.
  const offer = fetchable && !models.moving && !models.failed && !models.asked;
  const state = models.moving ? 'downloading' : models.failed ? 'failed' : (models.state ?? 'missing');
  // The rest of the download, while it runs or is paused: what isn't here yet besides this clip's models.
  const whole = view.downloads;
  const mine = new Set(models.components.map((each) => each.id));
  const others =
    whole && (whole.state === 'downloading' || whole.state === 'paused')
      ? whole.components.filter((each) => !mine.has(each.id) && each.status !== 'installed').length
      : 0;
  return (
    <div data-slot="clip-models" data-state={state} className="flex flex-col items-start gap-2">
      {offer && models.state === 'paused' ? (
        <Button
          size="sm"
          variant="secondary"
          loading={models.starting}
          onClick={models.getFirst}
          data-action="download-clip-models"
        >
          <Play aria-hidden />
          <Trans>Resume, these first · {size}</Trans>
        </Button>
      ) : offer && models.state === 'downloading' ? (
        <Button
          size="sm"
          variant="secondary"
          loading={models.starting}
          onClick={models.getFirst}
          data-action="download-clip-models"
        >
          <Download aria-hidden />
          <Trans>Download these first · {size}</Trans>
        </Button>
      ) : offer ? (
        <Button
          size="sm"
          variant="secondary"
          loading={models.starting}
          onClick={models.getFirst}
          data-action="download-clip-models"
        >
          <Download aria-hidden />
          <Trans>Download the models · {size}</Trans>
        </Button>
      ) : null}
      {fetchable ? (
        <JobList
          components={models.components}
          online={online}
          actions={actions}
          label={t`Models this clip needs`}
          className="w-full"
        />
      ) : null}
      {whole && others > 0 ? (
        <div data-slot="clip-models-whole" className="flex w-full flex-col gap-1 pt-1">
          <DownloadsLine downloads={whole} online={online} />
          <p className="m-0 text-sm text-ink-2">
            <Plural
              value={others}
              one="# more part is on its way with these."
              other="# more parts are on their way with these."
            />{' '}
            <Link to="/settings/models" className="font-medium text-ink underline underline-offset-4">
              {t`See every part`}
            </Link>
          </p>
        </div>
      ) : null}
      <DownloadsProblems
        downloads={view.downloads}
        readError={view.error}
        actions={actions}
        onReadAgain={view.refresh}
      />
      {models.unlisted.length > 0 ? (
        <p className="m-0 text-sm text-ink-2">
          <Trans>
            Get them in{' '}
            <Link to="/settings/models" className="font-medium text-ink underline underline-offset-4">
              Settings › Models
            </Link>
            .
          </Trans>
        </p>
      ) : null}
    </div>
  );
}
