// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Lists the models a local server has (P1-F4). Ollama's native /api/tags says
 * which models think, call tools or see images, and their context length;
 * other OpenAI-compatible servers (LM Studio, vLLM, llama.cpp) only list ids
 * through /v1/models, so their models get conservative defaults.
 */
import { err, ok, type AsyncResult } from '@taalcut/core';
import { z } from 'zod';
import type { FetchFn } from '../client/http-meter';
import { LocalServerUnreachable } from '../errors';
import { scrubSecrets, scrubUrl } from '../scrub';
import type { LocalModelSpec } from './endpoints';

export type LocalServerKind = 'ollama' | 'openai-compatible';

export interface DiscoverOptions {
  /** The endpoint's base URL including /v1, as in LocalEndpoint. */
  readonly baseUrl: string;
  readonly kind: LocalServerKind;
  readonly fetch?: FetchFn;
  /** Sent as a bearer token, for servers that require one. */
  readonly apiKey?: string;
  readonly signal?: AbortSignal;
  /** Default 5 s; a local server that takes longer is effectively down. */
  readonly timeoutMs?: number;
}

const OllamaTagsSchema = z.object({
  models: z.array(
    z.object({
      model: z.string().min(1),
      details: z.object({ context_length: z.number().int().positive().optional() }).optional(),
      capabilities: z.array(z.string()).optional(),
    }),
  ),
});
const OllamaShowSchema = z.object({
  capabilities: z.array(z.string()).optional(),
  model_info: z.record(z.string(), z.unknown()).optional(),
});
const OpenAIModelsSchema = z.object({ data: z.array(z.object({ id: z.string().min(1) })) });

export async function discoverLocalModels(options: DiscoverOptions): AsyncResult<readonly LocalModelSpec[]> {
  const fetch: FetchFn = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const base = options.baseUrl.replace(/\/+$/, '');
  const endpoint = scrubUrl(base);
  const get = async (url: string, body?: unknown): Promise<unknown> => {
    const signal = AbortSignal.any([
      AbortSignal.timeout(options.timeoutMs ?? 5_000),
      ...(options.signal ? [options.signal] : []),
    ]);
    const response = await fetch(url, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        accept: 'application/json',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} from ${scrubUrl(url)}`);
    return response.json();
  };

  try {
    if (options.kind === 'openai-compatible') {
      const listed = OpenAIModelsSchema.parse(await get(`${base}/models`));
      return ok(listed.data.filter((m) => !/embed/i.test(m.id)).map((m) => ({ id: m.id })));
    }
    const root = base.replace(/\/v1$/, '');
    const tags = OllamaTagsSchema.parse(await get(`${root}/api/tags`));
    const specs: LocalModelSpec[] = [];
    for (const tag of tags.models) {
      let capabilities = tag.capabilities;
      let contextWindow = tag.details?.context_length;
      // Ollama before 0.12 lists no capabilities in /api/tags; /api/show has them.
      if (!capabilities) {
        const shown = OllamaShowSchema.parse(await get(`${root}/api/show`, { model: tag.model }));
        capabilities = shown.capabilities ?? ['completion'];
        contextWindow ??= contextFromModelInfo(shown.model_info);
      }
      if (!capabilities.includes('completion')) continue; // embedding-only models
      specs.push({
        id: tag.model,
        reasoning: capabilities.includes('thinking'),
        vision: capabilities.includes('vision'),
        ...(contextWindow ? { contextWindow } : {}),
      });
    }
    return ok(specs);
  } catch (cause) {
    const detail = cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause);
    // A fetch error can quote the URL or a header; the key the caller passed is known exactly.
    const scrubbed = scrubSecrets(detail, options.apiKey ? [options.apiKey] : []);
    return err(LocalServerUnreachable({ endpoint }, { detail: scrubbed.slice(0, 500) }));
  }
}

function contextFromModelInfo(info: Record<string, unknown> | undefined): number | undefined {
  for (const [key, value] of Object.entries(info ?? {}))
    if (key.endsWith('.context_length') && typeof value === 'number' && value > 0) return value;
  return undefined;
}
