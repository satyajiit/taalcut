// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* component: the Library's import line (UX4, B12) · system: DESIGN.md v0.6 + UX4 (Kaatu as companion, the motion
 *   grammar, the icon registry)
 * one labelled line under the search and filters, out of their way: what is coming in (or being analysed), and
 *   under its words the bar with its two layers named by swatches ("36 fully analysed", "48 of 120 searchable"), the
 *   step and the time left, and the files that couldn't be read; Pause or Resume and Details at its end. Details
 *   opens the rest under it (each import's failed files with See which, Try again and Leave them out; what waits
 *   for a model; the imports one by one when there are several), and opens by itself when See which is on.
 * Kaatu: a wait over 2 s is Kaatu thinking beside the words; an import that finishes while you're here is a moment
 *   (a grin, the count, Make a video, a dismiss); one that stops is a moment of its own (bashful, the cause, Try
 *   again). Never over footage: the line sits above the grid.
 * states: running · paused · waiting (for a model or the originals) · needs a look (files couldn't be read) ·
 *   stopped (failure moment) · analysing after an import · finished (success moment) · acting (the button's own
 *   loading) · acting failed (the cause under the line) · the status late or unreadable (import-strip.tsx)
 * motion: the bar's transforms; Details is a Collapse (its content moves what is under it); the chevron turns
 *   (transform, --dur-short); reduced motion: the Collapse opens at once and the chevron doesn't turn */
import { plural } from '@lingui/core/macro';
import { Plural, useLingui } from '@lingui/react/macro';
import { callRpc, newId, type IndexingStatus, type SourceView, type TaalcutError } from '@taalcut/core';
import {
  Button,
  Collapse,
  cn,
  ErrorLine,
  errorMessage,
  ImportMark,
  ImportTitle,
  Kaatu,
  KaatuMoment,
  UserContent,
  VERB_ICONS,
  type ImportAction,
} from '@taalcut/ui';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { ChevronDown } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useBackend } from '../../backend/backend';
import { COMPOSER_DRAFT_KEY } from '../../chat/handoff';
import { ImportMeta } from './import-meta';
import { ImportStripSource } from './import-strip-source';
import { finishedSince, summariseImports } from './import-summary';

/** A wait becomes Kaatu's after this long (DESIGN.md, "Kaatu as a companion": a wait over 2 s). */
const LONG_WAIT_MS = 2000;

/** True once `waiting` has held for LONG_WAIT_MS. */
function useLongWait(waiting: boolean): boolean {
  const [long, setLong] = useState(false);
  useEffect(() => {
    if (!waiting) return setLong(false);
    const timer = setTimeout(() => setLong(true), LONG_WAIT_MS);
    return () => clearTimeout(timer);
  }, [waiting]);
  return long;
}

/** The imports this page saw running that have finished since, until the moment is dismissed. */
function useFinished(status: IndexingStatus | null) {
  const seen = useRef(new Set<string>());
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    for (const source of status?.sources ?? [])
      if (source.state !== 'done') seen.current.add(source.sourceId);
  }, [status]);
  const finished = finishedSince(seen.current, status).filter((source) => !dismissed.has(source.sourceId));
  const dismiss = () => setDismissed(new Set([...dismissed, ...finished.map((source) => source.sourceId)]));
  return { finished, dismiss };
}

export interface ImportLineProps {
  status: IndexingStatus;
  sources: readonly SourceView[];
  setStatus: (next: IndexingStatus) => void;
  onSeeFailed: () => void;
}

