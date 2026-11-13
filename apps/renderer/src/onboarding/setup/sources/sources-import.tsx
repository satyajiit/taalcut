// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* component: onboarding, your videos coming in (UX4: the import step folded into Your videos) · genre: atmospheric
 *   studio app · system: DESIGN.md v0.4 + _orch/ux4/specs/design-onb.md
 * what the step's Kaatu moment says, from the import as it runs (sources-moment.tsx), and the import's own view under
 *   the ways in: each source's progress as the import card shows it, with Pause, Resume and Try again (background
 *   work runs neutral). A cable import's run block stays in the cable way's panel, its one place. "Imported"
 *   (hashed, probed, posters made) is the moment's success; descriptions, speech and search carry on behind it,
 *   and the step says so.
 * states: reading (nothing until the first status: the moment holds the tip) · importing · paused · some failed ·
 *   failed (the view's cause and Try again) · imported (the moment's success, announced) · pause/resume failing (the
 *   cause under the view) · the status unreadable (an ErrorLine and Try again)
 */
import { useLingui } from '@lingui/react/macro';
import {
  callRpc,
  type DeviceRun,
  type ImportStatus,
  type IndexingStatus,
  type SourceView,
  type TaalcutError,
} from '@taalcut/core';
import { Button, ErrorLine, ImportProgressView, UserContent } from '@taalcut/ui';
import { useEffect, useRef, useState } from 'react';
import { useBackend } from '../../../backend/backend';
import { useIndexingStatus } from '../../../features/library/import-strip';
import { isImported } from '../../imported';
import { msSinceStart } from '../../started-at';
import { STEP_ICONS } from '../../step-icons';
import { useTelemetry } from '../../use-onboarding';

/** Cable runs to show: running, paused, or finished in the last hour. */
export function cableRuns(runs: readonly DeviceRun[], now: number): DeviceRun[] {
  return runs.filter(
    (run) => run.state !== 'cancelled' && (run.state !== 'succeeded' || now - run.updatedAt < 3_600_000),
  );
}

type ImportAction = 'pause' | 'resume' | 'retry';

/** Pause, Resume and Try again on the import, with the one in flight and the last failure. */
function useImportActions(setStatus: (next: IndexingStatus) => void) {
  const backend = useBackend();
  const [pending, setPending] = useState<ImportAction | null>(null);
  const [error, setError] = useState<TaalcutError | null>(null);
  const act = (kind: ImportAction) => async () => {
    setPending(kind);
    setError(null);
    const result =
      kind === 'retry'
        ? await callRpc(backend.indexing.retryFailed({}))
        : await callRpc(kind === 'pause' ? backend.indexing.pause() : backend.indexing.resume());
    setPending(null);
    if (!result.ok) return setError(result.error);
    if (kind !== 'retry') setStatus(result.value as IndexingStatus);
  };
  return { pending, error, act };
}

/** The import as first run follows it: the first source's status, whether it is in, and its controls. */
export interface SourcesImport {
  readonly status: IndexingStatus | null;
  /** The first source's import, the one first run waits for. */
  readonly first: ImportStatus | undefined;
  /** Hashed, probed and with posters (docs/onboarding.md section 2): the clips are in the Library. */
  readonly imported: boolean;
  readonly load: ReturnType<typeof useIndexingStatus>[2];
  readonly controls: ReturnType<typeof useImportActions>;
}

/** Follows the import; the first time the clips are in, its timing event (`onboarding.imported`). */
export function useSourcesImport(): SourcesImport {
  const record = useTelemetry();
  const [status, setStatus, load] = useIndexingStatus();
  const controls = useImportActions(setStatus);
  const first = status?.sources[0];
  const imported = first ? isImported(first) : false;
  const counted = useRef(false);
  useEffect(() => {
    if (!imported || counted.current) return;
    counted.current = true;
    const ms = msSinceStart();
    if (ms !== null) record({ name: 'onboarding.imported', ms });
  }, [imported, record]);
  return { status, first, imported, load, controls };
}

/** The import's own view under the ways in: each source's progress and its controls. */
export function ImportDetails({ flow, sources }: { flow: SourcesImport; sources: readonly SourceView[] }) {
  const { t } = useLingui();
  const { status, load, controls } = flow;
  // The status couldn't be read and no event has brought one: say so, rather than nothing at all.
  if (!status && load.error)
    return (
      <div className="flex flex-col items-start gap-3">
        <ErrorLine error={load.error} />
        <Button size="sm" data-action="retry-status" icon={STEP_ICONS.retry} onClick={load.reload}>
          {t`Try again`}
        </Button>
      </div>
    );
  const imports = status?.sources ?? [];
  if (imports.length === 0) return null;
  return (
    <section
      aria-label={t`Your clips coming in`}
      data-slot="sources-import"
      className="flex flex-col gap-4 border-t border-rule-subtle pt-5"
    >
      {imports.map((each) => {
        const name = sources.find((source) => source.id === each.sourceId)?.name;
        return (
          <ImportProgressView
            key={each.sourceId}
            status={each}
            source={name ? <UserContent translate="no">{name}</UserContent> : t`your footage`}
            pending={controls.pending}
            onPause={controls.act('pause')}
            onResume={controls.act('resume')}
            onRetry={controls.act('retry')}
          />
        );
      })}
      {controls.error ? <ErrorLine error={controls.error} /> : null}
    </section>
  );
}
