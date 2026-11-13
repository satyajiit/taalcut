// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: export section "For another editor" · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.3 · the cut as a project file for DaVinci Resolve or Premiere Pro (.otio) and Final Cut
 *   Pro 12 (.fcpxml), one hairline row each: "Write the file" (timeline.exportInterchange, into Taalcut's exports
 *   folder), then what the other editor won't get exactly, in words, and Save as… (main's save panel,
 *   files.saveExportAs); one quiet line names the copy.
 * states: loading (bone rows) · formats didn't load (the cause, Try again) · default · hover/focus/active (the
 *   buttons) · disabled (while the export starts) · writing (the button spins) · written (the file's name, its
 *   warnings or "Nothing lost on the way", Save as…) · saving (Save as… spins; a cancelled panel says nothing) ·
 *   saved (one quiet line with the copy's name) · error (the cause in one line under its row)
 * pre-emit critique: P5 H5 E4 S5 R5 V4
 */
import { Trans, useLingui } from '@lingui/react/macro';
import {
  fromRpcError,
  interchangeExportResultSchema,
  TIMELINE_COMMANDS,
  type InterchangeExportResult,
  type InterchangeFormatInfo,
  type TaalcutError,
} from '@taalcut/core';
import { Button, ErrorLine, ProviderLogo } from '@taalcut/ui';
import { CircleCheck, FileDown } from 'lucide-react';
import { useState } from 'react';
import { useBackend } from '../../../backend/backend';
import { useRpcQuery } from '../../../backend/use-rpc';
import { formatLabel, warningLines } from './export-words';
import { SectionFrame, SectionNote } from './section-frame';
import type { ExportSection, SectionProps } from './types';

type Step =
  | { readonly state: 'idle' | 'writing' }
  | {
      readonly state: 'written' | 'saving';
      readonly file: InterchangeExportResult;
      readonly savedAs?: string;
    };

function FormatRow({ format, props }: { format: InterchangeFormatInfo; props: SectionProps }) {
  const { t, i18n } = useLingui();
  const backend = useBackend();
  const { context, dispatch, disabled } = props;
  const [step, setStep] = useState<Step>({ state: 'idle' });
  const [error, setError] = useState<TaalcutError | null>(null);

  const write = async () => {
    setStep({ state: 'writing' });
    setError(null);
    const result = await dispatch(TIMELINE_COMMANDS.exportInterchange, {
      projectId: context.projectId,
      timelineId: context.timelineId,
      revision: context.timeline.revision,
      format: format.id,
    });
    const receipt = result.ok ? (result.value as { result?: unknown }) : null;
    const file = interchangeExportResultSchema.safeParse(receipt?.result);
    if (!result.ok) setError(result.error);
    setStep(file.success ? { state: 'written', file: file.data } : { state: 'idle' });
  };
  const saveAs = async (file: InterchangeExportResult) => {
    setStep({ state: 'saving', file });
    setError(null);
    try {
      const saved = await backend.files.saveExportAs({ fileName: file.fileName });
      setStep({
        state: 'written',
        file,
        ...(saved.saved && saved.fileName ? { savedAs: saved.fileName } : {}),
      });
    } catch (cause) {
      setError(fromRpcError(cause));
      setStep({ state: 'written', file });
    }
  };

  const written = step.state === 'written' || step.state === 'saving' ? step.file : null;
  const lines = written ? warningLines(i18n, written.warnings) : [];
  const fileName = written?.fileName ?? '';
  const savedAs = step.state === 'written' ? (step.savedAs ?? null) : null;
  return (
    <li
      data-format={format.id}
      className="flex flex-col gap-2 border-b border-rule-subtle py-2.5 last:border-b-0"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex items-center gap-2 type-body text-ink">
          <ProviderLogo
            provider={format.id === 'fcpxml' ? 'finalcut' : 'davinci'}
            size="xs"
            framed={false}
            aria-hidden
          />
          {formatLabel(i18n, format)}
        </span>
        {written ? (
          <Button
            size="sm"
            variant="secondary"
            disabled={disabled}
            loading={step.state === 'saving'}
            onClick={() => void saveAs(written)}
          >
            <FileDown aria-hidden />
            {t`Save as…`}
          </Button>
        ) : (
          <Button
            size="sm"
            variant="secondary"
            disabled={disabled}
            loading={step.state === 'writing'}
            onClick={() => void write()}
          >
            {t`Write the file`}
          </Button>
        )}
      </div>
      {written ? (
        <div className="flex flex-col gap-1.5" data-slot="interchange-written">
          <p role="status" className="m-0 flex items-center gap-1.5 type-meta text-ink-2">
            <CircleCheck aria-hidden className="size-3.5 shrink-0 text-success-strong" />
            <span className="min-w-0 break-all">
              {savedAs ? (
                <Trans>
                  Saved a copy as <span translate="no">{savedAs}</span>
                </Trans>
              ) : (
                <Trans>
                  Wrote <span translate="no">{fileName}</span> in Taalcut’s exports folder.
                </Trans>
              )}
            </span>
          </p>
          {lines.length > 0 ? (
            <ul
              aria-label={t`What the other editor won’t get exactly`}
              className="m-0 flex list-disc flex-col gap-0.5 ps-5 type-meta text-ink-2"
            >
              {lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : (
            <SectionNote>{t`Every cut comes through as it is.`}</SectionNote>
          )}
        </div>
      ) : null}
      {error ? <ErrorLine error={error} /> : null}
    </li>
  );
}

function OtherEditors(props: SectionProps) {
  const { t } = useLingui();
  const backend = useBackend();
  const formats = useRpcQuery(
    (signal) => backend.timelines.interchangeFormats(undefined, { signal }),
    [backend],
  );
  return (
    <SectionFrame id="otherEditors" title={t`For another editor`}>
      <SectionNote>{t`The cut as a project file, linked to your originals: every clip and cut, text as markers.`}</SectionNote>
      {formats.error && !formats.data ? (
        <ErrorLine error={formats.error} onRetry={formats.reload} />
      ) : !formats.data ? (
        <div aria-busy="true" aria-label={t`Loading the file types`} className="flex flex-col gap-2">
          <span aria-hidden className="tc-bone block h-8 w-full rounded-md bg-hover" />
          <span aria-hidden className="tc-bone block h-8 w-full rounded-md bg-hover" />
        </div>
      ) : (
        <ul className="m-0 flex list-none flex-col p-0">
          {formats.data.map((format) => (
            <FormatRow key={format.id} format={format} props={props} />
          ))}
        </ul>
      )}
    </SectionFrame>
  );
}

export const otherEditorsSection: ExportSection = {
  id: 'otherEditors',
  available: () => true,
  Component: OtherEditors,
};
