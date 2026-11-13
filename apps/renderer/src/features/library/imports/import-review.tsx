// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { ImportError } from './import-error';
import { Trans, useLingui } from '@lingui/react/macro';
import {
  IMPORT_COMMANDS,
  type ImportDraft,
  type ImportDraftId,
  type ImportMethod,
  type ImportSessionId,
} from '@taalcut/core';
import { Button, Checkbox, cn } from '@taalcut/ui';
import { Link, useNavigate } from '@tanstack/react-router';
import { useBackend } from '../../../backend/backend';
import { useRpcQuery } from '../../../backend/use-rpc';
import { DraftFrame, ImportLoading, useDraft } from './draft-state';
import { bytes, IMPORT_WARNINGS } from './import-words';
import { useImportCommand } from './use-import-command';

export function ImportReviewContent({
  method,
  draftId,
  onStarted,
  onDiscarded,
  onChoose,
}: {
  method: ImportMethod;
  draftId: ImportDraftId;
  onStarted?: (sessionId: ImportSessionId) => void;
  onDiscarded?: () => void;
  onChoose?: () => void;
}) {
  const { t, i18n } = useLingui();
  const backend = useBackend();
  const navigate = useNavigate();
  const state = useDraft(draftId);
  const draft = state.data;
  const action = useImportCommand();
  const review = useRpcQuery(
    (signal) => backend.imports.preflight({ draftId }, { signal }),
    [backend, draftId, draft?.updatedAt],
  );
  const privacy = useRpcQuery((signal) => backend.privacy.overview(undefined, { signal }), [backend]);
  const value = review.data;
  const freeSpace = value?.availableBytes == null ? '' : bytes(value.availableBytes, i18n.locale);
  const update = async (patch: Partial<ImportDraft>) => {
    if (await state.update(patch)) review.reload();
  };
  const start = async () => {
    const result = await action.run<{ sessionId: ImportSessionId }>(IMPORT_COMMANDS.start, { draftId });
    if (result) {
      if (onStarted) onStarted(result.sessionId);
      else await navigate({ to: '/library/imports/$sessionId', params: result });
    }
  };
  const discard = async () => {
    const result = await action.run(IMPORT_COMMANDS.discardDraft, { draftId });
    if (result) {
      if (onDiscarded) onDiscarded();
      else await navigate({ to: '/library/import', replace: true });
    }
  };
  const number = (count: number) => new Intl.NumberFormat(i18n.locale).format(count);
  if (!draft) return <ImportLoading />;
  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_19rem] xl:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="flex min-w-0 flex-col gap-4">
        <section className="flex flex-col gap-3 rounded-xl border border-rule-subtle bg-well p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="m-0 type-section">{t`Footage`}</h2>
              <p className="m-0 mt-0.5 truncate type-meta text-ink-2" translate="no">
                {draft.sourceLabel}
              </p>
            </div>
            {method !== 'files' && !draft.watch ? (
              onChoose ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={onChoose}
                >{t`Change selection`}</Button>
              ) : (
                <Button asChild variant="secondary" size="sm">
                  <Link
                    to="/library/import/$method/$draftId/choose"
                    params={{ method, draftId }}
                  >{t`Change selection`}</Link>
                </Button>
              )
            ) : null}
          </div>
          {value ? (
            <dl className="m-0 grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 border-t border-rule-subtle pt-3 type-body">
              <dt className="text-ink-2">{t`Selected files`}</dt>
              <dd className="m-0 font-medium tabular-nums">{number(value.selectedItems)}</dd>
              <dt className="text-ink-2">{t`Captures`}</dt>
              <dd className="m-0 font-medium tabular-nums">{number(value.selectedCaptures)}</dd>
              <dt className="text-ink-2">{t`Known size`}</dt>
              <dd className="m-0 font-medium tabular-nums">{bytes(value.knownBytes, i18n.locale)}</dd>
              {value.unknownSizeItems > 0 ? (
                <>
                  <dt className="text-ink-2">{t`Files with unknown size`}</dt>
                  <dd className="m-0 font-medium tabular-nums">{number(value.unknownSizeItems)}</dd>
                </>
              ) : null}
              <dt className="text-ink-2">{t`Exact duplicate candidates`}</dt>
              <dd className="m-0 font-medium tabular-nums">{number(value.duplicateItems)}</dd>
            </dl>
          ) : review.status === 'loading' ? (
            <ImportLoading />
          ) : null}
        </section>

        <section className="flex flex-col gap-3.5 rounded-xl border border-rule-subtle bg-well p-4">
          <h2 className="m-0 type-section">{t`How to keep your footage`}</h2>
          {method === 'files' || method === 'folder' ? (
            <fieldset
              className="m-0 flex flex-col gap-2.5 border-0 p-0"
              disabled={state.pending || draft.watch}
            >
              <legend className="sr-only">{t`Storage`}</legend>
              <label
                className={cn(
                  'flex cursor-pointer items-start gap-3 rounded-lg border p-3 type-body transition-colors duration-(--dur-micro)',
                  draft.storage === 'copy'
                    ? 'border-rule-strong bg-selected'
                    : 'border-rule-subtle bg-canvas hover:bg-hover',
                )}
              >
                <input
                  type="radio"
                  name="storage"
                  className="mt-1 accent-primary-strong"
                  checked={draft.storage === 'copy'}
                  onChange={() => void update({ storage: 'copy' })}
                />
                <span>
                  <Trans>Copy into Taalcut</Trans>
                  <span className="mt-0.5 block type-meta text-ink-2">
                    <Trans>Recommended. Your originals stay where they are.</Trans>
                  </span>
                </span>
              </label>
              <label
                className={cn(
                  'flex cursor-pointer items-start gap-3 rounded-lg border p-3 type-body transition-colors duration-(--dur-micro)',
                  draft.storage === 'reference'
                    ? 'border-rule-strong bg-selected'
                    : 'border-rule-subtle bg-canvas hover:bg-hover',
                )}
              >
                <input
                  type="radio"
                  name="storage"
                  className="mt-1 accent-primary-strong"
                  checked={draft.storage === 'reference'}
                  onChange={() => void update({ storage: 'reference' })}
                />
                <span>
                  <Trans>Keep in place</Trans>
                  <span className="mt-0.5 block type-meta text-ink-2">
                    <Trans>Use stable local storage. Keep the files and drive available to edit.</Trans>
                  </span>
                </span>
              </label>
            </fieldset>
          ) : (
            <p className="m-0 type-body text-ink-2">
              <Trans>Originals are copied into Taalcut. Nothing is deleted from your source.</Trans>
            </p>
          )}
          <div className="flex flex-col gap-2.5 border-t border-rule-subtle pt-3">
            {method === 'folder' ? (
              <>
                <label className="flex cursor-pointer items-center gap-3 type-body">
                  <Checkbox
                    checked={draft.recursive}
                    disabled={state.pending}
                    onCheckedChange={(value) => void update({ recursive: value === true })}
                  />
                  {t`Include subfolders`}
                </label>
                <label className="flex cursor-pointer items-center gap-3 type-body">
                  <Checkbox
                    checked={draft.watch}
                    disabled={state.pending}
                    onCheckedChange={(value) =>
                      void update({
                        watch: value === true,
                        ...(value === true ? { storage: 'reference', selectAll: true } : {}),
                      })
                    }
                  />
                  {t`Watch for new footage`}
                </label>
              </>
            ) : null}
            <label className="flex cursor-pointer items-center gap-3 type-body">
              <Checkbox
                checked={draft.onlyNew}
                disabled={state.pending}
                onCheckedChange={(value) => void update({ onlyNew: value === true })}
              />
              {t`Only new footage`}
            </label>
          </div>
        </section>

        {method === 'photos' ? (
          <section className="flex flex-col gap-3 rounded-xl border border-rule-subtle bg-well p-4">
            <h2 className="m-0 type-section">{t`Apple Photos originals`}</h2>
            <p className="m-0 max-w-prose type-body text-ink-2">
              <Trans>
                Photos edits are not included. Photos metadata is kept separately from the original file.
              </Trans>
            </p>
            <label className="flex cursor-pointer items-start gap-3 type-body">
              <Checkbox
                checked={draft.allowNetwork}
                disabled={state.pending || privacy.status !== 'ready' || privacy.data?.localOnly === true}
                onCheckedChange={(value) => void update({ allowNetwork: value === true })}
              />
              {t`Download selected originals from iCloud`}
            </label>
            {privacy.data?.localOnly ? (
              <p className="m-0 type-meta text-ink-2">{t`Local only mode prevents iCloud downloads.`}</p>
            ) : null}
          </section>
        ) : null}
        {value?.unsupportedItems ? (
          <p role="status" className="m-0 rounded-lg bg-warning-soft p-4 type-body text-warning-strong">
            <Trans>
              Some files cannot be edited directly. Supported camera originals are saved as archived captures
              and do not count as usable clips.
            </Trans>
          </p>
        ) : null}
        {value?.missingRequired.length ? (
          <section className="rounded-lg bg-warning-soft p-4 text-warning-strong">
            <h2 className="m-0 type-card-title">{t`Required originals are missing`}</h2>
            <p className="type-body">{t`Reconnect the source with every lens file and segment, then choose it again. Incomplete captures cannot be marked ready to edit.`}</p>
            <ul className="m-0 pl-5 type-body">
              {value.missingRequired.map((name) => (
                <li key={name} translate="no" className="break-all">
                  {name}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {value?.warnings.length ? (
          <ul className="m-0 flex flex-col gap-2 pl-5 type-body text-warning-strong">
            {value.warnings.map((warning) => (
              <li key={warning}>
                {IMPORT_WARNINGS[warning]
                  ? i18n._(IMPORT_WARNINGS[warning])
                  : t`This source needs attention. Review its connection and required originals before importing.`}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <aside
        aria-label={t`Import summary`}
        className="sticky bottom-0 flex max-h-[45dvh] flex-col gap-3 overflow-auto rounded-xl border border-rule-subtle bg-panel p-3.5 lg:top-4 lg:max-h-none lg:gap-4 lg:p-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 lg:flex-col lg:items-start">
          <h2 className="m-0 type-card-title">{t`Destination`}</h2>
          <p className="m-0 break-words type-body" translate="no">
            {value?.destinationLabel ?? draft.destinationLabel}
          </p>
          <p className="m-0 type-meta text-ink-2 tabular-nums">
            {value?.availableBytes == null
              ? t`Available space will be checked before and during import.`
              : t`${freeSpace} available`}
          </p>
        </div>
        <p className="m-0 hidden type-meta text-ink-2 lg:block">
          <Trans>Files and free space are checked again when you start. Exact duplicates are skipped.</Trans>
        </p>
        {review.error ? <ImportError error={review.error} onRetry={review.reload} /> : null}
        {state.writeError ? <ImportError error={state.writeError} /> : null}
        {action.error ? (
          <ImportError
            error={action.error}
            onRetry={() => {
              review.reload();
            }}
          />
        ) : null}
        {value && !value.canStart ? (
          <p
            role="status"
            className="m-0 type-body text-warning-strong"
          >{t`Resolve the review issues or choose footage before starting.`}</p>
        ) : null}
        <div className="flex flex-wrap gap-2 lg:flex-col">
          <Button
            className="flex-1"
            variant="primary"
            loading={action.pending}
            data-action="start-import"
            disabled={state.pending || review.status !== 'ready' || review.refreshing || !value?.canStart}
            onClick={() => void start()}
          >
            {draft.watch ? t`Start watching` : t`Import footage`}
          </Button>
          <Button
            variant="ghost"
            disabled={action.pending}
            onClick={() => void discard()}
          >{t`Discard draft`}</Button>
        </div>
      </aside>
    </div>
  );
}
export function ImportReview({ method, draftId }: { method: ImportMethod; draftId: ImportDraftId }) {
  const { t } = useLingui();
  return (
    <DraftFrame method={method} draftId={draftId} step={t`Review`}>
      {() => <ImportReviewContent method={method} draftId={draftId} />}
    </DraftFrame>
  );
}
