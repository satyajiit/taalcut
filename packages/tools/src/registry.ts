// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The tool registry: modules in, catalogue, search and schemas out. One
 * instance per process, made by the composition root and passed by DI; there
 * is no global registry.
 */
import {
  err,
  ok,
  toolModuleProblems,
  type AnyTool,
  type Result,
  type ToolCostClass,
  type ToolModule,
  type ToolSideEffect,
} from '@taalcut/core';
import { describeTool, toCatalogueEntry, type ToolCatalogueEntry, type ToolDescriptor } from './descriptor';
import { ToolNotFound, ToolRegistrationFailed } from './errors';
import {
  DEFAULT_SCHEMA_TARGET,
  exportToolSchemas,
  type JsonSchemaTarget,
  type ToolJsonSchemas,
  type ToolSchema,
} from './schemas';
import { buildSearchIndex, type SearchIndex } from './search';
import { compareSemver, parseSemver, satisfies } from './semver';

export interface RegisteredTool {
  readonly spec: AnyTool;
  readonly descriptor: ToolDescriptor;
  readonly schemas: ToolJsonSchemas;
}

export interface ToolFilter {
  readonly families?: readonly string[];
  readonly sideEffects?: readonly ToolSideEffect[];
  readonly costClasses?: readonly ToolCostClass[];
}

export interface ToolSearchOptions extends ToolFilter {
  /** Default 8. */
  readonly limit?: number;
}

export interface ToolSearchHit extends ToolCatalogueEntry {
  readonly score: number;
}

/**
 * The read side the agent depends on. It never registers tools, so a tool
 * added in a domain package reaches the agent without any change to it.
 */
export interface ToolCatalogue {
  /** Every tool's compact entry (latest version of each), sorted by name. */
  catalogue(filter?: ToolFilter): ToolCatalogueEntry[];
  /** Ranked by BM25 over name, family, tags, summary and description. */
  search(query: string, options?: ToolSearchOptions): ToolSearchHit[];
  /** Full JSON schemas for the chosen tools only. Accepts names or call names. */
  loadSchemas(names: readonly string[], options?: { target?: JsonSchemaTarget }): Result<ToolSchema[]>;
  /** Metadata for policies (approval, budget, permission). `range` picks a version, e.g. '^1'. */
  describe(name: string, range?: string): ToolDescriptor | undefined;
}

export interface ToolRegistry extends ToolCatalogue {
  /** Checks the whole module first; on any problem nothing is registered and `detail` lists them all. */
  register(module: ToolModule): Result<ToolDescriptor[]>;
  /** Latest version, or the latest in `range`. Accepts names or call names. */
  resolve(name: string, range?: string): RegisteredTool | undefined;
  moduleIds(): string[];
}

const DEFAULT_SEARCH_LIMIT = 8;

/** A registry holding `modules`. Fails if any module fails its checks. */
export function createToolRegistry(modules: readonly ToolModule[] = []): Result<ToolRegistry> {
  const registry = makeRegistry();
  for (const module of modules) {
    const registered = registry.register(module);
    if (!registered.ok) return registered;
  }
  return ok(registry);
}

