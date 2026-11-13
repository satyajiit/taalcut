// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { ImportError } from './import-error';
import { Trans, useLingui } from '@lingui/react/macro';
import { IMPORT_COMMANDS, type ImportSession } from '@taalcut/core';
import {
  AnimatePresence,
  Button,
  DUR,
  EASE_OUT,
  REDUCED_FADE,
  VERB_ICONS,
  motion,
  useReducedMotion,
} from '@taalcut/ui';
import { STAGE_NAMES, SESSION_NAMES, bytes } from './import-words';
import { useImportCommand } from './use-import-command';

export function SessionProgress({
  session,
  reference = false,
}: {
  session: ImportSession;
  reference?: boolean;
}) {
  const { t, i18n } = useLingui();
  const action = useImportCommand();
  const reduce = useReducedMotion();
  const p = session.progress;
  const active = ['running', 'paused', 'interrupted'].includes(session.status);
  const archivedOnly = !active && p.archivedItems > 0 && p.completedItems === 0;
  const stage = archivedOnly
    ? t`Originals saved`
    : reference && session.stage === 'receiving'
      ? t`Scanning and indexing`
      : i18n._(STAGE_NAMES[session.stage]);
  const number = (value: number) => new Intl.NumberFormat(i18n.locale).format(value);
  const done = p.completedItems + p.skippedItems + p.archivedItems;
  const doneCount = number(done);
  const totalCount = p.totalItems === null ? '' : number(p.totalItems);
  const speed = p.bytesPerSecond === null ? '' : bytes(p.bytesPerSecond, i18n.locale);
  const run = (name: string) => void action.run(name, { sessionId: session.id });
  return (
    <section className="flex flex-col gap-4" aria-label={t`Import progress`}>
      <div role="status" aria-atomic className="min-h-7">
        <AnimatePresence initial={false} mode="wait">
          <motion.div
            key={`${session.status}:${session.stage}`}
            className="flex flex-wrap items-center justify-between gap-3"
            initial={{ opacity: 0, y: reduce ? 0 : 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduce ? REDUCED_FADE : DUR.short, ease: EASE_OUT }}
          >
            <h2 className="m-0 type-section">{i18n._(SESSION_NAMES[session.status])}</h2>
            <span className="type-body text-ink-2">{stage}</span>
          </motion.div>
        </AnimatePresence>
      </div>
      {session.status === 'running' ? (
        <progress
          className="h-1.5 w-full accent-primary"
          aria-label={t`Import progress`}
          {...(p.totalBytes && p.totalBytes > 0
            ? { value: p.receivedBytes, max: p.totalBytes }
            : p.totalItems
              ? { value: done, max: p.totalItems }
              : {})}
        />
      ) : null}
      <div className="flex flex-wrap gap-x-6 gap-y-2 type-body tabular-nums">
        <span>
          {p.totalItems === null
            ? t`${doneCount} items finished`
            : t`${doneCount} of ${totalCount} items finished`}
        </span>
        {p.receivedBytes > 0 ? <span>{bytes(p.receivedBytes, i18n.locale)}</span> : null}
        {p.bytesPerSecond !== null && session.status === 'running' ? (
          <span>{t`${speed} per second`}</span>
        ) : null}
        {p.etaSeconds !== null && session.status === 'running' ? (
          <span>
            {new Intl.NumberFormat(i18n.locale, {
              style: 'unit',
              unit: 'minute',
              maximumFractionDigits: 0,
            }).format(Math.ceil(p.etaSeconds / 60))}{' '}
            {t`remaining`}
          </span>
        ) : null}
      </div>
      {p.currentFile ? (
        <p className="m-0 truncate type-meta text-ink-2" translate="no" title={p.currentFile}>
          {p.currentFile}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {session.capabilities.pause && session.status === 'running' ? (
          <Button
            size="sm"
            icon={VERB_ICONS.pause}
            disabled={action.pending}
            onClick={() => run(IMPORT_COMMANDS.pause)}
          >{t`Pause`}</Button>
        ) : null}
        {session.capabilities.resume && ['paused', 'interrupted'].includes(session.status) ? (
          <Button
            size="sm"
            icon={VERB_ICONS.play}
            disabled={action.pending}
            onClick={() => run(IMPORT_COMMANDS.resume)}
          >{t`Resume`}</Button>
        ) : null}
        {session.capabilities.retryFailed && ['failed', 'partial', 'cancelled'].includes(session.status) ? (
          <Button
            size="sm"
            icon={VERB_ICONS.retry}
            disabled={action.pending}
            onClick={() => run(IMPORT_COMMANDS.retryFailed)}
          >{t`Retry unfinished files`}</Button>
        ) : null}
        {session.capabilities.cancel && active ? (
          <Button
            size="sm"
            variant="ghost"
            icon={VERB_ICONS.stop}
            disabled={action.pending}
            onClick={() => run(IMPORT_COMMANDS.cancel)}
          >{t`Cancel import`}</Button>
        ) : null}
      </div>
      {action.error ? <ImportError error={action.error} /> : null}
      {['paused', 'interrupted', 'partial', 'failed'].includes(session.status) &&
      !session.capabilities.byteResume ? (
        <p className="m-0 type-body text-ink-2">
          <Trans>
            Completed files are kept. Retrying starts the unfinished file again from its beginning.
          </Trans>
        </p>
      ) : null}
      <p className="m-0 type-meta text-ink-2">
        {session.safeToDisconnect
          ? t`All selected originals have been saved and Taalcut has finished reading this source. It is safe to disconnect.`
          : t`Keep the source connected while Taalcut reads and checks your footage.`}
      </p>
    </section>
  );
}
