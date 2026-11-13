// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A `.taalcut-template` file as the templates service reads and writes it (P3-V14; packages/templates
 * library/template-file.ts, hub/to-hub.ts, hub/from-hub.ts): a Hub template v0 document, structure only. Reading
 * runs the hub's size, content and schema checks; a fork gets new ids, a manual origin, user intents and
 * placeholder words. Writing builds every object from the hub schema's fields (strict all the way down), sorted
 * and pretty, so two exports of one template match.
 */
import {
  hubContentProblems,
  hubTagSchema,
  hubTemplateV0Schema,
  HUB_FORMAT,
  HUB_FORMAT_VERSION,
  HUB_MAX_BYTES,
  TEMPLATE_FILE_EXTENSION,
  type HubTemplateId,
  type HubTemplateV0,
  type Template,
  type TemplateId,
  type TemplateSummary,
} from '@taalcut/core';
import { fromHubTemplate, hubStructure } from '../phase3/hub/hub-convert';

export interface FileProblem {
  readonly path: string;
  readonly rule: string;
}

export type FileRead =
  | { readonly ok: true; readonly doc: HubTemplateV0 }
  | { readonly ok: false; readonly problems: readonly FileProblem[] };

const utf8Bytes = (text: string) => new TextEncoder().encode(text).byteLength;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (!isRecord(value)) return value;
  const entries = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return Object.fromEntries(entries.map(([key, item]) => [key, sortKeys(item)]));
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

/** Size, then JSON, then the hub's content rules and schema. A failure names its problems. */
export function inspectTemplateFile(text: string): FileRead {
  if (utf8Bytes(text) > HUB_MAX_BYTES) return { ok: false, problems: [{ path: '', rule: 'tooLarge' }] };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    // Not JSON: the one problem a file that doesn't parse can have.
    return { ok: false, problems: [{ path: '', rule: 'schema' }] };
  }
  const problems = hubContentProblems(raw);
  if (problems.length > 0) return { ok: false, problems };
  const parsed = hubTemplateV0Schema.safeParse(raw);
  return parsed.success
    ? { ok: true, doc: parsed.data }
    : { ok: false, problems: [{ path: '', rule: 'schema' }] };
}

/** A local template from a file's document, or null when it breaks a Template invariant (`hub.invalid`). */
export function fromHubDocument(doc: HubTemplateV0, templateId: TemplateId, now: number): Template | null {
  const made = fromHubTemplate(doc, templateId, now);
  return made.ok ? made.value : null;
}

/** The file's text, or null when the document fails the hub schema or the size limit. */
export function templateFileText(
  template: Template,
  summary: TemplateSummary,
  hubId: HubTemplateId,
): { fileName: string; text: string } | null {
  const hub = summary.provenance?.kind === 'hub' ? summary.provenance : null;
  const parsed = hubTemplateV0Schema.safeParse({
    format: HUB_FORMAT,
    formatVersion: HUB_FORMAT_VERSION,
    // eslint-disable-next-line lingui/no-unlocalized-strings -- the licence id the hub schema requires
    licence: 'CC0-1.0',
    id: hub?.hubId ?? hubId,
    version: hub?.version ?? 1,
    name: summary.name.slice(0, 80),
    description: '',
    handle: 'taalcut',
    language: summary.language,
    tags: summary.tags.filter((tag) => hubTagSchema.safeParse(tag).success).slice(0, 8),
    formatId: template.origin.kind === 'format' ? template.origin.formatId : null,
    trendFreshness: null,
    forkedFrom: hub ? { id: hub.hubId, version: hub.version } : null,
    structure: hubStructure(template),
    style: null,
  });
  if (!parsed.success) return null;
  const text = `${JSON.stringify(sortKeys(parsed.data), null, 2)}\n`;
  return utf8Bytes(text) > HUB_MAX_BYTES ? null : { fileName: templateFileName(summary.name), text };
}
