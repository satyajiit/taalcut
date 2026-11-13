// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · Operate, with a brand moment · component: the export dialog following its export (UX4)
 * system: DESIGN.md v0.6 + UX4 (KaatuMoment) · after Export, the same dialog follows the export: exporting and
 *   checking (the progress view: neutral bar, stage, percent in mono, time left; Cancel; Notify me), and once the
 *   wait passes 2 s, Kaatu thinking beside "You can close this…"; exported, the brand moment (a headline, the video's
 *   frame, its check, and Kaatu grinning with Show in Finder and Make another; Save as… copies it through main's
 *   save panel; Done); didn't finish (Kaatu bashful, the cause, Try again goes back to the choices); stopped
 *   (Export again); needs a look (ReviewBody); gone; lost (the stream failed: its cause and Try again, which
 *   reopens it; the export itself keeps going). Kaatu sits beside the words, never on the frame
 * states: as above · Save as… (default, hover, focus, pressed, loading while the panel is open; a cancelled
 *   panel says nothing; saved: one quiet line with the file's name; failed: a toast)
 */
import { useLingui } from '@lingui/react/macro';
import {
  callRpc,
  newId,
  RENDER_COMMANDS,
  type ProjectId,
  type RenderId,
  type RenderSnapshot,
} from '@taalcut/core';
import {
  Button,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  errorMessage,
  KaatuMoment,
  presetLabel,
  QaSummaryLine,
  RenderProgressView,
  toast,
  UserContent,
  VERB_ICONS,
} from '@taalcut/ui';
import { CircleCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useBackend } from '../../backend/backend';
import { useRpcStream } from '../../backend/use-rpc';
import { LoadError } from '../make/load-error';
import { formatBytes, formatClipLength } from '../shared/format';
import { ExportMoment } from './export-moment';
import { ReviewBody } from './review-dialog';
import { useRenderPoster } from './use-render-media';

const RUNNING: ReadonlySet<RenderSnapshot['status']> = new Set(['queued', 'rendering', 'checking', 'fixing']);
/** A wait longer than this gets Kaatu (PRODUCT.md: anything over 2 s shows progress). */
const WAIT_MS = 2000;

/** Whether the export has run longer than the wait that earns Kaatu. */
function useLongWait(running: boolean): boolean {
  const [long, setLong] = useState(false);
  useEffect(() => {
    if (!running) return setLong(false);
    const timer = setTimeout(() => setLong(true), WAIT_MS);
    return () => clearTimeout(timer);
  }, [running]);
  return long;
}

/** The finished export: its frame, its name and facts, its check, then the moment. */
function Finished({
  render,
  poster,
  onReveal,
  onRetry,
  close,
}: {
  render: RenderSnapshot;
  poster: string | null;
  onReveal: () => Promise<void>;
  onRetry: () => void;
  close: () => void;
}) {
  const { i18n } = useLingui();
  const seconds = render.durationFrames / (render.rate.num / render.rate.den);
  const facts = [
    presetLabel(i18n, render.presetId),
    render.durationFrames > 0 ? formatClipLength(i18n, seconds) : null,
    render.bytes !== null && render.status === 'ready' ? formatBytes(i18n, render.bytes) : null,
  ].filter(Boolean);
  return (
    <div data-slot="export-finished" data-status={render.status} className="flex gap-5">
      <span
        aria-hidden
        className="block aspect-[9/16] w-32 shrink-0 rounded-lg bg-viewer bg-cover bg-center"
        style={poster ? { backgroundImage: `url("${poster}")` } : undefined}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-3 pt-1">
        <p className="m-0 flex flex-col gap-0.5">
          <UserContent translate="no" className="type-card-title text-ink">
            {render.name}
          </UserContent>
          <span className="type-meta text-ink-2 tabular-nums">{facts.join(' · ')}</span>
        </p>
        {render.status === 'ready' && render.qa ? <QaSummaryLine summary={render.qa} /> : null}
        <ExportMoment
          render={render}
          onReveal={onReveal}
          onRetry={onRetry}
          onLeave={close}
          className="mt-2"
        />
      </div>
    </div>
  );
}

export function ExportFollow({
  projectId,
  renderId,
  onRestart,
  close,
}: {
  projectId: ProjectId;
  renderId: RenderId;
  onRestart: () => void;
  close: () => void;
}) {
  const { t, i18n } = useLingui();
  const backend = useBackend();
  const [round, setRound] = useState(0);
  const renders = useRpcStream(
    (signal) => backend.renders.watch({ projectId }, { signal }),
    [backend, projectId, round],
  );
  const render = renders.data?.find((candidate) => candidate.id === renderId);
  const poster = useRenderPoster(renderId, `${render?.status ?? ''}:${render?.finishedAt ?? 0}`);
  const [saving, setSaving] = useState(false);
  const [savedAs, setSavedAs] = useState<string | null>(null);
  const running = !!render && RUNNING.has(render.status);
  const waiting = useLongWait(running);

  // Main asks where (its save panel, as a sheet on this window) and copies the checked file there.
  const saveAs = async () => {
    setSaving(true);
    const result = await callRpc(backend.files.saveRenderAs({ renderId }));
    setSaving(false);
    if (!result.ok)
      toast({
        tone: 'danger',
        title: t`Couldn’t save a copy`,
        description: errorMessage(i18n, result.error),
      });
    else if (result.value.saved) setSavedAs(result.value.fileName ?? null);
  };
  const reveal = async () => {
    const result = await callRpc(backend.files.revealRender({ renderId }));
    if (!result.ok)
      toast({
        tone: 'danger',
        title: t`Couldn’t show it in Finder`,
        description: errorMessage(i18n, result.error),
      });
  };
  const dispatch = async (name: string, payload: unknown, failed: string) => {
    const result = await callRpc(
      backend.commands.dispatch({ name, payload, source: 'ui', idempotencyKey: newId() }),
    );
    if (!result.ok) toast({ tone: 'danger', title: failed, description: errorMessage(i18n, result.error) });
  };

  if (render?.status === 'needsAttention') return <ReviewBody render={render} close={close} />;
  // The list didn't come (or dropped before this export showed): say so, never "isn't in the list any more".
  const lost = !render && renders.status === 'error';
  const ended = render?.status === 'ready' || render?.status === 'failed';

  const title = !render
    ? t`Export`
    : render.status === 'ready'
      ? t`Exported`
      : render.status === 'failed'
        ? t`The export didn’t finish`
        : render.status === 'cancelled'
          ? t`Export stopped`
          : t`Exporting`;
  const line =
    render?.status === 'ready'
      ? t`Checked and saved in Exports, ready to post.`
      : running
        ? t`You can close this. It keeps going, and it’s in Exports.`
        : lost
          ? t`It keeps going. Taalcut lost track of it here; it’s in Exports.`
          : !render && renders.status !== 'loading'
            ? t`This export isn’t in the list any more.`
            : null;
  return (
    <>
      <DialogHeader>
        {/* An export finishing is a brand moment: its headline steps up from the dialog's usual title. */}
        <DialogTitle className={render?.status === 'ready' ? 'type-headline' : undefined}>
          {title}
        </DialogTitle>
        {/* Past 2 s the wait's line moves beside Kaatu, so it isn't said twice. */}
        <DialogDescription className={running && waiting ? 'sr-only' : undefined}>{line}</DialogDescription>
      </DialogHeader>
      {lost && renders.error ? (
        <LoadError error={renders.error} onRetry={() => setRound((n) => n + 1)} />
      ) : render && ended ? (
        <Finished render={render} poster={poster} onReveal={reveal} onRetry={onRestart} close={close} />
      ) : render ? (
        <div className="flex flex-col gap-5">
          <RenderProgressView
            variant="dialog"
            render={render}
            posterUrl={poster}
            onCancel={() =>
              dispatch(RENDER_COMMANDS.cancel, { projectId, renderId }, t`Couldn’t stop the export`)
            }
            onNotify={(notify) =>
              dispatch(
                RENDER_COMMANDS.setNotify,
                { projectId, renderId, notify },
                t`Couldn’t change the notification`,
              )
            }
            onReveal={reveal}
            onRetry={onRestart}
          />
          {running && waiting ? (
            <KaatuMoment tone="wait">{t`You can close this. It keeps going, and it’s in Exports.`}</KaatuMoment>
          ) : null}
        </div>
      ) : (
        <div aria-busy="true" aria-label={t`Loading the export`} className="flex gap-4">
          <span aria-hidden className="tc-bone block aspect-[9/16] w-24 rounded-md bg-hover" />
          <span aria-hidden className="tc-bone mt-1 block h-4 w-48 rounded-sm bg-hover" />
        </div>
      )}
      <DialogFooter>
        {render?.status === 'ready' ? (
          <>
            <p role="status" className="m-0 mr-auto flex min-w-0 items-center gap-2 type-meta text-ink-2">
              {savedAs ? (
                <>
                  <CircleCheck aria-hidden className="size-4 shrink-0 text-success-strong" />
                  <span className="min-w-0 truncate">{t`Saved a copy as ${savedAs}`}</span>
                </>
              ) : null}
            </p>
            <Button variant="ghost" icon={VERB_ICONS.download} loading={saving} onClick={() => void saveAs()}>
              {t`Save as…`}
            </Button>
          </>
        ) : null}
        {render?.status === 'cancelled' ? (
          <Button variant="ghost" icon={VERB_ICONS.back} onClick={onRestart}>
            {t`Back to the choices`}
          </Button>
        ) : null}
        <Button variant={render?.status === 'ready' ? 'secondary' : 'ghost'} onClick={close}>
          {render?.status === 'ready' ? t`Done` : t`Close`}
        </Button>
      </DialogFooter>
    </>
  );
}
