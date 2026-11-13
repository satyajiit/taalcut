// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * defineTool(), defineToolModule() and the metadata checks the registry runs
 * at registration. The checks live here so a domain package can assert in its
 * own tests that its tools are well formed, without importing @taalcut/tools.
 */
import type { z } from 'zod';
import {
  TOOL_COST_CLASSES,
  TOOL_FS_SCOPES,
  TOOL_SIDE_EFFECTS,
  toolNeedsApproval,
  type AnyTool,
  type ToolPermission,
  type ToolRetryPolicy,
  type ToolSpec,
} from './contract';

/**
 * Identity helper that infers the input, output and command types, so `run`
 * gets typed `input` and a `ctx.dispatch` only when `command` is set.
 *
 *   export const probe = defineTool({
 *     name: 'media.probe', version: '1.0.0', description: '...',
 *     input: z.object({ path: z.string() }), output: probeResultSchema,
 *     costClass: 'local', sideEffect: 'read', timeoutMs: 30_000, retry: NO_TOOL_RETRY,
 *     run: async (input, ctx) => ok(await prober.probe(input.path, ctx.signal)),
 *   });
 */
export function defineTool<
  I extends z.ZodType,
  O extends z.ZodType,
  const C extends string | undefined = undefined,
>(spec: ToolSpec<I, O, C>): ToolSpec<I, O, C> {
  return spec;
}

/**
 * What a domain package exports: plain data, no side effects on import and no
 * global registry. Packages whose tools need services export a factory that
 * takes those services and returns a ToolModule; the composition root calls it.
 */
export interface ToolModule {
  /** Lowercase module id, also the name prefix of every tool in it, e.g. 'media'. */
  readonly id: string;
  readonly tools: readonly AnyTool[];
}

export function defineToolModule(module: ToolModule): ToolModule {
  return module;
}

export const TOOL_NAME_PATTERN = /^[a-z][a-zA-Z0-9]*\.[a-z][a-zA-Z0-9]*$/;
export const TOOL_MODULE_ID_PATTERN = /^[a-z][a-z0-9]*$/;
const COMMAND_PATTERN = /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/;
const FAMILY_PATTERN = /^[a-z][a-z0-9-]*$/;
const TAG_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-.]+)?$/;
/** Model providers cap function names at 64 characters. */
const MAX_NAME_LENGTH = 64;
const MAX_SUMMARY_LENGTH = 120;

/** The routing family: the explicit one, or the name's prefix ('media' for 'media.probe'). */
export function toolFamily(tool: Pick<AnyTool, 'name' | 'family'>): string {
  return tool.family ?? tool.name.split('.')[0] ?? tool.name;
}

/** The one-line summary for the catalogue: the explicit one, or the description's first sentence. */
export function toolSummary(tool: Pick<AnyTool, 'summary' | 'description'>): string {
  if (tool.summary !== undefined) return tool.summary;
  const text = tool.description.trim().replace(/\s+/g, ' ');
  const end = text.search(/[.!?](\s|$)/);
  return end === -1 ? text : text.slice(0, end + 1);
}

/**
 * Everything wrong with a tool's metadata, as developer-facing messages. An
 * empty list means the tool can be registered. The rules encode PRD 7.2 and
 * AGENTS.md: state changes go through commands, retries need idempotency,
 * cloud calls declare their cost.
 */
