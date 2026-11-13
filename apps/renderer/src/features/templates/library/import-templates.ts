// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Importing `.taalcut-template` files (P3-V14): each read with the File API and sent as text in template.import,
 * up to fifty a command. The service imports all of a command's files or none and names the first bad one
 * (`templates.import_invalid`, its index), so a bad file is set aside and the rest sent again: the person gets every
 * good template and the names of the files that weren't, and each command is one undo step.
 */
import {
  HUB_MAX_BYTES,
  newId,
  TEMPLATE_FILE_EXTENSION,
  type Result,
  type TaalcutError,
  type TemplateId,
} from '@taalcut/core';

export interface ImportFile {
  readonly name: string;
  readonly size: number;
  text(): Promise<string>;
}

export type RefusedReason = 'notTemplate' | 'tooLarge' | 'unreadable' | 'invalid';

export interface ImportOutcome {
  readonly imported: readonly TemplateId[];
  readonly refused: readonly { readonly name: string; readonly reason: RefusedReason }[];
  /** Commands that imported something: the undo steps. */
  readonly steps: number;
  /** A failure that wasn't one file's fault (the rest weren't sent). */
  readonly error: TaalcutError | null;
}

export type ImportItems = readonly { readonly templateId: TemplateId; readonly text: string }[];
export type ImportDispatch = (items: ImportItems) => Promise<Result<unknown>>;

/** The contract's most files per template.import. */
export const IMPORT_BATCH = 50;
const SUFFIX = `.${TEMPLATE_FILE_EXTENSION}`;

const fileIndex = (error: TaalcutError): number | null => {
  const file = error.params?.['file'];
  return error.code === 'templates.import_invalid' && typeof file === 'number' ? file : null;
};

export async function importTemplateFiles(
  files: readonly ImportFile[],
  dispatch: ImportDispatch,
): Promise<ImportOutcome> {
  const refused: { name: string; reason: RefusedReason }[] = [];
  const ready: { name: string; templateId: TemplateId; text: string }[] = [];
  for (const file of files) {
    if (!file.name.toLowerCase().endsWith(SUFFIX)) refused.push({ name: file.name, reason: 'notTemplate' });
    else if (file.size > HUB_MAX_BYTES) refused.push({ name: file.name, reason: 'tooLarge' });
    else {
      try {
        const text = await file.text();
        if (text.length < 2) refused.push({ name: file.name, reason: 'invalid' });
        else ready.push({ name: file.name, templateId: newId<'Template'>(), text });
      } catch {
        // The file went away or can't be read: say so, import the rest.
        refused.push({ name: file.name, reason: 'unreadable' });
      }
    }
  }

  const imported: TemplateId[] = [];
  let steps = 0;
  for (let start = 0; start < ready.length; start += IMPORT_BATCH) {
    let batch = ready.slice(start, start + IMPORT_BATCH);
    while (batch.length > 0) {
      const done = await dispatch(batch.map(({ templateId, text }) => ({ templateId, text })));
      if (done.ok) {
        imported.push(...batch.map((item) => item.templateId));
        steps += 1;
        break;
      }
      const bad = fileIndex(done.error);
      const file = bad === null ? undefined : batch[bad];
      if (!file) return { imported, refused, steps, error: done.error };
      refused.push({ name: file.name, reason: 'invalid' });
      batch = batch.filter((item) => item !== file);
    }
  }
  return { imported, refused, steps, error: null };
}
