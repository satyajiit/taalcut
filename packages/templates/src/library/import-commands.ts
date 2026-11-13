// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `template.import` (P3-V14): 1–50 `.taalcut-template` files, all or nothing, one undo.
 * A bad file is `templates.import_invalid` naming that file's index; nothing is imported. core.not_implemented on
 * a store that would drop the `file` provenance.
 */
import {
  defineCommand,
  err,
  newId,
  ok,
  parseId,
  TEMPLATE_COMMANDS,
  templateCommandPayloads,
  type AnyCommand,
  type AsyncResult,
  type Clock,
  type CommandContext,
  type HubTemplateId,
  type Template,
  type TemplateId,
  type TemplateStore,
} from '@taalcut/core';
import { ImportInvalid } from '../errors';
import { fromHubTemplate } from '../hub/from-hub';
import { libraryNotServed } from './library-metadata';
import { inspectTemplateFile, type FileProblem } from './template-file';

const N = TEMPLATE_COMMANDS;

interface Ready {
  readonly templateId: TemplateId;
  readonly template: Template;
  readonly name: string;
  readonly hubId: HubTemplateId | null;
}

function problemText(problems: readonly FileProblem[]): string {
  return JSON.stringify(problems.slice(0, 50));
}

/**
 * All or nothing on a store that doesn't stage writes in the command's unit of work: the templates this
 * import already made go again. A failure here is the one reported, since the library is now half-imported.
 */
async function removeAll(
  store: TemplateStore,
  templateIds: readonly TemplateId[],
  context: CommandContext,
): AsyncResult<void> {
  for (const templateId of templateIds) {
    const removed = await store.remove(templateId, context);
    if (!removed.ok) return removed;
  }
  return ok(undefined);
}

export function createImportCommands(deps: {
  readonly store: TemplateStore;
  readonly clock: Clock;
  /** The store keeps provenance (library-metadata.ts); otherwise the file's hub id would be dropped. */
  readonly libraryMetadata: boolean;
}) {
  const { store, clock, libraryMetadata } = deps;

  const discardMany = defineCommand({
    name: N.discardMany,
    payload: templateCommandPayloads[N.discardMany],
    sideEffect: 'write',
    internal: true,
    handle: async ({ templateIds }, context) => {
      for (const templateId of templateIds) {
        const used = await store.usedBy(templateId);
        if (!used.ok) return used;
        const done =
          used.value === 0
            ? await store.remove(templateId, context)
            : await store.setMeta(templateId, { archived: true }, context);
        if (!done.ok) return done;
      }
      return ok({ result: { templateIds } });
    },
  });

  const importFiles = defineCommand({
    name: N.import,
    payload: templateCommandPayloads[N.import],
    sideEffect: 'write',
    handle: async ({ items }, context) => {
      if (!libraryMetadata) return libraryNotServed();
      const ready: Ready[] = [];
      for (const [index, item] of items.entries()) {
        const inspected = inspectTemplateFile(item.text);
        if (!inspected.ok)
          return err(ImportInvalid({ file: index, problems: problemText(inspected.problems) }));
        const hubId = parseId<'HubTemplate'>(inspected.doc.id);
        if (!hubId.ok)
          return err(ImportInvalid({ file: index, problems: problemText([{ path: 'id', rule: 'schema' }]) }));
        const templateId = item.templateId;
        const forked = fromHubTemplate(
          inspected.doc,
          { template: () => templateId, slot: () => newId(), overlay: () => newId() },
          clock.now(),
        );
        if (!forked.ok)
          return err(
            ImportInvalid({ file: index, problems: problemText([{ path: '', rule: forked.error.code }]) }),
          );
        ready.push({ templateId, template: forked.value, name: inspected.doc.name, hubId: hubId.value });
      }
      const importedAt = clock.now();
      const created: TemplateId[] = [];
      for (const item of ready) {
        const stored = await store.create(
          item.template,
          {
            name: item.name,
            projectId: null,
            listed: true,
            provenance: { kind: 'file', importedAt, hubId: item.hubId },
          },
          context,
        );
        if (!stored.ok) {
          const undone = await removeAll(store, created, context);
          return undone.ok ? stored : undone;
        }
        created.push(item.templateId);
      }
      return ok({
        result: { templateIds: created },
        inverse: { name: N.discardMany, payload: { projectId: null, templateIds: created } },
      });
    },
  });

  const all: AnyCommand[] = [importFiles, discardMany];
  return { importFiles, discardMany, all };
}
