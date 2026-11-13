// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Select exact JSON subtrees before paging; byte boundaries never split a UTF-8 character. */
import { isId, type ArtifactId, type ArtifactStore } from '@taalcut/core';
import { z } from 'zod';
import { textTokens } from './context/compaction';
import { wrapUntrusted } from './prompt';

const PAGE_BYTES = 8 * 1024;
export const readInput = z.object({
  id: z.string().describe('Artifact id or result:turn:call handle from a tool result'),
  path: z
    .string()
    .optional()
    .describe('JSON Pointer selecting exact data, e.g. /rerank/0; empty selects root'),
  offset: z.number().int().nonnegative().default(0),
  limit: z.number().int().positive().max(PAGE_BYTES).default(PAGE_BYTES),
});

export interface ReaderDeps {
  readonly artifacts?: ArtifactStore;
  readonly loggedResult?: (id: string) => { readonly value: unknown } | undefined;
  readonly pageTokens?: number;
  readonly noArtifact: (id: string) => string;
}

type Outcome =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly code: string; readonly detail: string };
type Refused = Extract<Outcome, { ok: false }>;
const refused = (code: string, detail: string): Refused => ({ ok: false, code, detail });

export async function readArtifact(input: z.output<typeof readInput>, deps: ReaderDeps): Promise<Outcome> {
  const source = await readBytes(input.id, deps);
  if (!source.ok) return source;
  let bytes = source.value;
  if (input.path !== undefined) {
    let value: unknown;
    try {
      value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } catch {
      return refused('tools.invalid_input', 'JSON Pointer selection requires valid UTF-8 JSON.');
    }
    const selected = select(value, input.path);
    if (!selected.ok) return selected;
    bytes = new TextEncoder().encode(JSON.stringify(selected.value) ?? 'null');
  }
  return pageResult(bytes, input, deps.pageTokens, source.logged && deps.pageTokens !== undefined);
}

async function readBytes(
  id: string,
  deps: ReaderDeps,
): Promise<{ ok: true; value: Uint8Array; logged: boolean } | Refused> {
  const logged = deps.loggedResult?.(id);
  if (logged)
    return {
      ok: true,
      value: new TextEncoder().encode(JSON.stringify(logged.value) ?? 'null'),
      logged: true,
    };
  if (!isId(id)) return refused('core.not_found', deps.noArtifact(id));
  if (!deps.artifacts) return refused('tools.service_unavailable', 'No artifact store.');
  const stored = await deps.artifacts.get(id as ArtifactId);
  return stored.ok
    ? { ok: true, value: stored.value.data, logged: false }
    : refused(stored.error.code, deps.noArtifact(id));
}

function pageResult(
  bytes: Uint8Array,
  input: z.output<typeof readInput>,
  pageTokens?: number,
  boundedRoot = false,
): Outcome {
  // Legacy artifact and unmeasured raw pages keep their exact byte-slice contract. Resolved log results use the
  // measured page cap without a selector, so omitting path cannot refill an oversized prompt; a stored artifact's
  // raw page does too once it is larger than that cap. 0.1.0-beta.1's installed run: the 4B read the Maker's stored
  // timeline with no path, the 8,192-byte page could not fit the 12,288-token window, and the make ended there
  // with models.context_too_long.
  if (input.path === undefined && !boundedRoot) {
    const end = Math.min(bytes.length, input.offset + input.limit);
    const page = new TextDecoder().decode(bytes.subarray(input.offset, input.offset + input.limit));
    if (pageTokens === undefined || textTokens(page) <= pageTokens)
      return {
        ok: true,
        text: `Bytes ${input.offset}-${end} of ${bytes.length}.\n${wrapUntrusted(page, 'artifact')}`,
      };
  }
  if (input.offset > bytes.length || continuation(bytes[input.offset]))
    return refused('tools.invalid_input', 'offset must be a UTF-8 character boundary within the result.');
  let end = Math.min(bytes.length, input.offset + input.limit);
  while (end > input.offset && continuation(bytes[end])) end--;
  const decode = () => new TextDecoder().decode(bytes.subarray(input.offset, end));
  let page = decode();
  while (pageTokens !== undefined && textTokens(page) > pageTokens && end > input.offset) {
    end--;
    while (end > input.offset && continuation(bytes[end])) end--;
    page = decode();
  }
  if (end === input.offset && end < bytes.length)
    return refused('tools.invalid_input', 'limit must allow at least one complete UTF-8 character.');
  const selected = input.path === undefined ? '' : `JSON Pointer ${metadata(input.path)} from ${input.id}.\n`;
  return {
    ok: true,
    text: `${selected}Bytes ${input.offset}-${end} of ${bytes.length}.\n${wrapUntrusted(page, 'artifact')}`,
  };
}

const continuation = (byte: number | undefined) => byte !== undefined && (byte & 0xc0) === 0x80;
const metadata = (value: string) => JSON.stringify(value).replaceAll('<', '\\u003c');

function select(value: unknown, path: string): { ok: true; value: unknown } | Refused {
  // "/" names the member with an empty key. Models write it for the root; where no such member exists it is the root.
  const root = path === '/' && !(value !== null && typeof value === 'object' && Object.hasOwn(value, ''));
  if (path === '' || root) return { ok: true, value };
  if (!path.startsWith('/') || /~(?![01])/u.test(path))
    return refused('tools.invalid_input', 'path must be a JSON Pointer, with ~0 for ~ and ~1 for /.');
  for (const encoded of path.slice(1).split('/')) {
    const key = encoded.replace(/~1/g, '/').replace(/~0/g, '~');
    if (
      value === null ||
      typeof value !== 'object' ||
      !Object.hasOwn(value, key) ||
      (Array.isArray(value) && !/^(0|[1-9]\d*)$/u.test(key))
    )
      return refused('core.not_found', `JSON Pointer ${metadata(path)} does not exist.`);
    value = (value as Record<string, unknown>)[key];
  }
  return { ok: true, value };
}
