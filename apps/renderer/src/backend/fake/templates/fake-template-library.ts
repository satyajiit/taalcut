// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P3-V14: the template library at scale as the renderer's fake serves it: folders (templates.folders), a
 * template's file (templates.exportDocument, files.saveTemplateAs) and the metadata, archive, folder and import
 * commands (template.setTags, setFavourite, setTrendDate, moveToFolder, archive, import, templateFolder.*), each
 * with the service's inverse and refusals (packages/templates library/*). fake-phase2.ts spreads `router` into
 * `templates` and `files` into `files`.
 */
import {
  appContract,
  ConflictError,
  defineCommand,
  err,
  implementContract,
  newId,
  NotFoundError,
  NotImplementedError,
  ok,
  TEMPLATE_COMMANDS,
  templateCommandPayloads,
  templateTagSchema,
  toRpcError,
  type AnyCommand,
  type EventBus,
  type Id,
  type TemplateDocumentInput,
  type TemplateSummary,
} from '@taalcut/core';
import { createFakeFolders } from './fake-template-folders';
import { createFakeInstagramSaved, type FakeInstagramAuthRead } from './fake-instagram-saved';
import { createFakeStyleProfiles, type FakeStyleProfilesOptions } from './fake-style-profiles';
import type { FakeTemplates, LibraryMeta } from './fake-templates';
import { ImportInvalid, TagInvalid, FolderNotFound } from './template-errors';
import { fromHubDocument, inspectTemplateFile, templateFileText } from './template-file';

const N = TEMPLATE_COMMANDS;
const P = templateCommandPayloads;
const TEMPLATE_PROCEDURES = {
  folders: appContract.templates.folders,
  exportDocument: appContract.templates.exportDocument,
};
const FILE_PROCEDURES = { saveTemplateAs: appContract.files.saveTemplateAs };

type TemplateId = Id<'Template'>;

/** What the library reads from the rest of the fake: Instagram's sign-in, and the templates behind ready exports. */
interface FakeTemplateLibraryReads {
  readonly instagramAuth?: (() => FakeInstagramAuthRead) | undefined;
  readonly exportedTemplates?: (() => readonly TemplateId[]) | undefined;
}

