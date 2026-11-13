// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A `.taalcut-template` file is a Hub template v0 document (P3-V14): the same checks as a hub
 * submission, structure only. Export is pretty and key-sorted so two exports of one template match.
 */
import {
  err,
  hubContentProblems,
  hubTagSchema,
  hubTemplateV0Schema,
  HUB_MAX_BYTES,
  NotFoundError,
  ok,
  TEMPLATE_FILE_EXTENSION,
  ValidationError,
  type HubShareForm,
  type HubTemplateId,
  type HubTemplateV0,
  type Result,
  type StyleStore,
  type TemplateDocumentInput,
  type TemplateStore,
} from '@taalcut/core';
import { StyleNotFound } from '../errors';
import { toHubTemplate } from '../hub/to-hub';
import { migrateTemplate } from '../schema/migrations';

export interface TemplateFileDeps {
  readonly store: TemplateStore;
  readonly styles: StyleStore;
  readonly ids: { hub(): HubTemplateId };
}

export interface FileProblem {
  readonly path: string;
  readonly rule: string;
}

export type FileRead =
  | { readonly ok: true; readonly doc: HubTemplateV0 }
  | { readonly ok: false; readonly problems: readonly FileProblem[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (!isRecord(value)) return value;
  const entries = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return Object.fromEntries(entries.map(([key, item]) => [key, sortKeys(item)]));
}

/** Stable pretty JSON, trailing newline. */
export function stableTemplateJson(value: unknown): string {
  return `${JSON.stringify(sortKeys(value), null, 2)}\n`;
}

export function templateFileName(name: string): string {
  const slug = name
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 60);
  return `${slug.length > 0 ? slug : 'template'}.${TEMPLATE_FILE_EXTENSION}`;
}

function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

/** Schema and content rules. A failure names problems; it does not import. */
export function inspectTemplateFile(text: string): FileRead {
  if (utf8Bytes(text) > HUB_MAX_BYTES) return { ok: false, problems: [{ path: '', rule: 'tooLarge' }] };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    // Not JSON: the one problem a file that doesn't parse can have.
    return { ok: false, problems: [{ path: '', rule: 'schema' }] };
  }
  return inspectTemplateDocument(raw);
}

/** The same checks on a document already parsed (a bundled starter): size as it serialises, rules, schema. */
export function inspectTemplateDocument(raw: unknown): FileRead {
  const problems = hubContentProblems(raw);
  if (problems.length > 0) return { ok: false, problems };
  const parsed = hubTemplateV0Schema.safeParse(raw);
  return parsed.success
    ? { ok: true, doc: parsed.data }
    : { ok: false, problems: [{ path: '', rule: 'schema' }] };
}

export async function exportTemplateDocument(
  deps: TemplateFileDeps,
  input: TemplateDocumentInput,
): Promise<Result<{ readonly fileName: string; readonly text: string }>> {
  const stored = await deps.store.get(input.templateId, input.version);
  if (!stored.ok) return stored;
  const template = migrateTemplate(stored.value.json, stored.value.schemaVersion);
  if (!template.ok) return template;
  const summary = stored.value.summary;
  const styleId = template.value.styleId;
  const style = input.includeStyle && styleId ? await deps.styles.get(styleId) : ok(null);
  if (!style.ok) return NotFoundError.is(style.error) ? err(StyleNotFound()) : style;
  const provenance = summary.provenance?.kind === 'hub' ? summary.provenance : null;
  const hubId = provenance?.hubId ?? deps.ids.hub();
  const form: HubShareForm = {
    name: summary.name.slice(0, 80),
    description: '',
    handle: 'taalcut',
    tags: summary.tags.filter((tag) => hubTagSchema.safeParse(tag).success).slice(0, 8),
    language: summary.language,
    includeStyle: input.includeStyle,
  };
  const doc = toHubTemplate(
    template.value,
    {
      name: summary.name,
      hubId,
      version: provenance?.version ?? 1,
      provenance: provenance ? { kind: 'hub', hubId: provenance.hubId, version: provenance.version } : null,
    },
    form,
    style.value,
  );
  if (!doc.ok) return doc;
  const text = stableTemplateJson(doc.value);
  if (utf8Bytes(text) > HUB_MAX_BYTES)
    return err(ValidationError({ field: 'text' }, { detail: 'The template file exceeds 128 KiB' }));
  return ok({ fileName: templateFileName(summary.name), text });
}
