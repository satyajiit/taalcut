// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: template import (button and drop zone) · genre: atmospheric studio app (chrome modern-minimal) · system: DESIGN.md v0.3
 * Import… opens the file picker for .taalcut-template files; dropping files anywhere on the library does the same.
 *   While files are dragged over, the library dims under a raised panel that says what a drop does (a solid
 *   marigold edge, not a dashed box). The toast says how many came in and names any file that didn't, with Undo.
 * states: button default · hover · focus-visible (base ring) · active (pressed) · disabled n/a · loading (spinner
 *   while reading and importing) · error (toast with the cause or the refused files) · success (toast with Undo);
 *   drop zone idle · dragging over (panel, fade) · dropped (the button's loading)
 * pre-emit critique: P5 H5 E4 S5 R4 V4
 */
import { Plural, Trans, useLingui } from '@lingui/react/macro';
import { callRpc, newId, TEMPLATE_COMMANDS, TEMPLATE_FILE_EXTENSION } from '@taalcut/core';
import {
  AnimatePresence,
  Button,
  DUR,
  EASE_OUT,
  motion,
  REDUCED_FADE,
  toast,
  useReducedMotion,
  UserContent,
  VERB_ICONS,
} from '@taalcut/ui';
import { FileUp } from 'lucide-react';
import { useCallback, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { useBackend } from '../../../backend/backend';
import {
  importTemplateFiles,
  type ImportFile,
  type ImportOutcome,
  type RefusedReason,
} from './import-templates';
import { libraryErrorText } from './library-words';
import { useLibraryCommands } from './use-library-commands';

const MAX_NAMED = 3;

export function RefusedLine({ name, reason }: { name: string; reason: RefusedReason }) {
  const file = <UserContent translate="no">{name}</UserContent>;
  switch (reason) {
    case 'notTemplate':
      return <Trans>{file} isn’t a .taalcut-template file.</Trans>;
    case 'tooLarge':
      return <Trans>{file} is larger than a template file can be.</Trans>;
    case 'unreadable':
      return <Trans>{file} couldn’t be opened.</Trans>;
    case 'invalid':
      return <Trans>{file} isn’t a template Taalcut can read.</Trans>;
  }
}

/**
 * Reads, imports and reports a set of files; `pending` while it runs. A page that shows its own failure (New's Kaatu
 * moment) passes `failures: 'page'`: an import that brought nothing in is then `failed`, not a toast.
 */
export function useImportTemplates({ failures = 'toast' }: { failures?: 'toast' | 'page' } = {}) {
  const backend = useBackend();
  const { t, i18n } = useLingui();
  const commands = useLibraryCommands();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState<ImportOutcome | null>(null);

  const report = useCallback(
    (outcome: ImportOutcome) => {
      if (failures === 'page' && (outcome.error || outcome.imported.length === 0)) {
        setFailed(outcome);
        return;
      }
      setFailed(null);
      const named = outcome.refused.slice(0, MAX_NAMED);
      const rest = outcome.refused.length - named.length;
      const refused =
        named.length > 0 ? (
          <span className="flex flex-col gap-0.5">
            {named.map((item) => (
              <span key={item.name}>
                <RefusedLine name={item.name} reason={item.reason} />
              </span>
            ))}
            {rest > 0 ? <Plural value={rest} one="And # more file." other="And # more files." /> : null}
          </span>
        ) : undefined;
      if (outcome.error) {
        toast({
          tone: 'danger',
          title: t`Couldn’t import the templates`,
          description: libraryErrorText(i18n, outcome.error),
        });
        return;
      }
      const count = outcome.imported.length;
      toast({
        tone: count === 0 ? 'danger' : outcome.refused.length > 0 ? 'warning' : undefined,
        title:
          count === 0 ? (
            t`Nothing was imported`
          ) : (
            <Plural value={count} one="Imported # template" other="Imported # templates" />
          ),
        ...(refused ? { description: refused } : {}),
        ...(count > 0
          ? { action: { label: t`Undo`, onSelect: () => void commands.undo(outcome.steps) } }
          : {}),
      });
    },
    [t, i18n, commands, failures],
  );

  const importFiles = useCallback(
    async (files: readonly ImportFile[]) => {
      if (files.length === 0) return;
      setPending(true);
      try {
        const outcome = await importTemplateFiles(files, (items) =>
          callRpc(
            backend.commands.dispatch({
              name: TEMPLATE_COMMANDS.import,
              payload: { projectId: null, items },
              source: 'ui',
              idempotencyKey: newId(),
            }),
          ),
        );
        report(outcome);
      } finally {
        setPending(false);
      }
    },
    [backend, report],
  );

  return { importFiles, pending, failed, clearFailed: useCallback(() => setFailed(null), []) };
}

export function ImportButton({ onFiles, pending }: { onFiles: (files: File[]) => void; pending: boolean }) {
  const { t } = useLingui();
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <Button size="sm" icon={VERB_ICONS.import} loading={pending} onClick={() => input.current?.click()}>
        {pending ? t`Importing` : t`Import…`}
      </Button>
      <input
        ref={input}
        type="file"
        multiple
        accept={`.${TEMPLATE_FILE_EXTENSION}`}
        tabIndex={-1}
        aria-hidden
        className="hidden"
        data-slot="template-import-input"
        onChange={(event) => {
          onFiles([...(event.target.files ?? [])]);
          event.target.value = '';
        }}
      />
    </>
  );
}

// eslint-disable-next-line lingui/no-unlocalized-strings -- the DOM's drag type for files, not words
const hasFiles = (event: DragEvent) => [...event.dataTransfer.types].includes('Files');

/** The library, accepting dropped files: a raised panel says what a drop does while files are over it. */
export function ImportDropZone({
  onFiles,
  children,
}: {
  onFiles: (files: File[]) => void;
  children: ReactNode;
}) {
  const { t } = useLingui();
  const reduced = useReducedMotion();
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  return (
    <div
      className="relative"
      data-slot="template-drop-zone"
      onDragEnter={(event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        depth.current += 1;
        setOver(true);
      }}
      onDragOver={(event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
      }}
      onDragLeave={() => {
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setOver(false);
      }}
      onDrop={(event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        depth.current = 0;
        setOver(false);
        onFiles([...event.dataTransfer.files]);
      }}
    >
      {children}
      <AnimatePresence>
        {over ? (
          <motion.div
            key="drop"
            aria-hidden
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduced ? REDUCED_FADE : DUR.micro, ease: EASE_OUT }}
            className="pointer-events-none absolute inset-0 z-20 flex items-start justify-center rounded-xl bg-canvas/85 pt-24"
          >
            <span className="flex items-center gap-3 rounded-xl border border-primary-strong bg-raised px-5 py-4 text-md font-medium text-ink">
              <FileUp aria-hidden className="size-5 text-primary-strong" />
              {t`Drop template files to import them`}
            </span>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