export function toolSpecProblems(tool: AnyTool): string[] {
  const problems: string[] = [];
  const add = (message: string) => problems.push(`${tool.name || '<unnamed>'}: ${message}`);

  if (!TOOL_NAME_PATTERN.test(tool.name) || tool.name.length > MAX_NAME_LENGTH) {
    add(`name must look like 'family.camelCase' and be at most ${MAX_NAME_LENGTH} characters`);
  }
  if (!SEMVER_PATTERN.test(tool.version)) add(`version '${tool.version}' is not semver (x.y.z)`);
  if (tool.description.trim().length === 0) add('description is empty');
  const summary = toolSummary(tool);
  if (summary.length === 0 || summary.length > MAX_SUMMARY_LENGTH || summary.includes('\n')) {
    add(`summary must be one line of 1-${MAX_SUMMARY_LENGTH} characters`);
  }
  if (tool.family !== undefined && !FAMILY_PATTERN.test(tool.family))
    add('family must be lowercase kebab-case');
  for (const tag of tool.tags ?? [])
    if (!TAG_PATTERN.test(tag)) add(`tag '${tag}' must be lowercase kebab-case`);
  if (!TOOL_COST_CLASSES.includes(tool.costClass)) add(`unknown cost class '${tool.costClass}'`);
  if (!TOOL_SIDE_EFFECTS.includes(tool.sideEffect)) add(`unknown side-effect level '${tool.sideEffect}'`);
  if (!Number.isInteger(tool.timeoutMs) || tool.timeoutMs <= 0) add('timeoutMs must be a positive integer');
  problems.push(...retryProblems(tool.retry).map((m) => `${tool.name}: ${m}`));
  problems.push(...permissionProblems(tool.permission).map((m) => `${tool.name}: ${m}`));

  const changesState = tool.sideEffect !== 'read';
  if (tool.command !== undefined) {
    if (!COMMAND_PATTERN.test(tool.command)) add(`command '${tool.command}' is not a command name`);
    if (!changesState) add("a tool that dispatches a command can't be 'read'");
  } else if (tool.sideEffect === 'write' || tool.sideEffect === 'destructive') {
    add(`'${tool.sideEffect}' tools must wrap a command on the command bus (set 'command')`);
  }
  if (changesState && typeof tool.idempotencyKey !== 'function') {
    add('tools that change state must declare idempotencyKey(input)');
  }
  if (tool.cache && changesState) add("only 'read' tools can be cached");
  if (tool.savesProgress && tool.cache) add("a tool that saves progress can't be cached");
  if (tool.alwaysAsk && !changesState) add("alwaysAsk is for tools that change state, not 'read' ones");
  if (tool.costClass !== 'local') {
    if (typeof tool.estimateCost !== 'function')
      add(`'${tool.costClass}' tools must declare estimateCost(input)`);
    if (tool.permission?.network !== 'internet')
      add(`'${tool.costClass}' tools need permission.network 'internet'`);
  }
  if (tool.refineCost !== undefined && typeof tool.estimateCost !== 'function')
    add('refineCost(input, ctx) narrows estimateCost(input): declare both');
  if (typeof tool.run !== 'function') add('run is not a function');
  if (tool.approvalCard !== undefined && !toolNeedsApproval(tool) && !tool.checkpoint)
    add('approvalCard is only for tools that ask: destructive, external or checkpoint');
  return problems;
}

/** Problems with a module and every tool in it. Tool names must start with the module id. */
export function toolModuleProblems(module: ToolModule): string[] {
  const problems: string[] = [];
  if (!TOOL_MODULE_ID_PATTERN.test(module.id)) {
    problems.push(`module '${module.id}': id must be lowercase letters and digits`);
  }
  if (module.tools.length === 0) problems.push(`module '${module.id}': has no tools`);
  for (const tool of module.tools) {
    if (!tool.name.startsWith(`${module.id}.`))
      problems.push(`${tool.name}: name must start with '${module.id}.'`);
    problems.push(...toolSpecProblems(tool));
  }
  return problems;
}

function retryProblems(retry: ToolRetryPolicy | undefined): string[] {
  if (!retry) return ['retry policy is missing (use NO_TOOL_RETRY)'];
  const problems: string[] = [];
  if (!Number.isInteger(retry.maxAttempts) || retry.maxAttempts < 1 || retry.maxAttempts > 10) {
    problems.push('retry.maxAttempts must be an integer from 1 to 10');
  }
  if (!(retry.initialDelayMs >= 0)) problems.push('retry.initialDelayMs must be 0 or more');
  if (retry.maxDelayMs !== undefined && !(retry.maxDelayMs >= retry.initialDelayMs)) {
    problems.push('retry.maxDelayMs must be at least initialDelayMs');
  }
  if (retry.factor !== undefined && !(retry.factor >= 1)) problems.push('retry.factor must be 1 or more');
  return problems;
}

function permissionProblems(permission: ToolPermission | undefined): string[] {
  if (!permission) return [];
  const problems: string[] = [];
  const scopes = [...(permission.filesystem?.read ?? []), ...(permission.filesystem?.write ?? [])];
  for (const scope of scopes) {
    if (!TOOL_FS_SCOPES.includes(scope)) problems.push(`unknown filesystem scope '${scope}'`);
  }
  if ((permission.cloudModules?.length ?? 0) > 0 && permission.network !== 'internet') {
    problems.push("cloudModules need permission.network 'internet'");
  }
  return problems;
}
