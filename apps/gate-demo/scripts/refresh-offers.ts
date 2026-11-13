// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The pieces of refresh-catalogue.ts that read and rebuild a recorded request: the registry's tools as pi-ai's
 * Anthropic adapter sends them, a skill step's offer rebuilt from its skill's list, the request hashes the cassette
 * matches on, and the recorded calls to tools that changed.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { unwrap, type ToolModule } from '@taalcut/core';
import { openCassette } from '@taalcut/models';
import { createToolRegistry } from '@taalcut/tools';

export interface WireTool {
  readonly name: string;
  readonly description?: string;
  readonly eager_input_streaming?: boolean;
  readonly input_schema?: unknown;
  readonly cache_control?: unknown;
  readonly defer_loading?: boolean;
  readonly strict?: boolean;
}
export type Body = Record<string, unknown> & { tools?: WireTool[] };
export interface Interaction {
  request: { method: string; url: string; match: string; headers: Record<string, string>; body: Body | null };
  response: { status: number; headers: Record<string, string>; chunks: string[] };
}
export interface Tape {
  recordedAt: string;
  note: string;
  interactions: Interaction[];
}

/** The recorder's ignore list (src/recorded-models.ts IGNORED_BODY_FIELDS). */
export const IGNORED_BODY_FIELDS = [
  'prompt_cache_key',
  'metadata',
  'user',
  'session_id',
  'system',
  'messages',
];
const CACHE_MARK = { type: 'ephemeral' };

export const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export const sha = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const readTape = (path: string) => JSON.parse(readFileSync(path, 'utf8')) as Tape;

export interface RegistryTool {
  /** The canonical name (`audio.listen`). */
  readonly tool: string;
  readonly description: string;
  readonly inputSchema: unknown;
  readonly input: { safeParse(value: unknown): { success: boolean } };
}

/**
 * Every registry tool by call name, as pi-ai's Anthropic adapter sends a non-strict tool (anthropic-messages.js
 * convertTools): its description, and of its input schema only type, properties and required.
 */
export function registryWire(modules: readonly ToolModule[]): Map<string, RegistryTool> {
  const registry = unwrap(createToolRegistry(modules));
  const wire = new Map<string, RegistryTool>();
  for (const tool of modules.flatMap((module) => module.tools)) {
    const described = registry.describe(tool.name, tool.version);
    const [loaded] = unwrap(registry.loadSchemas([tool.name]));
    if (!described || !loaded) throw new Error(`${tool.name} is missing from its own registry`);
    const schema = loaded.inputSchema as { properties?: unknown; required?: unknown } | undefined;
    wire.set(described.callName, {
      tool: tool.name,
      description: described.description,
      inputSchema: { type: 'object', properties: schema?.properties ?? {}, required: schema?.required ?? [] },
      input: tool.input,
    });
  }
  return wire;
}

/** A registry tool as pi-ai sends it: its input streamed as it comes (no cache mark: `withCacheMark` places it). */
export const wireTool = (name: string, now: RegistryTool): WireTool => ({
  name,
  description: now.description,
  eager_input_streaming: true,
  input_schema: now.inputSchema,
});

const unmarked = (tool: WireTool): WireTool => {
  const { cache_control: _mark, ...rest } = tool;
  return rest;
};

/** pi-ai's prompt-cache mark: on the last tool it sends, before the deferred placeholder. */
export function withCacheMark(tools: readonly WireTool[]): WireTool[] {
  const plain = tools.map(unmarked);
  const last = plain.findLastIndex((tool) => !tool.defer_loading);
  return plain.map((tool, i) => (i === last ? { ...tool, cache_control: CACHE_MARK } : tool));
}

/**
 * A skill step's request offering `offer` (call names) instead of what it recorded: the agent's own tools before
 * and after it stay, each registry tool is the registry's, and the cache mark moves to the last.
 */
export function rebuiltOffer(
  tools: readonly WireTool[],
  offer: readonly string[],
  wire: ReadonlyMap<string, RegistryTool>,
  isMeta: (name: string) => boolean,
): WireTool[] {
  const head = tools.findIndex((tool) => !isMeta(tool.name));
  const tail = tools.findLastIndex((tool) => !isMeta(tool.name));
  if (head < 0) throw new Error('a skill step offers no registry tool');
  if (tools.slice(head, tail + 1).some((tool) => isMeta(tool.name)))
    throw new Error("the agent's own tools sit among the registry's");
  const registryTools = offer.map((name) => {
    const now = wire.get(name);
    if (!now) throw new Error(`${name} is not in the catalogue`);
    return wireTool(name, now);
  });
  return withCacheMark([...tools.slice(0, head), ...registryTools, ...tools.slice(tail + 1)]);
}

/**
 * Each request's match as @taalcut/models' recorder computes it now, in record mode with each row's stored
 * response as its only upstream. The recorder must give back every body and every reply as they are.
 */
export async function recomputedMatches(tape: Tape, scratch: string, name: string): Promise<string[]> {
  const path = join(scratch, `${name}.matches.json`);
  const queue = tape.interactions.map((row) => row.response);
  const recorder = openCassette({
    path,
    mode: 'record',
    ignoreBodyFields: IGNORED_BODY_FIELDS,
    upstream: async () => {
      const response = queue.shift();
      if (!response) throw new Error(`${name}: the recorder asked for more responses than are stored`);
      return new Response(response.chunks.length > 0 ? response.chunks.join('') : null, {
        status: response.status,
        headers: response.headers,
      });
    },
  });
  for (const row of tape.interactions) {
    const reply = await recorder.fetch(row.request.url, {
      method: row.request.method,
      headers: row.request.headers,
      body: JSON.stringify(row.request.body),
    });
    await reply.text();
  }
  await recorder.save();
  const rerecorded = readTape(path).interactions;
  if (rerecorded.length !== tape.interactions.length) throw new Error(`${name}: the recorder lost a row`);
  return tape.interactions.map((row, i) => {
    const again = rerecorded[i]!;
    if (!same(again.request.body, row.request.body))
      throw new Error(`${name}#${i}: the recorder moved a body`);
    if (!same(again.response.chunks, row.response.chunks)) throw new Error(`${name}#${i}: a reply moved`);
    return again.request.match;
  });
}

/** The recorded calls (tool_use blocks in the stored streams) to `tools`, as valid and invalid against their input. */
export function checkedCalls(
  tape: Tape,
  tools: ReadonlySet<string>,
  wire: ReadonlyMap<string, RegistryTool>,
): { valid: number; invalid: string[] } {
  let valid = 0;
  const invalid: string[] = [];
  tape.interactions.forEach((row, i) => {
    const blocks = new Map<number, { name: string; json: string }>();
    for (const line of row.response.chunks.flatMap((chunk) => chunk.split('\n'))) {
      if (!line.startsWith('data: ')) continue;
      const event = JSON.parse(line.slice(6)) as {
        type?: string;
        index?: number;
        content_block?: { type?: string; name?: string };
        delta?: { type?: string; partial_json?: string };
      };
      if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use')
        blocks.set(event.index ?? -1, { name: event.content_block.name ?? '', json: '' });
      const block = blocks.get(event.index ?? -1);
      if (block && event.type === 'content_block_delta' && event.delta?.type === 'input_json_delta')
        block.json += event.delta.partial_json ?? '';
    }
    for (const block of blocks.values()) {
      const now = wire.get(block.name);
      if (!now || !tools.has(now.tool)) continue;
      if (now.input.safeParse(JSON.parse(block.json || '{}')).success) valid += 1;
      else invalid.push(`#${i} ${now.tool}`);
    }
  });
  return { valid, invalid };
}
