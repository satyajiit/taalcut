// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Agent memory (PRD §7.2 Memory, §6.3 MemoryItem; LRN1-MEM): what Taalcut remembers between runs, in three scopes
 * (the user: style, brand, preferences; a project: decisions made; a template: what worked) and from three sources
 * (the user wrote it in Settings → Memory; the agent proposed it and the user approved it; Taalcut learned it from an
 * export or from casting swaps). @taalcut/library stores items (MemoryStore) and embeds their text into the memory
 * index; @taalcut/agent recalls them into a run's prompt. A `user` item is the creator's own instruction; an `agent`
 * or `learned` item is data, fenced in the prompt with where it came from. Items never leave the Mac except inside a
 * cloud model's prompt, and only while MEMORY_CLOUD_PROMPTS_SETTING allows it (memory-commands.ts).
 */
import '../basics/zod-config';
import { z } from 'zod';
import { idSchema } from '../basics/ids';
import { EXPORT_PRESET_IDS } from '../render/presets';
import { fitCastingWeights, sameCastingWeights } from './casting-weights';

export const MEMORY_SCOPES = ['user', 'project', 'template'] as const;
export type MemoryScopeKind = (typeof MEMORY_SCOPES)[number];

/** user: typed in Settings → Memory. agent: proposed with memory.remember and approved. learned: recorded by Taalcut. */
export const MEMORY_SOURCES = ['user', 'agent', 'learned'] as const;
export type MemorySource = (typeof MEMORY_SOURCES)[number];

/** Characters in one item's text: a sentence or two, not a document. */
export const MEMORY_TEXT_MAX = 500;

/** An item's words. User content: shown as written, never translated. */
export const memoryTextSchema = z.string().trim().min(1).max(MEMORY_TEXT_MAX);

/** Where an item applies. Deleting the project or template deletes its items with it. */
export const memoryScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('user') }),
  z.object({ kind: z.literal('project'), projectId: idSchema<'Project'>() }),
  z.object({ kind: z.literal('template'), templateId: idSchema<'Template'>() }),
]);
export type MemoryScope = z.output<typeof memoryScopeSchema>;

/** The casting config's weight range (timeline's castingConfigSchema). */
const castingWeight = z.number().min(0).max(5);

/** Casting's five score weights (timeline's casting config `weights`; LRN1-PREF). */
export const castingWeightsSchema = z.object({
  intent: castingWeight,
  motion: castingWeight,
  quality: castingWeight,
  subject: castingWeight,
  energy: castingWeight,
});

/**
 * LRN1-PREF: casting weights learned from the creator's swaps, relocks and removals, kept on a `learned` item in the
 * user scope (visible, editable, resettable like any other). They replace the five score weights of the casting
 * config they were learned against; another config version ignores them. Their bounds and their text are
 * memory/casting-weights.ts's.
 */
export const castingWeightsDataSchema = z.object({
  kind: z.literal('casting-weights'),
  configVersion: z.string().regex(/^casting\.v[1-9]\d*$/),
  /** That config version's own weights: the bounds, and what Settings shows as the default. */
  defaults: castingWeightsSchema,
  weights: castingWeightsSchema,
  /** How many "chosen over rejected" pairs they were learned from. */
  pairs: z.int().nonnegative(),
});

/**
 * What worked (LRN1-MEM): a template and a look that reached a finished export, kept on a `learned` item in the
 * template's scope. One item per template and Style: a later export of the same pair refreshes it.
 */
export const whatWorkedDataSchema = z.object({
  kind: z.literal('what-worked'),
  templateVersion: z.int().min(1),
  /** The timeline's Style when it was exported; null without one. */
  styleId: idSchema<'Style'>().nullable(),
  presetId: z.enum(EXPORT_PRESET_IDS),
  /** The latest render of the pair that reached `ready`. */
  renderId: idSchema<'Render'>(),
  /** Exports of the pair so far, this one included. */
  exports: z.int().min(1),
});

/** What a `learned` item carries for the code that learned it. New kinds are a contract change. */
export const memoryDataSchema = z.discriminatedUnion('kind', [
  castingWeightsDataSchema,
  whatWorkedDataSchema,
]);
export type MemoryData = z.output<typeof memoryDataSchema>;
export type MemoryDataKind = MemoryData['kind'];
export const MEMORY_DATA_KINDS = [
  'casting-weights',
  'what-worked',
] as const satisfies readonly MemoryDataKind[];

export const memoryItemSchema = z.object({
  id: idSchema<'MemoryItem'>(),
  scope: memoryScopeSchema,
  text: memoryTextSchema,
  source: z.enum(MEMORY_SOURCES),
  /** Only on `learned` items (memoryItemProblems). */
  data: memoryDataSchema.nullable(),
  /** The chat an `agent` item was proposed in; null otherwise. */
  conversationId: idSchema<'Conversation'>().nullable(),
  /** +1 per write; memory.update names the one it read. */
  revision: z.int().min(1),
  createdAt: z.int().nonnegative(),
  updatedAt: z.int().nonnegative(),
});
export type MemoryItem = z.output<typeof memoryItemSchema>;

/** What memory.create takes; the handler adds the id, revision and times. */
export const memoryItemInputSchema = z.object({
  scope: memoryScopeSchema,
  text: memoryTextSchema,
  source: z.enum(MEMORY_SOURCES),
  data: memoryDataSchema.nullable().default(null),
  conversationId: idSchema<'Conversation'>().nullable().default(null),
});
export type MemoryItemInput = z.input<typeof memoryItemInputSchema>;

/** An item as Settings and the agent's prompt show it: with its project's or template's name. */
export const memoryItemViewSchema = memoryItemSchema.extend({
  /** The project's or template's name; null in the user scope. User content, shown as written. */
  scopeName: z.string().max(200).nullable(),
});
export type MemoryItemView = z.output<typeof memoryItemViewSchema>;

/**
 * What's wrong with an item beyond its shape, as developer-facing messages (empty: fine). `data` only on `learned`
 * items, `casting-weights` only in the user scope and inside their bounds (casting-weights.ts), `what-worked` only in
 * a template's scope, `conversationId` only on `agent` items. Handlers refuse an item with a problem as
 * core.validation.
 */
export function memoryItemProblems(
  item: Pick<MemoryItem, 'scope' | 'source' | 'data' | 'conversationId'>,
): string[] {
  const problems: string[] = [];
  if (item.data !== null && item.source !== 'learned') problems.push('data is only for learned items');
  if (item.data?.kind === 'casting-weights' && item.scope.kind !== 'user')
    problems.push('casting-weights belongs to the user scope');
  if (
    item.data?.kind === 'casting-weights' &&
    !sameCastingWeights(fitCastingWeights(item.data.weights, item.data.defaults), item.data.weights)
  )
    problems.push("casting-weights must be inside their bounds, at the defaults' total");
  if (item.data?.kind === 'what-worked' && item.scope.kind !== 'template')
    problems.push("what-worked belongs to a template's scope");
  if (item.conversationId !== null && item.source !== 'agent')
    problems.push('conversationId is only for agent items');
  return problems;
}
