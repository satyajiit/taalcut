// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The template service (P2-T8): core's TemplatesService (what appContract.
 * templates serves: reads, each stored document migrated before it leaves the
 * agent) plus `edit`, which turns a slot edit into a new immutable version.
 *
 * Versions are never changed. An edit names the version it was made on; a
 * different head is core.conflict. Redo runs the same command again: the store
 * is first asked for a child of the base with the same change key, and if one
 * exists the head just moves to it, so redo never makes a duplicate.
 */
import {
  ConflictError,
  err,
  ok,
  templateSchema,
  type AsyncResult,
  type Clock,
  type CommandContext,
  type FormatSummary,
  type Result,
  type Template,
  type TemplateId,
  type TemplateListPage,
  type TemplateListQuery,
  type TemplatesService,
  type TemplateStore,
  type TemplateSummary,
  type TemplateVersionSummary,
} from '@taalcut/core';
import { FORMAT_SUMMARIES } from '../formats/registry';
import { libraryNotServed, usesLibraryQuery } from '../library/library-metadata';
import { migrateTemplate } from '../schema/migrations';
import { changeKeyOf } from './change-key';

export interface TemplateEdit {
  readonly templateId: TemplateId;
  readonly baseVersion: number;
  /** The command name and its validated payload: together they are the change key. */
  readonly command: string;
  readonly payload: unknown;
  readonly change: (template: Template) => Result<Template>;
}

export interface TemplateEditOutcome {
  readonly version: number;
  /** True when a redo found the version an earlier run made. */
  readonly reused: boolean;
}

export interface TemplateService extends TemplatesService {
  edit(edit: TemplateEdit, context: CommandContext): AsyncResult<TemplateEditOutcome>;
}

export interface TemplateServiceDeps {
  readonly store: TemplateStore;
  readonly clock: Clock;
  readonly formats?: () => FormatSummary[];
  /**
   * The store filters and sorts `list` by P3-V14's library metadata (library-metadata.ts). Default false: a
   * query that uses those fields is core.not_implemented, never the unfiltered page.
   */
  readonly libraryMetadata?: boolean;
}

const moved = (templateId: TemplateId, head: number, base: number) =>
  ConflictError(
    { entity: 'template', id: templateId },
    {
      detail: `This template changed since (head ${head}, edit made on ${base}); undo the newer change first`,
    },
  );

/**
 * The next version's document: numbered after the highest version, its parent
 * the edited one. Validated here; a failure is a bug in the edit and throws.
 */
export function nextVersion(
  template: Template,
  version: { readonly version: number; readonly parentVersion: number; readonly createdAt: number },
): Template {
  return templateSchema.parse({ ...template, ...version });
}

export function createTemplateService({
  store,
  clock,
  formats,
  libraryMetadata = false,
}: TemplateServiceDeps): TemplateService {
  async function read(
    templateId: TemplateId,
    version?: number,
  ): AsyncResult<{ summary: TemplateSummary; template: Template; version: number }> {
    const stored = await store.get(templateId, version);
    if (!stored.ok) return stored;
    const template = migrateTemplate(stored.value.json, stored.value.schemaVersion);
    if (!template.ok) return template;
    return ok({ summary: stored.value.summary, template: template.value, version: stored.value.version });
  }

  return {
    list: async (query: TemplateListQuery): AsyncResult<TemplateListPage> =>
      !libraryMetadata && usesLibraryQuery(query) ? libraryNotServed() : store.list(query),
    async get({ templateId, version }) {
      const found = await read(templateId, version);
      return found.ok ? ok({ summary: found.value.summary, template: found.value.template }) : found;
    },
    versions: (templateId: TemplateId): AsyncResult<TemplateVersionSummary[]> => store.versions(templateId),
    formats: async () => ok(formats ? formats() : [...FORMAT_SUMMARIES]),

    async edit({ templateId, baseVersion, command, payload, change }, context) {
      const head = await read(templateId);
      if (!head.ok) return head;
      if (head.value.version !== baseVersion) return err(moved(templateId, head.value.version, baseVersion));
      const changeKey = changeKeyOf(command, payload);
      const existing = await store.findChild(templateId, baseVersion, changeKey);
      if (!existing.ok) return existing;
      if (existing.value !== null) {
        const headMoved = await store.setHead(
          { templateId, version: existing.value, expectedHead: baseVersion },
          context,
        );
        return headMoved.ok ? ok({ version: existing.value, reused: true }) : headMoved;
      }
      const changed = change(head.value.template);
      if (!changed.ok) return changed;
      const latest = await store.latestVersion(templateId);
      if (!latest.ok) return latest;
      const document = nextVersion(changed.value, {
        version: latest.value + 1,
        parentVersion: baseVersion,
        createdAt: clock.now(),
      });
      const added = await store.addVersion(document, { command, source: context.source, changeKey }, context);
      return added.ok ? ok({ version: document.version, reused: false }) : added;
    },
  };
}
