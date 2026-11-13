// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * CLAP's text encoder (EAR1-F4). The tokenizer is RoBERTa's byte-level BPE from the component's `tokenizer.json`
 * (`@huggingface/tokenizers`, `<s> … </s>`). The exported graph takes `input_ids` only, no attention mask, so only
 * strings of the same token length share a run (padding would change the embedding). Each row is made unit length
 * (`Clap.embed_text`); `embedPhrases` is `Vocab.embed_text`: every phrase through every template, the template rows
 * averaged and made unit length again.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Tokenizer } from '@huggingface/tokenizers';
import { CancelledError, err, ok, type AsyncResult } from '@taalcut/core';
import { shareWork, type SharedWork } from '../abort';
import { LISTEN_CONFIG } from '../config';
import { ListenBadInput, ListenFailed } from '../errors';
import { meanUnit, unit } from './clap-audio';
import { floatOutput } from './ort';
import type { ListenSessions } from './sessions';

const { embedDim } = LISTEN_CONFIG.clap;
/** RoBERTa's 514 positions, less the two its position ids skip. */
const MAX_TOKENS = 512;

export interface ClapTextEncoder {
  /** RoBERTa token ids with `<s>` and `</s>`, as `tokenizer(text)['input_ids']`. */
  tokenize(text: string, signal?: AbortSignal): AsyncResult<readonly number[]>;
  /** One unit embedding per string, as given. */
  embedRaw(texts: readonly string[], signal?: AbortSignal): AsyncResult<Float32Array[]>;
  /** Each phrase through every template (`'{}'` marks the phrase), averaged, unit length. */
  embedPhrases(
    phrases: readonly string[],
    templates: readonly string[],
    signal?: AbortSignal,
  ): AsyncResult<Float32Array[]>;
}

export const applyTemplate = (template: string, phrase: string): string => template.split('{}').join(phrase);

export function createClapText(
  sessions: ListenSessions,
  batch: number = LISTEN_CONFIG.sessions.batch,
): ClapTextEncoder {
  /** Read once; every caller waits on its own signal (abort.ts `shareWork`), a failed read is let go. */
  let loaded: SharedWork<Tokenizer> | undefined;

  async function readTokenizer(signal?: AbortSignal): AsyncResult<Tokenizer> {
    const model = await sessions.model('clapText', signal);
    if (!model.ok) return model;
    try {
      const [json, config] = await Promise.all(
        ['tokenizer.json', 'tokenizer_config.json'].map(
          async (file) => JSON.parse(await readFile(join(model.value.dir, file), 'utf8')) as object,
        ),
      );
      return ok(new Tokenizer(json ?? {}, config ?? {}));
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : 'CLAP tokenizer unreadable';
      return err(ListenFailed(undefined, { detail: detail.slice(0, 500) }));
    }
  }

  const tokenizer = (signal?: AbortSignal): AsyncResult<Tokenizer> => {
    if (!loaded || loaded.abandoned) {
      const pending = shareWork((own) => readTokenizer(own));
      loaded = pending;
      void pending.result.then((read) => {
        if (!read.ok && loaded === pending) loaded = undefined;
      });
    }
    return loaded.join(signal);
  };

  async function tokenize(text: string, signal?: AbortSignal): AsyncResult<readonly number[]> {
    const tok = await tokenizer(signal);
    if (!tok.ok) return tok;
    const ids = tok.value.encode(text).ids;
    return ok(ids.length > MAX_TOKENS ? [...ids.slice(0, MAX_TOKENS - 1), ids.at(-1) ?? 2] : ids);
  }

  async function embedRaw(texts: readonly string[], signal?: AbortSignal): AsyncResult<Float32Array[]> {
    const ids: (readonly number[])[] = [];
    for (const text of texts) {
      const tokens = await tokenize(text, signal);
      if (!tokens.ok) return tokens;
      ids.push(tokens.value);
    }
    const byLength = new Map<number, number[]>();
    ids.forEach((row, i) => byLength.set(row.length, [...(byLength.get(row.length) ?? []), i]));
    const out: Float32Array[] = new Array<Float32Array>(texts.length);
    for (const [length, members] of byLength) {
      for (let i = 0; i < members.length; i += batch) {
        if (signal?.aborted) return err(CancelledError());
        const chunk = members.slice(i, i + batch);
        const data = new BigInt64Array(chunk.length * length);
        chunk.forEach((member, j) =>
          (ids[member] ?? []).forEach((id, k) => (data[j * length + k] = BigInt(id))),
        );
        const ran = await sessions.run(
          'clapText',
          { input_ids: { type: 'int64', data, dims: [chunk.length, length] } },
          signal,
        );
        if (!ran.ok) return ran;
        const embeds = floatOutput(ran.value, 'text_embeds');
        if (!embeds || embeds.length < chunk.length * embedDim) {
          return err(ListenFailed(undefined, { detail: 'CLAP text_embeds missing' }));
        }
        chunk.forEach((member, j) => (out[member] = unit(embeds.slice(j * embedDim, (j + 1) * embedDim))));
      }
    }
    return ok(out);
  }

  return {
    tokenize,
    embedRaw,
    async embedPhrases(phrases, templates, signal) {
      if (templates.length === 0) return err(ListenBadInput(undefined, { detail: 'no templates' }));
      const strings = phrases.flatMap((phrase) =>
        templates.map((template) => applyTemplate(template, phrase)),
      );
      const rows = await embedRaw(strings, signal);
      if (!rows.ok) return rows;
      const per = templates.length;
      return ok(phrases.map((_, i) => meanUnit(rows.value.slice(i * per, (i + 1) * per))));
    },
  };
}
