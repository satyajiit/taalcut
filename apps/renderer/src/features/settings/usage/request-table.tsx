// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: Usage › every request, the table · genre: atmospheric studio app (chrome modern-minimal)
 *   · system: DESIGN.md v0.3
 * the built studio table in a horizontal scroll region: job and when, provider (its logo) and model id (as
 *   written, breaking only after a slash), tokens sent and received, cost and how long it took. Numbers in the text
 *   face with tabular figures.
 * states: default · hover (row wash) · focus (the scroll region) · active/disabled (n/a: reading only) · loading
 *   and error (the log's) · success (rows) · empty (one line: none match yet, or none in this period and filter)
 */
import { Trans, useLingui } from '@lingui/react/macro';
import type { CloudCallRecord } from '@taalcut/core';
import { ProviderLogo } from '@taalcut/ui';
import { Fragment } from 'react';
import { formatCount, formatUsd } from '../../shared/format';
import { DateTime, Duration } from '../../shared/time';
import { jobName, providerLabel } from './usage-words';

// type-caption in its own case: an uppercase header does nothing for Hindi.
const HEAD = 'bg-well px-4 py-2.5 type-caption whitespace-nowrap text-ink-3';

/** "@cf/cloudflare/clef-flash": may break after a slash, never inside a word. */
function ModelId({ id }: { id: string }) {
  const parts = id.split('/');
  return (
    <span className="block type-meta text-ink-3" translate="no">
      {parts.map((part, i) => (
        <Fragment key={i}>
          {part}
          {i < parts.length - 1 ? (
            <>
              /<wbr />
            </>
          ) : null}
        </Fragment>
      ))}
    </span>
  );
}

function Row({ record }: { record: CloudCallRecord }) {
  const { i18n } = useLingui();
  const provider = providerLabel(i18n, record.provider, record.local);
  const cellClassName = 'border-t border-rule-subtle px-4 py-3 align-top';
  const numberClassName = `${cellClassName} text-right whitespace-nowrap`;
  const sent = formatCount(i18n, record.inputTokens + record.cachedInputTokens);
  const received = formatCount(i18n, record.outputTokens);
  return (
    <tr className="transition-colors hover:bg-hover/50">
      <td className={cellClassName}>
        <span className="block font-medium text-ink">{jobName(i18n, record.module)}</span>
        <DateTime at={record.startedAt} className="block type-meta text-ink-3" />
      </td>
      <td className={cellClassName}>
        <div className="flex items-start gap-2.5">
          <ProviderLogo
            provider={record.local ? 'on-device' : record.provider}
            size="sm"
            className="mt-0.5"
          />
          <div className="min-w-0">
            <span className="block font-medium text-ink" translate={provider ? undefined : 'no'}>
              {provider ?? record.provider}
            </span>
            <ModelId id={record.model} />
          </div>
        </div>
      </td>
      <td className={numberClassName}>
        <span className="block text-ink">
          <Trans>{sent} sent</Trans>
        </span>
        <span className="block type-meta text-ink-3">
          <Trans>{received} received</Trans>
        </span>
      </td>
      <td className={numberClassName}>
        <span className="block font-medium text-ink">
          {record.billing === 'subscription' ? <Trans>Using plan</Trans> : formatUsd(i18n, record.costUsd)}
        </span>
        <Duration ms={record.latencyMs} className="block type-meta text-ink-3" />
      </td>
    </tr>
  );
}

/** The requests read so far that match the view; `older`: there are older pages to look at. */
export function RequestTable({ records, older }: { records: readonly CloudCallRecord[]; older: boolean }) {
  const { t } = useLingui();
  return (
    <div
      role="region"
      aria-label={t`Requests`}
      tabIndex={0}
      data-scroll-x
      className="overflow-x-auto rounded-lg border border-rule-subtle bg-raised scrollbar-thin"
    >
      <table className="w-full min-w-[24rem] border-collapse text-left type-data">
        <caption className="sr-only">
          <Trans>Requests to models, newest first</Trans>
        </caption>
        <thead>
          <tr>
            <th scope="col" className={HEAD}>
              {t`Job`}
            </th>
            <th scope="col" className={HEAD}>
              {t`Model`}
            </th>
            <th scope="col" className={`${HEAD} text-right`}>
              {t`Tokens`}
            </th>
            <th scope="col" className={`${HEAD} text-right`}>
              {t`Cost`}
            </th>
          </tr>
        </thead>
        <tbody>
          {records.map((record) => (
            <Row key={record.id} record={record} />
          ))}
        </tbody>
      </table>
      {records.length === 0 ? (
        <p className="m-0 border-t border-rule-subtle px-4 py-6 type-body text-ink-2">
          {older ? (
            <Trans>None of the latest requests match. Show older ones to look further back.</Trans>
          ) : (
            <Trans>No requests match this period and filter.</Trans>
          )}
        </p>
      ) : null}
    </div>
  );
}
