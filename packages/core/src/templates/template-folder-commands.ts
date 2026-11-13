// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Folders in the template library (P3-V14): names and payloads. Handlers: @taalcut/templates over the library's
 * TemplateFolderStore. App-wide history. Deleting a folder moves its templates out (to no folder); its inverse,
 * the internal `templateFolder.restore`, puts the folder and its templates back.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { idSchema, type TemplateFolderId, type TemplateId } from '../basics/ids';
import type { AsyncResult } from '../basics/result';
import type { CommandContext } from '../commands/definition';
import { createToken } from '../di/token';
import type { TemplateFolder } from './template-library';

export const TEMPLATE_FOLDER_COMMANDS = {
  create: 'templateFolder.create',
  rename: 'templateFolder.rename',
  remove: 'templateFolder.delete',
  /** Internal: delete's inverse. */
  restore: 'templateFolder.restore',
} as const;

const folderId = idSchema<'TemplateFolder'>();
const folderName = z.string().trim().min(1).max(60);
const app = { projectId: z.null().default(null) };

export const templateFolderCommandPayloads = {
  [TEMPLATE_FOLDER_COMMANDS.create]: z.object({ ...app, folderId, name: folderName }),
  [TEMPLATE_FOLDER_COMMANDS.rename]: z.object({ ...app, folderId, name: folderName }),
  [TEMPLATE_FOLDER_COMMANDS.remove]: z.object({ ...app, folderId }),
  [TEMPLATE_FOLDER_COMMANDS.restore]: z.object({
    ...app,
    folder: z.object({ id: folderId, name: folderName, createdAt: z.int().nonnegative() }),
    templateIds: z.array(idSchema<'Template'>()).max(10_000),
  }),
};

/** The library implements it; names are unique case-insensitively (`templates.folder_name_taken`). */
export interface TemplateFolderStore {
  list(): AsyncResult<TemplateFolder[]>;
  create(
    input: { readonly id: TemplateFolderId; readonly name: string },
    context?: CommandContext,
  ): AsyncResult<TemplateFolder>;
  rename(id: TemplateFolderId, name: string, context?: CommandContext): AsyncResult<TemplateFolder>;
  /** Moves its templates to no folder; returns their ids for the inverse. */
  remove(id: TemplateFolderId, context?: CommandContext): AsyncResult<{ readonly templateIds: TemplateId[] }>;
  restore(
    folder: { readonly id: TemplateFolderId; readonly name: string; readonly createdAt: number },
    templateIds: readonly TemplateId[],
    context?: CommandContext,
  ): AsyncResult<TemplateFolder>;
}

export const TemplateFolderStoreToken = createToken<TemplateFolderStore>('core.templateFolderStore');
