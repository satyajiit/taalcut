// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What a stored profile looks like to the renderer and the agent (LRN1-STY): the record with its set's name and its
 * exemplars' names and contact sheets (read from the template store, so a renamed template shows its new name),
 * and the exemplars' sheets as images for the summary's model.
 */
import { readFile } from 'node:fs/promises';
import type {
  StyleExemplar,
  StyleProfileRecord,
  StyleProfileView,
  TemplateRef,
  TemplateStore,
} from '@taalcut/core';
import type { SummaryImage } from './summary';

type Templates = Pick<TemplateStore, 'get' | 'assetPath'>;

/** The exemplar's card facts at the version profiled; null when the template is gone since. */
async function exemplarOf(templates: Templates, ref: TemplateRef): Promise<StyleExemplar | null> {
  const stored = await templates.get(ref.id, ref.version);
  if (!stored.ok) return null;
  const { summary } = stored.value;
  return {
    templateId: ref.id,
    version: ref.version,
    name: summary.name,
    contactSheet: summary.contactSheet,
    duration: summary.duration,
    slotCount: summary.slotCount,
  };
}

export async function viewOf(
  templates: Templates,
  record: StyleProfileRecord,
  name: string | null,
): Promise<StyleProfileView> {
  const exemplars = await Promise.all(
    (record.profile?.exemplars ?? []).map((ref) => exemplarOf(templates, ref)),
  );
  return {
    source: record.source,
    name,
    profile: record.profile,
    summary: record.summary,
    exemplars: exemplars.flatMap((exemplar) => (exemplar ? [exemplar] : [])),
    builtAt: record.profile ? record.builtAt : null,
  };
}

/** The exemplars' contact sheets as base64 images; a sheet that can't be read is left out (and logged). */
export async function readSheets(
  templates: Templates,
  exemplars: readonly TemplateRef[],
  log?: (line: string) => void,
): Promise<SummaryImage[]> {
  const sheets: SummaryImage[] = [];
  for (const ref of exemplars) {
    const stored = await templates.get(ref.id, ref.version);
    const sheet = stored.ok ? stored.value.summary.contactSheet : null;
    if (!sheet) continue;
    const path = await templates.assetPath(sheet.asset);
    if (!path.ok) {
      log?.(`style profile: contact sheet of ${ref.id} unavailable (${path.error.code})`);
      continue;
    }
    const bytes = await readFile(path.value).then(
      (data) => data,
      (error: unknown) => {
        log?.(`style profile: contact sheet of ${ref.id} unreadable (${String(error)})`);
        return null;
      },
    );
    if (bytes) sheets.push({ data: bytes.toString('base64'), mimeType: sheet.mediaType });
  }
  return sheets;
}
