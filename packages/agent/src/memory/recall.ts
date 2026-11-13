// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Recall (LRN1-MEM, SPEC section 33): once per run, before its first model call. Its scopes are the user's, the
 * run's project and the templates it works from (the opening choice, slot chips, the project's timelines). The
 * library ranks the items for the message; the run keeps the best that fit the token budget.
 *
 * Consent first (PRD §7.2, "never silently sent to the cloud"): with Local only on, every prompt stays on this Mac,
 * so memory is used. Otherwise, when any prompt of the run may go to a cloud model, memory goes along only while
 * Settings → Memory's switch allows it; with the switch off nothing is recalled and the log says it was withheld.
 */
import {
  isId,
  ok,
  type AsyncResult,
  type ChatStart,
  type MemoryPromptUse,
  type MemoryScope,
  type ModelModuleId,
  type ProjectId,
  type SelectionChip,
  type TemplateId,
} from '@taalcut/core';
import type { MemoryRecallDeps, RankedMemoryItem, RecalledMemory, RecalledMemoryItem } from './memory-port';
import { fitProductMemory } from '../products/knowledge';

/** Items a run recalls at most. */
export const MEMORY_RECALL_K = 24;
/** The memory block's budget in estimated tokens (characters / 4), framing included. */
export const MEMORY_PROMPT_TOKENS = 1_500;
/**
 * LRN1-CTX: at most this share of the smallest context window the run's prompts may go to. 1,500 tokens is 18% of a
 * local model's 8,192, which left a skill no room to work in; 8% keeps memory to 655 there and to the full 1,500 from
 * a window of 18,750 up.
 */
export const MEMORY_WINDOW_SHARE = 0.08;
/** What the block's headings and fence cost, in characters, before any item. */
const FRAME_CHARS = 900;
/** Templates a run's scope takes at most. */
const MAX_TEMPLATES = 3;

export interface RecallRequest {
  readonly message: string;
  readonly projectId?: string;
  readonly start?: ChatStart;
  readonly selections?: readonly SelectionChip[];
  /** Local only for this run (run.started.localOnly). */
  readonly localOnly: boolean;
  /** The model modules the run's prompts go to: the agent's and its skills'. */
  readonly modules: readonly ModelModuleId[];
  readonly signal?: AbortSignal;
}

/** Where the run's memory may go: on-device, cloud, or withheld from a cloud prompt. */
export async function memoryUse(
  deps: Pick<MemoryRecallDeps, 'cloudPrompts' | 'leavesDevice'>,
  localOnly: boolean,
  modules: readonly ModelModuleId[],
): AsyncResult<MemoryPromptUse> {
  if (localOnly || !modules.some((module) => deps.leavesDevice(module))) return ok('on-device');
  const allowed = await deps.cloudPrompts();
  if (!allowed.ok) return allowed;
  return ok(allowed.value ? 'cloud' : 'withheld');
}

/** The templates the run works from, at most MAX_TEMPLATES, the most direct first. */
async function runTemplates(deps: MemoryRecallDeps, request: RecallRequest): AsyncResult<TemplateId[]> {
  const found: TemplateId[] = [];
  if (request.start?.path === 'template') found.push(request.start.templateId);
  for (const chip of request.selections ?? []) if (chip.kind === 'slot') found.push(chip.templateId);
  if (request.projectId && isId(request.projectId) && deps.projectTemplates) {
    const made = await deps.projectTemplates(request.projectId as ProjectId);
    if (!made.ok) return made;
    found.push(...made.value);
  }
  return ok([...new Set(found)].slice(0, MAX_TEMPLATES));
}

export async function runScopes(deps: MemoryRecallDeps, request: RecallRequest): AsyncResult<MemoryScope[]> {
  const scopes: MemoryScope[] = [{ kind: 'user' }];
  if (request.projectId && isId(request.projectId))
    scopes.push({ kind: 'project', projectId: request.projectId as ProjectId });
  const templates = await runTemplates(deps, request);
  if (!templates.ok) return templates;
  for (const templateId of templates.value) scopes.push({ kind: 'template', templateId });
  return ok(scopes);
}

function recalled({ item }: RankedMemoryItem): RecalledMemoryItem {
  return {
    id: item.id,
    scope: item.scope,
    scopeName: item.scopeName,
    source: item.source,
    text: item.text,
    updatedAt: item.updatedAt,
    ...(item.data ? { learned: item.data.kind } : {}),
  };
}

/**
 * The block's budget in estimated tokens: `cap`, or MEMORY_WINDOW_SHARE of the smallest known context window among
 * the models the run's prompts may go to, whichever is less. No known window: `cap`.
 */
export function memoryTokenBudget(
  windows: readonly (number | undefined)[],
  cap: number = MEMORY_PROMPT_TOKENS,
): number {
  const known = windows.filter((window): window is number => window !== undefined && window > 0);
  return known.length === 0 ? cap : Math.min(cap, Math.floor(Math.min(...known) * MEMORY_WINDOW_SHARE));
}

/** The best items that fit `maxTokens`, in rank order; the rest are counted as trimmed. */
export function fitMemory(
  ranked: readonly RankedMemoryItem[],
  maxTokens: number,
): Pick<RecalledMemory, 'items' | 'trimmed'> {
  let chars = FRAME_CHARS;
  const items: RecalledMemoryItem[] = [];
  for (const entry of ranked) {
    // The item's line: its words plus where it came from (scope, source, date).
    const cost = entry.item.text.length + (entry.item.scopeName?.length ?? 0) + 80;
    if (Math.ceil((chars + cost) / 4) > maxTokens) break;
    chars += cost;
    items.push(recalled(entry));
  }
  return { items, trimmed: ranked.length - items.length };
}

/**
 * What the run's prompts carry. A store or setting that can't be read leaves the run without memory and says why
 * (an unread cloud switch counts as off: memory never goes to the cloud on a guess).
 */
export async function recallMemory(deps: MemoryRecallDeps, request: RecallRequest): Promise<RecalledMemory> {
  const decided = await memoryUse(deps, request.localOnly, request.modules);
  if (!decided.ok) return { use: 'withheld', items: [], trimmed: 0, failed: decided.error.code };
  const use = decided.value;
  if (use === 'withheld') return { use, items: [], trimmed: 0 };
  const scopes = await runScopes(deps, request);
  if (!scopes.ok) return { use, items: [], trimmed: 0, failed: scopes.error.code };
  const ranked = await deps.ranker.rank({
    scopes: scopes.value,
    query: request.message,
    k: deps.k ?? MEMORY_RECALL_K,
    ...(request.signal ? { signal: request.signal } : {}),
  });
  if (!ranked.ok) return { use, items: [], trimmed: 0, failed: ranked.error.code };
  const windows = request.modules.map((module) => deps.contextWindow?.(module));
  const budget = memoryTokenBudget(windows, deps.maxTokens);
  const context = await deps.productContext?.({
    ...(request.projectId ? { projectId: request.projectId } : {}),
    query: request.message,
  });
  const product = fitProductMemory(context?.ok ? context.value : null, Math.floor(budget * 2));
  return {
    use,
    ...fitMemory(ranked.value, product ? Math.floor(budget / 2) : budget),
    ...(product ? { product } : {}),
    ...(context && !context.ok ? { failed: context.error.code } : {}),
  };
}
