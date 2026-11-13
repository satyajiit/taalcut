// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { z } from 'zod';
import { idSchema } from '../basics/ids';
import { importMethodSchema, importSelectionSchema } from './import-types';

export const IMPORT_COMMANDS = {
  ejectSource: 'imports.ejectSource',
  createDraft: 'imports.createDraft',
  updateDraft: 'imports.updateDraft',
  discardDraft: 'imports.discardDraft',
  start: 'imports.start',
  pause: 'imports.pause',
  resume: 'imports.resume',
  cancel: 'imports.cancel',
  retryFailed: 'imports.retryFailed',
} as const;
const draft = z.object({ draftId: idSchema<'ImportDraft'>() });
const session = z.object({ sessionId: idSchema<'ImportSession'>() });
export const importCommandPayloads = {
  [IMPORT_COMMANDS.ejectSource]: z.object({ sourceId: z.string().min(1).max(200) }),
  [IMPORT_COMMANDS.createDraft]: z.object({
    method: importMethodSchema,
    /** Only explicit picker/drop actions supply paths. Paths never appear in a route. */
    paths: z.array(z.string().min(1).max(4096)).max(10000).optional(),
    deviceId: z.string().min(1).max(200).optional(),
    sourceId: idSchema<'Source'>().optional(),
    watch: z.boolean().default(false),
  }),
  [IMPORT_COMMANDS.updateDraft]: draft.extend({
    ...importSelectionSchema.partial().shape,
    storage: z.enum(['copy', 'reference']).optional(),
    allowNetwork: z.boolean().optional(),
    watch: z.boolean().optional(),
    recursive: z.boolean().optional(),
  }),
  [IMPORT_COMMANDS.discardDraft]: draft,
  [IMPORT_COMMANDS.start]: draft,
  [IMPORT_COMMANDS.pause]: session,
  [IMPORT_COMMANDS.resume]: session,
  [IMPORT_COMMANDS.cancel]: session,
  [IMPORT_COMMANDS.retryFailed]: session,
};
