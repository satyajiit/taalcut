// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: a source's state line · genre: atmospheric studio app (chrome modern-minimal) · system: DESIGN.md v0.6 + UX4 (type-meta)
 * one line under the source's name, in words first and an icon beside them: how many clips and when it was last
 * looked through; looking (a neutral spinner: a background job, never violet); reading N of M; paused; the drive
 * not connected (warning); the folder gone or unreadable (danger, with its cause from the error's own message)
 */
import { msg, plural } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import type { ImportStatus, SourceView } from '@taalcut/core';
import { cn, useFormatters } from '@taalcut/ui';
import { CircleAlert, LoaderCircle, TriangleAlert } from 'lucide-react';
import { Fragment, type ReactNode } from 'react';
import { describeError } from '../model-messages';

export type SourceTone = 'idle' | 'busy' | 'warning' | 'danger';

export interface SourceState {
  readonly tone: SourceTone;
  readonly text: ReactNode;
}

/** Intl's words for a moment, in a <time> as every Intl-formatted moment is: data, in the sentence's own face. */
const moment = (epochMs: number, words: string) => (
  <time dateTime={new Date(epochMs).toISOString()}>{words}</time>
);

const RUNNING: readonly ImportStatus['state'][] = ['scanning', 'receiving', 'indexing'];

/** What a row says about its source now. `now` is for tests. */
export function useSourceState(
  source: SourceView,
  running: ImportStatus | undefined,
  now?: number,
): SourceState {
  const { t, i18n } = useLingui();
  const format = useFormatters();
  if (source.status === 'missing')
    return {
      tone: 'danger',
      text: t`Taalcut can’t find this folder. If you moved or renamed it, remove it and add it again.`,
    };
  if (source.status === 'offline')
    return {
      tone: 'warning',
      text: t`The drive isn’t connected. Connect it and Taalcut picks up where it left off.`,
    };
  if (source.scan.state === 'error')
    return {
      tone: 'danger',
      text: source.scan.error
        ? describeError(i18n, source.scan.error)
        : t`Taalcut couldn’t look through this folder. Check it again.`,
    };
  if (source.scan.state === 'scanning' || running?.state === 'scanning')
    return { tone: 'busy', text: t`Looking for clips…` };
  if (running && RUNNING.includes(running.state)) {
    const done = format.count(running.counts.done);
    const all = format.count(running.counts.assets);
    return { tone: 'busy', text: t`Reading ${done} of ${all} clips` };
  }
  if (running?.state === 'paused') {
    const done = format.count(running.counts.done);
    const all = format.count(running.counts.assets);
    return { tone: 'idle', text: t`Reading paused at ${done} of ${all} clips` };
  }

  const parts: ReactNode[] = [i18n._(msg`${plural(source.assets, { one: '# clip', other: '# clips' })}`)];
  if (source.missing > 0) {
    const missing = format.count(source.missing);
    parts.push(t`${missing} missing`);
  }
  if (source.kind === 'watched_folder') {
    const last = source.scan.lastScanAt;
    if (last !== null) {
      const when = moment(last, format.relativeDay(last, now));
      parts.push(<Trans>Checked {when}</Trans>);
    }
    if (!source.watch) parts.push(t`Not watched`);
  } else {
    const when = moment(source.createdAt, format.relativeDay(source.createdAt, now));
    parts.push(<Trans>Added {when}</Trans>);
  }
  return {
    tone: 'idle',
    text: parts.map((part, index) => (
      // The parts are in a fixed order and never reorder: the index is their identity.
      <Fragment key={index}>
        {index > 0 ? ' · ' : null}
        {part}
      </Fragment>
    )),
  };
}

const ICONS = {
  busy: <LoaderCircle aria-hidden className="size-3.5 shrink-0 animate-spin text-ink-3" />,
  warning: <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0 text-warning-strong" />,
  danger: <CircleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0 text-danger-strong" />,
} as const;

export function SourceStatusLine({ state, id }: { state: SourceState; id?: string }) {
  return (
    <p
      id={id}
      data-slot="source-status"
      data-tone={state.tone}
      className={cn(
        'm-0 flex min-w-0 items-start gap-1.5 type-meta tabular-nums',
        state.tone === 'danger' ? 'text-danger-strong' : 'text-ink-2',
        state.tone === 'busy' && 'items-center',
      )}
    >
      {state.tone === 'idle' ? null : ICONS[state.tone]}
      <span className="min-w-0">{state.text}</span>
    </p>
  );
}
