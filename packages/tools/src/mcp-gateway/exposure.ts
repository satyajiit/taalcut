// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A registry tool as an MCP tool definition (tools SPEC, "Exposure"): the provider-safe call name, the summary as
 * title, the description plus one line per fact that matters to an external agent, the input schema (zod's input
 * side, draft 2020-12), the output schema when its root is an object (MCP requires that for structured results),
 * and all four annotations set explicitly (the spec's defaults are the unsafe ones).
 */
import { MCP_TOOL_NAME_PATTERN, type McpLevel, type McpToolDef } from '@taalcut/core';
import { toCallName } from '../descriptor';
import type { RegisteredTool, ToolCatalogue, ToolRegistry } from '../registry';
import { isExposed, levelAllows, levelNeeded, needsInAppApproval } from './levels';

const MAX_TITLE = 200;
const MAX_DESCRIPTION = 4000;

const APPROVAL_LINE = 'Needs your approval in Taalcut before it runs.';
const PAID_LINE = 'Costs money: Taalcut shows the estimate and asks before it spends.';

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function isObjectSchema(schema: Readonly<Record<string, unknown>>): boolean {
  return schema['type'] === 'object';
}

export function toMcpToolDef(tool: RegisteredTool): McpToolDef {
  const { descriptor, schemas } = tool;
  const facts = [
    ...(needsInAppApproval(descriptor) ? [APPROVAL_LINE] : []),
    ...(descriptor.costClass === 'paid' ? [PAID_LINE] : []),
  ];
  const description = [descriptor.description, ...facts].join('\n\n');
  const readOnly = descriptor.sideEffect === 'read';
  return {
    name: descriptor.callName,
    title: clip(descriptor.summary, MAX_TITLE),
    description: clip(description, MAX_DESCRIPTION),
    inputSchema: { ...schemas.input },
    ...(isObjectSchema(schemas.output) ? { outputSchema: { ...schemas.output } } : {}),
    annotations: {
      readOnlyHint: readOnly,
      destructiveHint: descriptor.sideEffect === 'destructive',
      idempotentHint: readOnly || descriptor.idempotent,
      openWorldHint: descriptor.costClass !== 'local' || descriptor.permission.network === 'internet',
    },
  };
}

/** A registry tool an MCP client may see at all, with the level that lists it. */
export interface ExposedTool {
  readonly tool: RegisteredTool;
  readonly needed: McpLevel;
}

/** Looks a call name up among the exposed tools (hidden tools are unknown here, as to the client). */
export function exposedTool(registry: Pick<ToolRegistry, 'resolve'>, name: string): ExposedTool | undefined {
  if (!MCP_TOOL_NAME_PATTERN.test(name)) return undefined;
  const tool = registry.resolve(name);
  if (!tool || tool.descriptor.callName !== name || !isExposed(tool.descriptor)) return undefined;
  return { tool, needed: levelNeeded(tool.descriptor) };
}

/** Every tool the level lists, sorted by name. */
export function exposedTools(
  registry: Pick<ToolCatalogue, 'catalogue'> & Pick<ToolRegistry, 'resolve'>,
  level: McpLevel,
): McpToolDef[] {
  return registry
    .catalogue()
    .map((entry) => exposedTool(registry, toCallName(entry.name)))
    .filter((exposed): exposed is ExposedTool => exposed !== undefined && levelAllows(level, exposed.needed))
    .map((exposed) => toMcpToolDef(exposed.tool));
}
