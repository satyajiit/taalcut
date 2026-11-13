// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Memory command names and payloads (LRN1-MEM), so Settings → Memory, the agent's memory.remember and the export
 * recorder dispatch them typed. Handlers: @taalcut/library. All app-wide (`projectId: null`, whatever the item's
 * scope): memory is edited in Settings, in the app's history. Every edit's inverse is the internal `memory.restore`
 * with the whole previous item (null: it didn't exist).
 *
 * Who may write what: a `user` item only from a person (PERSON_SOURCES: ui, shortcut); the agent and MCP clients
 * create `agent` or `learned` items only, and may change or delete only those. Anything else is
 * core.memory_source_refused, so nothing a model reads in media can make itself the creator's instruction.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { defineError } from '../basics/errors';
import { idSchema } from '../basics/ids';
import { defineSetting } from '../ports/preferences';
import {
  memoryDataSchema,
  memoryItemInputSchema,
  memoryItemSchema,
  memoryScopeSchema,
  memoryTextSchema,
  type MemorySource,
} from './memory-schema';

export const MEMORY_COMMANDS = {
  /** write; inverse memory.delete. */
  create: 'memory.create',
  /** write; names the revision it read (core.conflict otherwise); inverse memory.restore. The source never changes. */
  update: 'memory.update',
  /** write: undo brings it back; inverse memory.restore. */
  remove: 'memory.delete',
  /** Internal: update's and delete's inverse. */
  restore: 'memory.restore',
  /**
   * write, no inverse, person sources only (`sources: PERSON_SOURCES`), like PRIVACY_COMMANDS: ⌘Z must never start
   * sending memory to the cloud again.
   */
  setCloudPrompts: 'memory.setCloudPrompts',
} as const;

const memoryId = idSchema<'MemoryItem'>();
const appWide = { projectId: z.null().default(null) };

export const memoryCommandPayloads = {
  [MEMORY_COMMANDS.create]: z.object({ ...appWide, memoryId, item: memoryItemInputSchema }),
  [MEMORY_COMMANDS.update]: z.object({
    ...appWide,
    memoryId,
    baseRevision: z.int().min(1),
    patch: z
      .object({ scope: memoryScopeSchema, text: memoryTextSchema, data: memoryDataSchema.nullable() })
      .partial()
      .refine((patch) => Object.keys(patch).length > 0, { message: 'Nothing to change' }),
  }),
  [MEMORY_COMMANDS.remove]: z.object({ ...appWide, memoryId }),
  [MEMORY_COMMANDS.restore]: z.object({ ...appWide, memoryId, item: memoryItemSchema.nullable() }),
  [MEMORY_COMMANDS.setCloudPrompts]: z.object({ ...appWide, enabled: z.boolean() }),
};

/**
 * Whether memory goes into prompts sent to cloud models (Settings → Memory's switch). Off: a run whose prompts may
 * leave the Mac recalls none. Local only (LOCAL_ONLY_SETTING) keeps every prompt on this Mac, so memory is used then.
 */
export const MEMORY_CLOUD_PROMPTS_SETTING = defineSetting('memory.cloudPrompts', z.boolean(), true);

/** The dispatcher may not write an item of this source (see the file comment). */
export const MemorySourceRefused = defineError<{ source: MemorySource }>('core.memory_source_refused');
