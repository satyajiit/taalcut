// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: span-details · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.2 · a definition list under a hairline, no boxed panel; numbers tabular in the text face
 * states: default
 */
import { Trans, useLingui } from '@lingui/react/macro';
import type { ReactNode } from 'react';
import type { Span } from '@taalcut/core';
import { formatCount, formatUsd } from '../shared/format';
import { Duration } from '../shared/time';
import { providerName } from '../settings/providers';
import { KINDS, SIDE_EFFECTS, spanStatusLabel, STOP_REASONS } from './trace-labels';

function Row({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-wrap justify-between gap-x-4 gap-y-0.5 border-t border-rule-subtle py-1.5 first:border-t-0">
      <dt className="text-ink-2">{label}</dt>
      <dd className="m-0 text-right text-ink">{children}</dd>
    </div>
  );
}

/** Everything a span recorded: model, tokens, cost, latency, tries, cache, errors. */
export function SpanDetails({
  span,
  windowStart,
  windowEnd,
}: {
  span: Span;
  windowStart: number;
  windowEnd: number;
}) {
  const { i18n } = useLingui();
  const mono = 'tabular-nums';
  const provider = span.provider ? (providerName(i18n, span.provider) ?? span.provider) : null;
  return (
    <section
      aria-labelledby={`span-${span.spanId}`}
      className="flex flex-col gap-2 border-t border-rule-subtle pt-4"
    >
      <h3 id={`span-${span.spanId}`} className="text-md font-semibold [overflow-wrap:anywhere]">
        <span translate="no">{span.name}</span>
      </h3>
      <dl className="m-0 flex flex-col text-sm">
        <Row label={<Trans>Kind</Trans>}>{i18n._(KINDS[span.kind].label)}</Row>
        <Row label={<Trans>Status</Trans>}>{i18n._(spanStatusLabel(span.status))}</Row>
        <Row label={<Trans>Started after</Trans>}>
          <Duration ms={span.startedAt - windowStart} />
        </Row>
        <Row label={<Trans>Took</Trans>}>
          <Duration ms={(span.endedAt ?? windowEnd) - span.startedAt} />
        </Row>
        {provider ? <Row label={<Trans>Provider</Trans>}>{provider}</Row> : null}
        {span.model ? (
          <Row label={<Trans>Model</Trans>}>
            <span translate="no">{span.model}</span>
          </Row>
        ) : null}
        {span.tool ? (
          <Row label={<Trans>Tool</Trans>}>
            <span translate="no">
              {span.tool} {span.version}
            </span>
          </Row>
        ) : null}
        {span.sideEffect ? (
          <Row label={<Trans>What it does</Trans>}>{i18n._(SIDE_EFFECTS[span.sideEffect])}</Row>
        ) : null}
        {span.inputTokens !== undefined ? (
          <Row label={<Trans>Tokens sent</Trans>}>
            <span className={mono}>{formatCount(i18n, span.inputTokens)}</span>
          </Row>
        ) : null}
        {span.cachedInputTokens ? (
          <Row label={<Trans>Tokens from the cache</Trans>}>
            <span className={mono}>{formatCount(i18n, span.cachedInputTokens)}</span>
          </Row>
        ) : null}
        {span.outputTokens !== undefined ? (
          <Row label={<Trans>Tokens received</Trans>}>
            <span className={mono}>{formatCount(i18n, span.outputTokens)}</span>
          </Row>
        ) : null}
        {span.kind === 'model' || span.kind === 'tool' ? (
          <Row label={<Trans>Cost</Trans>}>
            {span.costUsd === undefined ? (
              <span className="text-danger-strong">
                <Trans>Not recorded</Trans>
              </span>
            ) : (
              <span className={mono}>{formatUsd(i18n, span.costUsd)}</span>
            )}
          </Row>
        ) : null}
        {span.stopReason ? (
          <Row label={<Trans>Stopped because</Trans>}>{i18n._(STOP_REASONS[span.stopReason])}</Row>
        ) : null}
        {span.attempts !== undefined ? (
          <Row label={<Trans>Tries</Trans>}>
            <span className={mono}>{formatCount(i18n, span.attempts)}</span>
          </Row>
        ) : null}
        {span.cacheHit !== undefined ? (
          <Row label={<Trans>From the cache</Trans>}>
            {span.cacheHit ? <Trans>Yes</Trans> : <Trans>No</Trans>}
          </Row>
        ) : null}
        {span.deduplicated ? (
          <Row label={<Trans>Already done</Trans>}>
            <Trans>Yes, the earlier result was reused</Trans>
          </Row>
        ) : null}
        {span.errorCode ? (
          <Row label={<Trans>Error</Trans>}>
            <span className="text-danger-strong" translate="no">
              {span.errorCode}
            </span>
          </Row>
        ) : null}
        {span.events.map((event) => (
          <Row
            key={`${event.name}-${event.at}`}
            label={event.name === 'retry' ? <Trans>Retried at</Trans> : <Trans>Fell back at</Trans>}
          >
            <Duration ms={event.at - windowStart} />{' '}
            {event.detail ? (
              <span className="text-ink-3" translate="no">
                ({event.detail})
              </span>
            ) : null}
          </Row>
        ))}
      </dl>
    </section>
  );
}
