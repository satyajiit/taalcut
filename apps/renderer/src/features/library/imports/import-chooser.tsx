// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { ImportError } from './import-error';
import { Trans, useLingui } from '@lingui/react/macro';
import type { ImportMethod, ImportSource } from '@taalcut/core';
import { Button } from '@taalcut/ui';
import { Link } from '@tanstack/react-router';
import { ChevronRight } from 'lucide-react';
import { useBackend } from '../../../backend/backend';
import { useRpcQuery } from '../../../backend/use-rpc';
import { Page } from '../../../shell/page';
import { METHOD_ICONS, METHOD_NAMES, METHOD_NOTES } from './import-words';

function Methods({
  title,
  methods,
  sources,
}: {
  title: string;
  methods: ImportMethod[];
  sources: ImportSource[];
}) {
  const { t, i18n } = useLingui();
  return (
    <section className="flex flex-col gap-3">
      <h2 className="m-0 type-section text-ink">{title}</h2>
      <div className="divide-y divide-rule-subtle border-y border-rule-subtle">
        {methods.map((method) => {
          const Icon = METHOD_ICONS[method];
          return (
            <Link
              key={method}
              to="/library/import/$method"
              params={{ method }}
              className="flex min-h-20 items-center gap-4 rounded-md px-3 py-4 text-ink transition-colors duration-(--dur-micro) hover:bg-hover"
            >
              <Icon aria-hidden className="size-5 shrink-0 text-ink-2" />
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="type-card-title">{i18n._(METHOD_NAMES[method])}</span>
                <span className="type-body text-ink-2">{i18n._(METHOD_NOTES[method])}</span>
                {sources
                  .filter((source) => source.method === method && source.available)
                  .map((source) => (
                    <span key={source.id} className="type-meta text-ink-2">
                      {t`Available`}: <span translate="no">{source.label}</span>
                    </span>
                  ))}
              </span>
              <ChevronRight aria-hidden className="size-4 shrink-0 text-ink-3" />
            </Link>
          );
        })}
      </div>
    </section>
  );
}

export function ImportChooser() {
  const { t, i18n } = useLingui();
  const backend = useBackend();
  const sources = useRpcQuery((signal) => backend.imports.sources({}, { signal }), [backend]);
  const drafts = useRpcQuery((signal) => backend.imports.drafts(undefined, { signal }), [backend]);
  return (
    <Page
      title={t`Import`}
      description={t`Choose where your footage is. You’ll review it before anything is imported.`}
    >
      {drafts.error ? <ImportError error={drafts.error} onRetry={drafts.reload} /> : null}
      {drafts.data && drafts.data.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="m-0 type-section">
            <Trans>Continue an import</Trans>
          </h2>
          {drafts.data.map((draft) => (
            <div
              key={draft.id}
              className="flex flex-wrap items-center justify-between gap-3 border-b border-rule-subtle pb-3"
            >
              <span className="min-w-0 truncate type-body" translate="no">
                {draft.sourceLabel || i18n._(METHOD_NAMES[draft.method])}
              </span>
              <Button asChild variant="secondary" size="sm">
                <Link
                  to="/library/import/$method/$draftId/review"
                  params={{ method: draft.method, draftId: draft.id }}
                >{t`Review`}</Link>
              </Button>
            </div>
          ))}
        </section>
      ) : null}
      <Methods
        sources={sources.data ?? []}
        title={t`This computer`}
        methods={['files', 'folder', 'photos']}
      />
      <Methods sources={sources.data ?? []} title={t`Phones`} methods={['phone-wifi', 'phone-cable']} />
      <Methods
        sources={sources.data ?? []}
        title={t`Cameras and cards`}
        methods={['camera', 'dji', 'insta360']}
      />
    </Page>
  );
}
