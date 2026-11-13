// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: waterfall · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.2 · one row per span; numbers in the text face, tabular; running spans violet
 * states: default · hover · focus · active (selected)
 */
import { Plural, Trans, useLingui } from '@lingui/react/macro';
import { Badge, cn } from '@taalcut/ui';
import { CircleAlert, RefreshCw } from 'lucide-react';
import type { Trace } from '@taalcut/core';
import { formatDuration } from '../shared/format';
import { placeSpans, spanDuration, traceWindow } from './span-tree';
import { KINDS, spanStatusLabel } from './trace-labels';

const TICKS = [0, 0.25, 0.5, 0.75, 1];

/**
 * The run as a waterfall: one row per span, indented by nesting, with a bar
 * placed on the run's timeline. Each row is a button that shows the span's
 * details; colour always comes with the kind's icon and word.
 */
export function Waterfall({
  trace,
  selected,
  onSelect,
}: {
  trace: Trace;
  selected: string | null;
  onSelect: (spanId: string) => void;
}) {
  const { t, i18n } = useLingui();
  const frame = traceWindow(trace);
  const length = frame.end - frame.start;
  const rows = placeSpans(trace);

  return (
    <div className="flex flex-col">
      <div
        aria-hidden
        className="grid grid-cols-[minmax(12rem,2fr)_3fr] gap-3 border-b border-rule-subtle pb-1.5 text-2xs text-ink-3"
      >
        <span>{t`Span`}</span>
        <span className="relative h-4">
          {TICKS.map((tick) => (
            <time
              key={tick}
              dateTime={`PT${((tick * length) / 1000).toFixed(3)}S`}
              className={cn(
                'absolute top-0 font-sans whitespace-nowrap tabular-nums',
                tick === 1 ? '-translate-x-full' : tick > 0 ? '-translate-x-1/2' : '',
              )}
              style={{ left: `${tick * 100}%` }}
            >
              {formatDuration(i18n, tick * length)}
            </time>
          ))}
        </span>
      </div>
      <ol className="m-0 flex list-none flex-col p-0" aria-label={t`Spans, in order`}>
        {rows.map(({ span, depth, from, to, open }) => {
          const kind = KINDS[span.kind];
          const Icon = kind.icon;
          const failed = span.status === 'error';
          const retries = span.events.filter((e) => e.name === 'retry').length;
          const duration = spanDuration(span, frame.end);
          const label = i18n._(kind.label);
          const status = i18n._(spanStatusLabel(span.status));
          const took = formatDuration(i18n, duration);
          return (
            <li key={span.spanId}>
              <button
                type="button"
                aria-current={selected === span.spanId ? 'true' : undefined}
                onClick={() => onSelect(span.spanId)}
                className={cn(
                  'grid w-full grid-cols-[minmax(12rem,2fr)_3fr] items-center gap-3 rounded-md py-1.5 text-left',
                  'hover:bg-hover active:bg-pressed aria-[current=true]:bg-selected',
                )}
              >
                <span
                  className="flex min-w-0 items-start gap-1.5"
                  style={{ paddingLeft: `${depth * 0.875}rem` }}
                >
                  <Icon
                    aria-hidden
                    className={cn(
                      'mt-0.5 size-3.5 shrink-0',
                      span.kind === 'model' ? 'text-ai-strong' : 'text-ink-3',
                    )}
                  />
                  <span className="flex min-w-0 flex-col">
                    <span className="text-sm [overflow-wrap:anywhere] text-ink" translate="no">
                      {span.name}
                    </span>
                    <span className="flex flex-wrap items-center gap-1 text-2xs text-ink-3">
                      <span>{label}</span>
                      <span aria-hidden>·</span>
                      <span className="sr-only">{status}</span>
                      <time
                        className="font-sans tabular-nums"
                        dateTime={`PT${(duration / 1000).toFixed(3)}S`}
                      >
                        {took}
                      </time>
                      {failed ? (
                        <Badge tone="danger">
                          <CircleAlert aria-hidden />
                          {status}
                        </Badge>
                      ) : null}
                      {open ? <Badge tone="ai">{status}</Badge> : null}
                      {span.cacheHit ? (
                        <Badge tone="neutral">
                          <Trans>Cached</Trans>
                        </Badge>
                      ) : null}
                      {retries > 0 ? (
                        <Badge tone="warning">
                          <RefreshCw aria-hidden />
                          <Plural value={retries} one="# retry" other="# retries" />
                        </Badge>
                      ) : null}
                    </span>
                  </span>
                </span>
                <span aria-hidden className="relative h-3 rounded-sm bg-sunken">
                  <span
                    className={cn(
                      'absolute inset-y-0 max-w-full rounded-sm',
                      failed ? 'bg-danger-strong' : kind.bar,
                      open && 'opacity-60',
                    )}
                    // At least 2 px wide, and never past the track's end (a span that just started).
                    style={{
                      left: `min(${from * 100}%, 100% - 2px)`,
                      width: `max(${(to - from) * 100}%, 2px)`,
                    }}
                  />
                  {span.events.map((event) => (
                    <span
                      key={`${event.name}-${event.at}`}
                      className="absolute -inset-y-0.5 w-0.5 bg-warning-strong"
                      style={{ left: `min(${((event.at - frame.start) / length) * 100}%, 100% - 2px)` }}
                    />
                  ))}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
