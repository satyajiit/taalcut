// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { Trans, useLingui } from '@lingui/react/macro';
import { IMPORT_COMMANDS } from '@taalcut/core';
import { Button } from '@taalcut/ui';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useBackend } from '../../../backend/backend';
import { useRpcQuery } from '../../../backend/use-rpc';
import { ImportError } from './import-error';
import { useImportCommand } from './use-import-command';

/** Eject asks main to quiesce every reader and let the operating system release the mounted source. */
export function MountedSources() {
  const { t } = useLingui();
  const backend = useBackend();
  const query = useRpcQuery((signal) => backend.imports.sources({}, { signal }), [backend]);
  const action = useImportCommand();
  const [ejected, setEjected] = useState<string | null>(null);
  const sources = [
    ...new Map(
      (query.data ?? [])
        .filter((source) => source.available && ['camera', 'dji', 'insta360'].includes(source.method))
        .map((source) => [source.id, source]),
    ).values(),
  ];
  const eject = async (sourceId: string, label: string) => {
    if (await action.run(IMPORT_COMMANDS.ejectSource, { sourceId })) {
      setEjected(label);
      query.reload();
    }
  };
  if (!sources.length && !query.error && !ejected)
    return (
      <Button
        variant="ghost"
        className="self-start"
        loading={query.refreshing}
        onClick={query.reload}
      >{t`Check connected cameras and cards`}</Button>
    );
  return (
    <section className="flex flex-col gap-3" aria-label={t`Connected cameras and cards`}>
      <h2 className="m-0 type-section">{t`Connected cameras and cards`}</h2>
      <Button
        variant="ghost"
        className="self-start"
        loading={query.refreshing}
        onClick={query.reload}
      >{t`Check connected cameras and cards`}</Button>
      <p className="m-0 type-body text-ink-2">
        <Trans>
          Eject finishes Taalcut’s reads and asks this computer to release the source. Keep it connected until
          ejection succeeds.
        </Trans>
      </p>
      {sources.map((source) => (
        <div key={source.id} className="flex flex-wrap items-center gap-3 border-b border-rule-subtle py-3">
          <span className="min-w-0 flex-1 break-words type-label" translate="no">
            {source.label}
          </span>
          <Button asChild variant="secondary">
            <Link to="/library/import/$method" params={{ method: source.method }}>{t`Choose footage`}</Link>
          </Button>
          <Button
            variant="ghost"
            disabled={action.pending}
            onClick={() => void eject(source.id, source.label)}
          >{t`Eject`}</Button>
        </div>
      ))}
      {ejected ? (
        <p role="status" className="m-0 type-body">
          <Trans>
            Ejected <span translate="no">{ejected}</span>. You can disconnect it.
          </Trans>
        </p>
      ) : null}
      {query.error ? <ImportError error={query.error} onRetry={query.reload} /> : null}
      {action.error ? <ImportError error={action.error} /> : null}
    </section>
  );
}