function makeRegistry(): ToolRegistry {
  const moduleIds = new Set<string>();
  /** Versions of each tool, newest first. */
  const versions = new Map<string, RegisteredTool[]>();
  const callNames = new Map<string, string>();
  const extraSchemas = new Map<string, ToolJsonSchemas>();
  let index: SearchIndex | undefined;

  const latest = () => [...versions.values()].map((list) => list[0]!);
  const resolve = (name: string, range?: string) => {
    const list = versions.get(callNames.get(name) ?? name);
    return range === undefined ? list?.[0] : list?.find((t) => satisfies(t.descriptor.version, range));
  };

  return {
    register(module) {
      const prepared = prepareModule(module, moduleIds);
      if (!prepared.ok) return prepared;
      moduleIds.add(module.id);
      for (const tool of prepared.value) {
        const list = [...(versions.get(tool.descriptor.name) ?? []), tool];
        list.sort((a, b) =>
          compareSemver(parseSemver(b.descriptor.version)!, parseSemver(a.descriptor.version)!),
        );
        versions.set(tool.descriptor.name, list);
        callNames.set(tool.descriptor.callName, tool.descriptor.name);
      }
      index = undefined;
      return ok(prepared.value.map((t) => t.descriptor));
    },

    resolve,
    describe: (name, range) => resolve(name, range)?.descriptor,
    moduleIds: () => [...moduleIds].sort(),

    catalogue(filter) {
      return latest()
        .map((t) => t.descriptor)
        .filter((d) => matches(d, filter))
        .map(toCatalogueEntry)
        .sort((a, b) => a.name.localeCompare(b.name));
    },

    search(query, options = {}) {
      index ??= buildSearchIndex(latest().map((t) => t.descriptor));
      return index
        .search(query)
        .filter((hit) => matches(hit.descriptor, options))
        .slice(0, options.limit ?? DEFAULT_SEARCH_LIMIT)
        .map((hit) => ({ ...toCatalogueEntry(hit.descriptor), score: hit.score }));
    },

    loadSchemas(names, options = {}) {
      const target = options.target ?? DEFAULT_SCHEMA_TARGET;
      const schemas: ToolSchema[] = [];
      for (const name of names) {
        const tool = resolve(name);
        if (!tool) return err(ToolNotFound({ tool: name }));
        const json = schemasFor(tool, target, extraSchemas);
        if (!json.ok) return json;
        const d = tool.descriptor;
        schemas.push({
          name: d.name,
          callName: d.callName,
          version: d.version,
          description: d.description,
          inputSchema: json.value.input,
          outputSchema: json.value.output,
        });
      }
      return ok(schemas);
    },
  };
}

function prepareModule(module: ToolModule, registered: ReadonlySet<string>): Result<RegisteredTool[]> {
  const problems = toolModuleProblems(module);
  if (registered.has(module.id)) problems.push(`module '${module.id}' is already registered`);
  const prepared: RegisteredTool[] = [];
  const seen = new Set<string>();
  for (const spec of module.tools) {
    const version = parseSemver(spec.version);
    if (!version) continue; // toolModuleProblems already reported it.
    const key = `${spec.name}@${version.major}`;
    if (seen.has(key)) problems.push(`${spec.name}: major version ${version.major} is declared twice`);
    seen.add(key);
    const schemas = exportToolSchemas(spec, DEFAULT_SCHEMA_TARGET);
    if (!schemas.ok) {
      problems.push(
        `${spec.name}: schema can't be exported to JSON Schema (${schemas.error.detail ?? 'unknown'})`,
      );
      continue;
    }
    if (schemas.value.input.type !== 'object')
      problems.push(`${spec.name}: input schema must be a z.object()`);
    // Until core's toolSpecProblems has this rule: local-only mode denies by permission.network,
    // so an external tool that says 'none' would slip through it.
    if (spec.sideEffect === 'external' && spec.permission?.network !== 'internet')
      problems.push(`${spec.name}: 'external' tools need permission.network 'internet'`);
    prepared.push({ spec, descriptor: describeTool(spec, module.id), schemas: schemas.value });
  }
  if (problems.length > 0)
    return err(ToolRegistrationFailed({ module: module.id }, { detail: problems.join('\n') }));
  return ok(prepared);
}

function schemasFor(
  tool: RegisteredTool,
  target: JsonSchemaTarget,
  memo: Map<string, ToolJsonSchemas>,
): Result<ToolJsonSchemas> {
  if (target === DEFAULT_SCHEMA_TARGET) return ok(tool.schemas);
  const key = `${tool.descriptor.name}@${tool.descriptor.version}#${target}`;
  const cached = memo.get(key);
  if (cached) return ok(cached);
  const exported = exportToolSchemas(tool.spec, target);
  if (exported.ok) memo.set(key, exported.value);
  return exported;
}

function matches(d: ToolDescriptor, filter: ToolFilter | undefined): boolean {
  if (!filter) return true;
  if (filter.families && !filter.families.includes(d.family)) return false;
  if (filter.sideEffects && !filter.sideEffects.includes(d.sideEffect)) return false;
  if (filter.costClasses && !filter.costClasses.includes(d.costClass)) return false;
  return true;
}