export function ImportLine({ status, sources, setStatus, onSeeFailed }: ImportLineProps) {
  const { t } = useLingui();
  const backend = useBackend();
  const navigate = useNavigate();
  const detailsId = useId();
  const summary = summariseImports(status);
  const { kind, combined } = summary;
  const { finished, dismiss } = useFinished(status);
  const long = useLongWait(kind === 'running' || kind === 'analysing');
  const search: { filter?: unknown } = useSearch({ strict: false });
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<ImportAction | null>(null);
  const [error, setError] = useState<TaalcutError | null>(null);
  const nameOf = (sourceId: string) => sources.find((source) => source.id === sourceId)?.name;

  const act = (action: 'pause' | 'resume') => async () => {
    setPending(action);
    setError(null);
    const result = await callRpc(action === 'pause' ? backend.indexing.pause() : backend.indexing.resume());
    setPending(null);
    if (!result.ok) return setError(result.error);
    setStatus(result.value);
  };
  const retry = async (sourceId: string) => {
    setPending('retry');
    setError(null);
    const result = await callRpc(backend.indexing.retryFailed({ sourceId }));
    setPending(null);
    if (!result.ok) setError(result.error);
  };

  // An import that finished while you were here, with nothing else coming in: the moment, the count, the way on.
  const done = kind === 'none' || kind === 'analysing' ? finished[0] : undefined;
  if (done) {
    const name = nameOf(done.sourceId) ?? t`your footage`;
    const count = done.counts.done;
    const makeVideo = () => {
      try {
        sessionStorage.setItem(COMPOSER_DRAFT_KEY, t`Make a short video with my new clips from ${name}`);
      } catch {
        // Storage blocked: the chat opens with an empty composer, which is still the way on.
      }
      void navigate({ to: '/chat/$conversationId', params: { conversationId: newId<'Conversation'>() } });
    };
    return (
      <section data-slot="import-strip" data-kind="finished" aria-label={t`Imports`}>
        <KaatuMoment
          tone="success"
          onDismiss={dismiss}
          action={
            <Button size="sm" variant="secondary" icon={VERB_ICONS.makeVideo} onClick={makeVideo}>
              {t`Make a video`}
            </Button>
          }
        >
          {plural(count, {
            one: `# clip from ${name} is in your library, and search can find it.`,
            other: `# clips from ${name} are in your library, and search can find them.`,
          })}
        </KaatuMoment>
      </section>
    );
  }
  if (kind === 'none') return null;

  const single = summary.sources.length === 1 ? summary.sources[0] : undefined;
  const sourceName = single ? nameOf(single.sourceId) : undefined;
  const source = sourceName ? <UserContent translate="no">{sourceName}</UserContent> : t`your footage`;

  // An import that stopped: the moment says why, with the fix.
  const stoppedOne = kind === 'stopped' ? summary.sources.find((s) => s.state === 'failed') : undefined;
  if (stoppedOne) {
    const stoppedName = nameOf(stoppedOne.sourceId);
    return (
      <section
        data-slot="import-strip"
        data-kind="stopped"
        aria-label={t`Imports`}
        className="flex flex-col gap-2"
      >
        <KaatuMoment
          tone="failure"
          action={
            <Button
              size="sm"
              variant="secondary"
              icon={VERB_ICONS.retry}
              loading={pending === 'retry'}
              onClick={() => void retry(stoppedOne.sourceId)}
            >
              {t`Try again`}
            </Button>
          }
        >
          {stoppedName
            ? t`The import from ${stoppedName} stopped before it finished.`
            : t`An import stopped before it finished.`}{' '}
          <StoppedWhy sourceId={stoppedOne.sourceId} sources={sources} />
        </KaatuMoment>
        {error ? <ErrorLine error={error} /> : null}
      </section>
    );
  }

  const ended = kind === 'attention';
  const waiting = kind === 'waiting';
  // Named as the Library's analysing line named it, so its translations carry over.
  const left = summary.analysing;
  const lines = combined?.counts.searchable !== undefined && (kind === 'running' || kind === 'paused');
  const title: ReactNode =
    kind === 'analysing' ? (
      <Plural
        value={left}
        one="Analysing # clip. You can use it meanwhile."
        other="Analysing # clips. You can use them meanwhile."
      />
    ) : single && combined ? (
      <ImportTitle status={combined} source={source} lines={lines} waiting={waiting} ended={ended} />
    ) : kind === 'paused' ? (
      <Plural
        value={summary.sources.length}
        one="Paused: clips from # place"
        other="Paused: clips from # places"
      />
    ) : (
      <Plural
        value={summary.sources.length}
        one="Bringing in clips from # place"
        other="Bringing in clips from # places"
      />
    );
  const thinking = long && (kind === 'running' || kind === 'analysing');
  const details = !single || summary.failed > 0 || waiting || ended;
  const expanded = details && (open || search.filter === 'failed');

  return (
    <section
      data-slot="import-strip"
      data-kind={kind}
      aria-label={t`Imports`}
      className="flex flex-col gap-2"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          {thinking ? (
            <Kaatu spot="moment" mood="thinking" />
          ) : combined ? (
            <ImportMark
              state={combined.state}
              waiting={waiting}
              ended={ended}
              anyIn={combined.counts.done > 0}
            />
          ) : (
            <ImportMark state="indexing" waiting={false} ended={false} anyIn />
          )}
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <p role="status" className="m-0 type-label text-ink">
              {title}
            </p>
            {combined ? <ImportMeta status={combined} lines={lines} failed={summary.failed} /> : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {details ? (
            <Button
              size="sm"
              variant="ghost"
              aria-expanded={expanded}
              aria-controls={detailsId}
              onClick={() => setOpen(!expanded)}
              iconPlacement="end"
              icon={
                <ChevronDown
                  aria-hidden
                  className={cn(
                    'transition-transform duration-(--dur-short) ease-(--ease-out) motion-reduce:transition-none',
                    expanded && 'rotate-180',
                  )}
                />
              }
            >
              {t`Details`}
            </Button>
          ) : null}
          {kind === 'running' || kind === 'analysing' ? (
            <Button
              size="sm"
              variant="ghost"
              icon={VERB_ICONS.pause}
              loading={pending === 'pause'}
              disabled={pending !== null && pending !== 'pause'}
              onClick={() => void act('pause')()}
            >
              {t`Pause`}
            </Button>
          ) : kind === 'paused' ? (
            <Button
              size="sm"
              variant="secondary"
              icon={VERB_ICONS.play}
              loading={pending === 'resume'}
              onClick={() => void act('resume')()}
            >
              {t`Resume`}
            </Button>
          ) : null}
        </div>
      </div>
      {error ? <ErrorLine error={error} /> : null}
      {details ? (
        <Collapse open={expanded} id={detailsId}>
          <div data-slot="import-details" className="mt-1 flex flex-col gap-4 rounded-xl bg-panel px-4 py-3">
            {summary.sources.map((each) => (
              <ImportStripSource
                key={each.sourceId}
                status={each}
                source={sources.find((s) => s.id === each.sourceId)}
                pending={pending}
                setPending={setPending}
                setError={setError}
                setStatus={setStatus}
                onSeeFailed={onSeeFailed}
                extrasOnly={single !== undefined}
              />
            ))}
          </div>
        </Collapse>
      ) : null}
    </section>
  );
}

/** Why an import stopped: its scan's error in words, else the likely cause. */
function StoppedWhy({ sourceId, sources }: { sourceId: string; sources: readonly SourceView[] }) {
  const { t, i18n } = useLingui();
  const cause = sources.find((source) => source.id === sourceId)?.scan.error;
  return cause ? errorMessage(i18n, cause) : t`Check that it is still connected, then try again.`;
}
