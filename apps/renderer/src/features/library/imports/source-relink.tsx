// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { ImportError } from './import-error';
import { Trans, useLingui } from '@lingui/react/macro';
import {
  callRpc,
  idSchema,
  LIBRARY_COMMANDS,
  type JobId,
  type SourceId,
  type TaalcutError,
} from '@taalcut/core';
import { Button } from '@taalcut/ui';
import { useEffect, useState } from 'react';
import { z } from 'zod';
import { useBackend } from '../../../backend/backend';
import { useRpcQuery } from '../../../backend/use-rpc';
import { useImportCommand } from './use-import-command';

const candidatesSchema = z.object({
  candidates: z.array(
    z.object({
      locationId: idSchema<'AssetLocation'>(),
      path: z.string(),
      contentHash: z.string().regex(/^[0-9a-f]{64}$/),
    }),
  ),
});
export function SourceRelink({ sourceId, onRelinked }: { sourceId: SourceId; onRelinked: () => void }) {
  const { t, i18n } = useLingui();
  const backend = useBackend();
  const action = useImportCommand();
  const [jobId, setJobId] = useState<JobId | null>(null);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<TaalcutError | null>(null);
  const [done, setDone] = useState(false);
  const job = useRpcQuery(
    (signal) => (jobId ? backend.jobs.get({ id: jobId }, { signal }) : Promise.resolve(null)),
    [backend, jobId],
  );
  useEffect(() => {
    if (!jobId || ['succeeded', 'failed', 'cancelled'].includes(job.data?.state ?? '')) return;
    const timer = setTimeout(job.reload, 750);
    return () => clearTimeout(timer);
  }, [jobId, job.data, job.reload]);
  const find = async () => {
    setError(null);
    setDone(false);
    setPicking(true);
    const picked = await callRpc(backend.files.pickFolder());
    setPicking(false);
    if (!picked.ok) {
      setError(picked.error);
      return;
    }
    if (!picked.value) return;
    const result = await action.run<{ jobId: JobId }>(LIBRARY_COMMANDS.findMissing, {
      sourceId,
      searchIn: picked.value.path,
    });
    if (result) setJobId(result.jobId);
  };
  const parsed = candidatesSchema.safeParse(job.data?.output);
  const candidates = parsed.success ? parsed.data.candidates : [];
  const foundCount = new Intl.NumberFormat(i18n.locale).format(candidates.length);
  const relink = async () => {
    for (let offset = 0; offset < candidates.length; offset += 500) {
      const result = await action.run(LIBRARY_COMMANDS.relinkLocations, {
        items: candidates.slice(offset, offset + 500),
      });
      if (!result) return;
    }
    setDone(true);
    setJobId(null);
    onRelinked();
  };
  const searching = Boolean(jobId) && !['succeeded', 'failed', 'cancelled'].includes(job.data?.state ?? '');
  return (
    <section className="flex flex-col gap-3 rounded-lg bg-panel p-4" aria-label={t`Relink missing footage`}>
      <h2 className="m-0 type-card-title">{t`Find missing originals`}</h2>
      <p className="m-0 max-w-prose type-body text-ink-2">
        <Trans>
          Choose the folder where the files are now. Taalcut checks their contents before offering to relink
          them, preserving your clips and analysis.
        </Trans>
      </p>
      <Button
        variant="secondary"
        className="self-start"
        loading={picking || action.pending || searching}
        onClick={() => void find()}
      >{t`Choose folder to search…`}</Button>
      {searching ? (
        <p role="status" className="m-0 type-body">{t`Checking for matching originals…`}</p>
      ) : null}
      {done ? (
        <p
          role="status"
          className="m-0 type-body text-success-strong"
        >{t`Originals relinked. Your existing clips and analysis are preserved.`}</p>
      ) : null}
      {job.data?.state === 'succeeded' ? (
        <>
          {candidates.length ? (
            <>
              <p className="m-0 type-body">{t`${foundCount} exact matches found`}</p>
              <ul className="m-0 max-h-48 overflow-auto pl-5 type-meta text-ink-2">
                {candidates.slice(0, 500).map((item) => (
                  <li key={item.locationId} className="break-all" translate="no">
                    {item.path}
                  </li>
                ))}
              </ul>
              <Button
                className="self-start"
                variant="primary"
                loading={action.pending}
                onClick={() => void relink()}
              >{t`Relink matching originals`}</Button>
            </>
          ) : (
            <p
              role="status"
              className="m-0 type-body"
            >{t`No exact matches found. Choose another folder with the unchanged originals.`}</p>
          )}
        </>
      ) : null}
      {error || action.error || job.error || job.data?.error ? (
        <ImportError error={(error ?? action.error ?? job.error ?? job.data?.error)!} />
      ) : null}
    </section>
  );
}
