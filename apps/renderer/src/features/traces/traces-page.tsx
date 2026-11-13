// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: traces-page · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.2 · runs as hairline rows (selected row tinted), facts tabular in the text face,
 * a plain sentence when there is nothing yet
 * states: default · hover · focus · active · loading · error
 */
import { Plural, Trans, useLingui } from '@lingui/react/macro';
import type { RunId, Trace, TraceSummary } from '@taalcut/core';
import { Button, Chip, cn } from '@taalcut/ui';
import { Link } from '@tanstack/react-router';
import { useEffect, useState, type ReactNode } from 'react';
import { useBackend } from '../../backend/backend';
import { useRpcQuery } from '../../backend/use-rpc';
import { Page } from '../../shell/page';
import { LoadError, Loading, Notice } from '../settings/fields';
import { formatCompact, formatCount, formatUsd } from '../shared/format';
import { DateTime, Duration } from '../shared/time';
import { SpanDetails } from './span-details';
import { traceTotals, traceWindow } from './span-tree';
import { GAP_REASONS, RunStatusChip } from './trace-labels';
import { Waterfall } from './waterfall';

function RunList({ runs, selected }: { runs: readonly TraceSummary[]; selected: string | undefined }) {
  const { t, i18n } = useLingui();
  return (
    <nav aria-label={t`Runs`}>
      <ul className="m-0 flex list-none flex-col p-0">
        {runs.map((run) => {
          const cost = formatUsd(i18n, run.costUsd);
          const tokens = formatCompact(i18n, run.tokens);
          return (
            <li key={run.runId} className="border-t border-rule-subtle first:border-t-0">
              <Link
                to="/dev/traces"
                search={{ run: run.runId }}
                aria-current={run.runId === selected ? 'page' : undefined}
                className={cn(
                  'my-1 flex flex-col gap-1.5 rounded-md px-2 py-2 text-sm no-underline',
                  'hover:bg-hover active:bg-pressed aria-[current=page]:bg-selected',
                )}
              >
                <span className="font-medium text-ink [overflow-wrap:anywhere]" translate="no">
                  {run.message}
                </span>
                <span className="flex flex-wrap items-center gap-1.5 text-xs text-ink-3">
                  <RunStatusChip status={run.status} />
                  <DateTime at={run.startedAt} />
                </span>
                <span className="text-xs text-ink-3 tabular-nums">
                  <Trans>
                    {tokens} tokens · {cost}
                  </Trans>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function Fact({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-ink-3">{label}</dt>
      <dd className="m-0 text-md text-ink tabular-nums">{children}</dd>
    </div>
  );
}

function RunDetail({ trace }: { trace: Trace }) {
  const { t, i18n } = useLingui();
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => setSelected(null), [trace.runId]);
  const totals = traceTotals(trace);
  const frame = traceWindow(trace);
  const span = trace.spans.find((s) => s.spanId === selected);
  const gaps = trace.gaps.length;
  const missing = new Intl.ListFormat(i18n.locale, { type: 'conjunction' }).format(
    trace.gaps.map((gap) => {
      const what = i18n._(GAP_REASONS[gap.reason]);
      const seq = formatCount(i18n, gap.seq);
      return t`${what} (log entry ${seq})`;
    }),
  );
  return (
    <section aria-labelledby="run-title" className="flex min-w-0 flex-col gap-5">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <RunStatusChip status={trace.status} />
          <DateTime at={trace.startedAt} className="text-sm text-ink-3" />
        </div>
        <h2 id="run-title" className="text-xl font-semibold [overflow-wrap:anywhere]" translate="no">
          {trace.message}
        </h2>
      </div>
      <dl className="m-0 grid grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] gap-4">
        <Fact label={<Trans>Time</Trans>}>
          <Duration ms={frame.end - frame.start} />
        </Fact>
        <Fact label={<Trans>Model calls</Trans>}>{formatCount(i18n, totals.modelCalls)}</Fact>
        <Fact label={<Trans>Tool calls</Trans>}>{formatCount(i18n, totals.toolCalls)}</Fact>
        <Fact label={<Trans>Tokens</Trans>}>
          {formatCompact(i18n, totals.inputTokens + totals.cachedInputTokens + totals.outputTokens)}
        </Fact>
        <Fact label={<Trans>Cost</Trans>}>{formatUsd(i18n, totals.costUsd)}</Fact>
        <Fact label={<Trans>Cache hits</Trans>}>{formatCount(i18n, totals.cacheHits)}</Fact>
      </dl>
      {trace.status === 'running' || trace.status === 'paused' ? null : gaps === 0 ? (
        <Notice tone="success">
          <Trans>Complete: every call has its outcome, tokens, cost and time.</Trans>
        </Notice>
      ) : (
        <Notice tone="warning">
          <Plural
            value={gaps}
            one="# thing is missing from this trace:"
            other="# things are missing from this trace:"
          />{' '}
          {missing}
        </Notice>
      )}
      <Waterfall trace={trace} selected={selected} onSelect={setSelected} />
      {span ? (
        <SpanDetails span={span} windowStart={frame.start} windowEnd={frame.end} />
      ) : (
        <p className="m-0 text-sm text-ink-3">
          <Trans>Choose a span to see its model, tokens, cost and time.</Trans>
        </p>
      )}
    </section>
  );
}

/**
 * Developer trace viewer (G16, P1-G5): the agent's runs, newest first, and
 * the chosen run as a waterfall of spans. The route exists in every build;
 * links to it show only in development.
 */
export function TracesPage({ runId }: { runId: RunId | undefined }) {
  const { t } = useLingui();
  const backend = useBackend();
  const runs = useRpcQuery((signal) => backend.traces.runs({}, { signal }), [backend]);
  const chosen = runId ?? runs.data?.[0]?.runId;
  const trace = useRpcQuery(
    async (signal) => (chosen ? backend.traces.get({ runId: chosen }, { signal }) : null),
    [backend, chosen],
  );

  return (
    <Page
      title={t`Traces`}
      description={<Trans>Every step the agent took, with its time, tokens and cost.</Trans>}
      actions={
        <Chip tone="neutral">
          <Trans>For developers</Trans>
        </Chip>
      }
    >
      {runs.status === 'loading' ? <Loading /> : null}
      {runs.status === 'error' ? <LoadError error={runs.error} onRetry={runs.reload} /> : null}
      {runs.data?.length === 0 ? (
        <div className="flex flex-col items-start gap-3">
          <p className="m-0 max-w-[60ch] text-md text-ink-2">
            <Trans>
              No runs yet. Ask for something in chat, and each step the agent takes shows up here.
            </Trans>
          </p>
          <Button asChild>
            <Link to="/chat">
              <Trans>Open a chat</Trans>
            </Link>
          </Button>
        </div>
      ) : null}
      {runs.data && runs.data.length > 0 ? (
        <div className="@container">
          <div className="grid gap-6 @3xl:grid-cols-[16rem_minmax(0,1fr)]">
            <RunList runs={runs.data} selected={chosen} />
            {/* Another run chosen: its spans load in place of the last run's, never under its name. */}
            {trace.status === 'loading' ? (
              <Loading />
            ) : trace.status === 'error' ? (
              <LoadError error={trace.error} onRetry={trace.reload} />
            ) : trace.data ? (
              <RunDetail trace={trace.data} />
            ) : null}
          </div>
        </div>
      ) : null}
    </Page>
  );
}