export function createFakeTemplateLibrary(
  events: EventBus,
  templates: FakeTemplates,
  reads: FakeTemplateLibraryReads = {},
  styleProfileOptions?: FakeStyleProfilesOptions,
) {
  const folders = createFakeFolders(templates);
  const instagram = createFakeInstagramSaved(
    events,
    templates,
    reads.instagramAuth ?? (() => ({ signedIn: false, username: null })),
  );
  const styleProfiles = createFakeStyleProfiles({
    events,
    templates,
    instagram,
    folderName: (folderId) => folders.list().find((folder) => folder.id === folderId)?.name ?? null,
    exportedTemplates: reads.exportedTemplates ?? (() => []),
    options: styleProfileOptions,
  });
  /** What files.saveTemplateAs wrote, newest last (tests read it). */
  const saved: { fileName: string; text: string }[] = [];

  /** A lineage's facts change; the inverse puts the one field back as it was. */
  function metaCommand<K extends 'tags' | 'favourite' | 'trendFreshness' | 'archived', Name extends string>(
    name: Name,
    field: K,
  ) {
    return (templateId: TemplateId, value: LibraryMeta[K]) => {
      const before = templates.summary(templateId);
      if (!before) return err(NotFoundError({ entity: 'template', id: templateId }));
      templates.setMeta(templateId, { [field]: value });
      return ok({
        result: { templateId, [field]: value },
        inverse: { name, payload: { projectId: null, templateId, [field]: before[field] } },
      });
    };
  }
  const setFavourite = metaCommand(N.setFavourite, 'favourite');
  const setTrendDate = metaCommand(N.setTrendDate, 'trendFreshness');
  const setArchived = metaCommand(N.archive, 'archived');
  const setTags = metaCommand(N.setTags, 'tags');

  function exportDocument(input: TemplateDocumentInput) {
    const summary = templates.summary(input.templateId);
    const template = templates.template(input.templateId, input.version);
    if (!summary || !template) return err(NotFoundError({ entity: 'template', id: input.templateId }));
    // The service writes the template's look into the file; the fake has no styles to read it from.
    if (input.includeStyle && template.styleId)
      // eslint-disable-next-line lingui/no-unlocalized-strings -- a feature name for developers, never shown
      return err(NotImplementedError({ feature: 'templates.exportDocument with a look' }));
    const file = templateFileText(template, summary, newId<'HubTemplate'>());
    return file ? ok(file) : err(NotFoundError({ entity: 'template', id: input.templateId }));
  }

  const commands: AnyCommand[] = [
    ...folders.commands,
    ...instagram.commands,
    defineCommand({
      name: N.setTags,
      payload: P[N.setTags],
      sideEffect: 'write',
      project: () => null,
      handle: ({ templateId, tags }) => {
        const normalised: string[] = [];
        for (const tag of tags) {
          const parsed = templateTagSchema.safeParse(tag);
          if (!parsed.success) return err(TagInvalid(tag));
          if (!normalised.includes(parsed.data)) normalised.push(parsed.data);
        }
        return setTags(templateId, normalised);
      },
    }),
    defineCommand({
      name: N.setFavourite,
      payload: P[N.setFavourite],
      sideEffect: 'write',
      project: () => null,
      handle: ({ templateId, favourite }) => setFavourite(templateId, favourite),
    }),
    defineCommand({
      name: N.setTrendDate,
      payload: P[N.setTrendDate],
      sideEffect: 'write',
      project: () => null,
      handle: ({ templateId, trendFreshness }) => setTrendDate(templateId, trendFreshness),
    }),
    defineCommand({
      name: N.archive,
      payload: P[N.archive],
      sideEffect: 'write',
      project: (p) => p.projectId,
      handle: ({ templateId, archived }) => setArchived(templateId, archived),
    }),
    defineCommand({
      name: N.moveToFolder,
      payload: P[N.moveToFolder],
      sideEffect: 'write',
      project: () => null,
      handle: ({ templateIds, folderId }) => {
        const ids = [...new Set(templateIds)];
        if (folderId !== null && !folders.has(folderId)) return err(FolderNotFound());
        const previous: { templateId: TemplateId; folderId: TemplateSummary['folderId'] }[] = [];
        for (const templateId of ids) {
          const before = templates.summary(templateId);
          if (!before) return err(NotFoundError({ entity: 'template', id: templateId }));
          previous.push({ templateId, folderId: before.folderId });
        }
        for (const templateId of ids) templates.setMeta(templateId, { folderId }, false);
        templates.announce(ids);
        return ok({
          result: { templateIds: ids, folderId },
          inverse: { name: N.restoreFolders, payload: { projectId: null, moves: previous } },
        });
      },
    }),
    defineCommand({
      name: N.restoreFolders,
      payload: P[N.restoreFolders],
      sideEffect: 'write',
      internal: true,
      project: () => null,
      handle: ({ moves }) => {
        for (const move of moves) {
          if (!templates.setMeta(move.templateId, { folderId: move.folderId }, false))
            return err(NotFoundError({ entity: 'template', id: move.templateId }));
        }
        templates.announce(moves.map((move) => move.templateId));
        return ok({ result: { templateIds: moves.map((move) => move.templateId) } });
      },
    }),
    defineCommand({
      name: N.import,
      payload: P[N.import],
      sideEffect: 'write',
      project: () => null,
      handle: ({ items }, ctx) => {
        // All or nothing: every file is read before any joins the library.
        const now = Date.now();
        const ready = [];
        for (const [index, item] of items.entries()) {
          if (templates.summary(item.templateId))
            return err(ConflictError({ entity: 'template', id: item.templateId }));
          const read = inspectTemplateFile(item.text);
          if (!read.ok) return err(ImportInvalid(index, read.problems));
          const template = fromHubDocument(read.doc, item.templateId, now);
          if (!template) return err(ImportInvalid(index, [{ path: '', rule: 'hub.invalid' }]));
          ready.push({ template, name: read.doc.name, hubId: read.doc.id as Id<'HubTemplate'> });
        }
        for (const item of ready)
          templates.create(item.template, item.name, N.import, ctx.source, {
            provenance: { kind: 'file', importedAt: now, hubId: item.hubId },
          });
        const templateIds = ready.map((item) => item.template.id);
        return ok({
          result: { templateIds },
          inverse: { name: N.discardMany, payload: { projectId: null, templateIds } },
        });
      },
    }),
    defineCommand({
      name: N.discardMany,
      payload: P[N.discardMany],
      sideEffect: 'write',
      internal: true,
      project: () => null,
      handle: ({ templateIds }) => {
        for (const templateId of templateIds) templates.discard(templateId);
        return ok({ result: { templateIds } });
      },
    }),
  ];

  const tpl = implementContract(TEMPLATE_PROCEDURES);
  const fs = implementContract(FILE_PROCEDURES);
  const router = {
    folders: tpl.folders.handler(() => folders.list()),
    exportDocument: tpl.exportDocument.handler(({ input }) => {
      const file = exportDocument(input);
      if (!file.ok) throw toRpcError(file.error);
      return file.value;
    }),
    ...instagram.router,
    ...styleProfiles.router,
  };
  const files = {
    // The save panel's answer: the person keeps the suggested name.
    saveTemplateAs: fs.saveTemplateAs.handler(({ input }) => {
      const file = exportDocument(input);
      if (!file.ok) throw toRpcError(file.error);
      saved.push(file.value);
      return { saved: true, fileName: file.value.fileName };
    }),
  };
  return { router, files, commands, saved };
}

export type FakeTemplateLibrary = ReturnType<typeof createFakeTemplateLibrary>;
