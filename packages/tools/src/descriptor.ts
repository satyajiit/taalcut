// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Serialisable views of a tool: the full descriptor (metadata the agent's
 * policies read, no functions or schemas) and the compact catalogue entry the
 * model sees before it asks for a schema.
 */
import {
  toolFamily,
  toolNeedsApproval,
  toolSummary,
  type AnyTool,
  type ToolCostClass,
  type ToolPermission,
  type ToolRetryPolicy,
  type ToolSideEffect,
} from '@taalcut/core';

export interface ToolDescriptor {
  readonly name: string;
  /** Provider-safe function name ('media_probe'): model APIs allow only [a-zA-Z0-9_-]. */
  readonly callName: string;
  readonly version: string;
  readonly module: string;
  readonly family: string;
  readonly summary: string;
  readonly description: string;
  readonly tags: readonly string[];
  readonly costClass: ToolCostClass;
  readonly sideEffect: ToolSideEffect;
  readonly timeoutMs: number;
  readonly retry: ToolRetryPolicy;
  readonly permission: ToolPermission;
  readonly command?: string;
  readonly cacheable: boolean;
  readonly cacheTtlMs?: number;
  readonly checkpoint: boolean;
  /** LRN1-MEM: asks at every autonomy level though it changes only local state (ToolSpec.alwaysAsk). */
  readonly alwaysAsk: boolean;
  /**
   * LRN1-CTX: a successful call stores the step's work so far (ToolSpec.savesProgress), so the agent shows the step's
   * earlier calls and results as one line from then on.
   */
  readonly savesProgress: boolean;
  /** Destructive, external and alwaysAsk tools: an approval event is needed at every autonomy level. */
  readonly requiresApproval: boolean;
  readonly estimatesCost: boolean;
  readonly idempotent: boolean;
  /** Offered to external agents over MCP (P3-V4); false when the spec sets `exposure: { mcp: false }`. */
  readonly exposure: { readonly mcp: boolean };
}

/** The compact line the model sees for every tool: no schema, a few tokens each. */
export interface ToolCatalogueEntry {
  readonly name: string;
  readonly summary: string;
  readonly family: string;
}

/** 'media.probe' becomes 'media_probe'. Tool names have no underscores, so this is reversible. */
export function toCallName(name: string): string {
  return name.replace('.', '_');
}

export function describeTool(spec: AnyTool, module: string): ToolDescriptor {
  const cache = spec.cache;
  return {
    name: spec.name,
    callName: toCallName(spec.name),
    version: spec.version,
    module,
    family: toolFamily(spec),
    summary: toolSummary(spec),
    description: spec.description.trim(),
    tags: [...(spec.tags ?? [])],
    costClass: spec.costClass,
    sideEffect: spec.sideEffect,
    timeoutMs: spec.timeoutMs,
    retry: spec.retry,
    permission: spec.permission ?? {},
    ...(spec.command !== undefined ? { command: spec.command } : {}),
    cacheable: Boolean(cache),
    ...(typeof cache === 'object' ? { cacheTtlMs: cache.ttlMs } : {}),
    checkpoint: spec.checkpoint ?? false,
    alwaysAsk: spec.alwaysAsk === true,
    savesProgress: spec.savesProgress === true,
    requiresApproval: toolNeedsApproval(spec),
    estimatesCost: typeof spec.estimateCost === 'function',
    idempotent: typeof spec.idempotencyKey === 'function',
    exposure: { mcp: spec.exposure?.mcp !== false },
  };
}

export function toCatalogueEntry(descriptor: ToolDescriptor): ToolCatalogueEntry {
  return { name: descriptor.name, summary: descriptor.summary, family: descriptor.family };
}

/**
 * The catalogue as prompt text, one line per tool, grouped by family:
 *
 *   media: media.probe: Reads duration, streams and codecs of a video file.
 */
export function formatCatalogue(entries: readonly ToolCatalogueEntry[]): string {
  return [...entries]
    .sort((a, b) => a.family.localeCompare(b.family) || a.name.localeCompare(b.name))
    .map((e) => `${e.family}: ${e.name}: ${e.summary}`)
    .join('\n');
}
