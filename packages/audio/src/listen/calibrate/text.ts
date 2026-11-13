// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Text embeddings for listening (EAR1-F5, D23), from the banks both CLAP audio builds ship (text-bank.ts), else
 * CLAP's text encoder (installed on demand).
 *
 * - Vocabulary tags (`vocab`, and fixed phrases through `embed`: describe, sections, event tags, realness) use the
 *   fp16-built bank on every machine: on an int8 machine that keeps tag z within ±0.3 of upstream, where the int8
 *   text encoder's own vocabulary drifts up to 0.57.
 * - Free-text queries (`queries`: match, rank, find) use the bank of the installed text model's dtype (before any is
 *   installed, the audio model's) with that same dtype's vocabulary: an int8 query scores closer to upstream against
 *   the int8 vocabulary (p99 0.25) than against the fp16 one (0.29). When the text model that loads changes the
 *   dtype, the vocabulary follows.
 */
import { ok, type AsyncResult } from '@taalcut/core';
import { LISTEN_CONFIG, type ListenDtype } from '../config';
import { createClapText, type ClapTextEncoder } from '../models/clap-text';
import type { ListenModelFiles } from '../models/files';
import type { ListenSessions } from '../models/sessions';
import type { EmbeddedText } from './match';
import { readTextBank, type TextBank } from './text-bank';
import { createVocab, vocabTerms, type ListenVocab } from './vocab';

export interface EmbeddedPhrases {
  readonly rows: readonly Float32Array[];
  readonly dtype: ListenDtype;
  /** True when every row came from the shipped bank (no text model ran). */
  readonly fromBank: boolean;
}

export interface ListenText {
  /** Fixed phrases for tagging, each through `templates` (default: the vocabulary's): the fp16-built bank first. */
  embed(
    phrases: readonly string[],
    templates?: readonly string[],
    signal?: AbortSignal,
  ): AsyncResult<EmbeddedPhrases>;
  /** Free-text queries ready for `scoreQueries`, with the vocabulary of the same text dtype. */
  queries(
    texts: readonly string[],
    signal?: AbortSignal,
  ): AsyncResult<{ queries: EmbeddedText[]; vocab: ListenVocab }>;
  /** The vocabulary for tagging: the fp16-built bank's (else the dtype in use, bank first). */
  vocab(signal?: AbortSignal): AsyncResult<ListenVocab>;
}

export interface ListenTextOptions {
  readonly sessions: ListenSessions;
  readonly files: ListenModelFiles;
  /** Default: CLAP's text encoder on `sessions`. */
  readonly encoder?: ClapTextEncoder;
}

export function createListenText(options: ListenTextOptions): ListenText {
  const encoder = options.encoder ?? createClapText(options.sessions);
  const banks = new Map<ListenDtype, TextBank | undefined>();
  const vocabs = new Map<ListenDtype, ListenVocab>();
  const tagDtype: ListenDtype = LISTEN_CONFIG.calibration.tagBankDtype;
  let tagVocab: ListenVocab | undefined;

  /** The tag bank's rows for these phrases, when it has every one. */
  async function tagRows(
    phrases: readonly string[],
    templates: readonly string[],
    signal?: AbortSignal,
  ): AsyncResult<Float32Array[] | undefined> {
    const bank = await bankFor(tagDtype, signal);
    return bank.ok ? ok(bank.value?.lookup(phrases, templates)) : bank;
  }
  const cache = new Map<string, Float32Array>();

  async function dtypeInUse(signal?: AbortSignal): AsyncResult<ListenDtype> {
    const text = await options.files.installed?.('clapText');
    if (text) return ok(text.dtype);
    const audio = await options.sessions.model('clapAudio', signal);
    return audio.ok ? ok(audio.value.dtype) : audio;
  }

  async function bankFor(dtype: ListenDtype, signal?: AbortSignal): AsyncResult<TextBank | undefined> {
    if (banks.has(dtype)) return ok(banks.get(dtype));
    const audio = await options.sessions.model('clapAudio', signal);
    if (!audio.ok) return audio;
    const read = await readTextBank(audio.value.dir, dtype);
    if (read.ok) banks.set(dtype, read.value);
    return read;
  }

  async function embedWith(
    dtype: ListenDtype,
    phrases: readonly string[],
    templates: readonly string[],
    signal?: AbortSignal,
  ): AsyncResult<EmbeddedPhrases> {
    const bank = await bankFor(dtype, signal);
    if (!bank.ok) return bank;
    const shipped = bank.value?.lookup(phrases, templates);
    if (shipped) return ok({ rows: shipped, dtype, fromBank: true });
    const key = (phrase: string) => `${dtype}\u0000${JSON.stringify(templates)}\u0000${phrase}`;
    const missing = [...new Set(phrases.filter((phrase) => !cache.has(key(phrase))))];
    if (missing.length > 0) {
      const model = await options.sessions.model('clapText', signal);
      if (!model.ok) return model;
      if (model.value.dtype !== dtype) return embedWith(model.value.dtype, phrases, templates, signal);
      const embedded = await encoder.embedPhrases(missing, templates, signal);
      if (!embedded.ok) return embedded;
      missing.forEach((phrase, i) => cache.set(key(phrase), embedded.value[i] ?? new Float32Array()));
    }
    return ok({
      rows: phrases.map((phrase) => cache.get(key(phrase)) ?? new Float32Array()),
      dtype,
      fromBank: false,
    });
  }

  async function vocabFor(dtype: ListenDtype, signal?: AbortSignal): AsyncResult<ListenVocab> {
    const known = vocabs.get(dtype);
    if (known) return ok(known);
    const base = vocabTerms();
    const embedded = await embedWith(dtype, base.terms, base.templates, signal);
    if (!embedded.ok) return embedded;
    const vocab = createVocab(embedded.value.rows, base);
    vocabs.set(embedded.value.dtype, vocab);
    return ok(vocab);
  }

  return {
    async embed(phrases, templates = vocabTerms().templates, signal) {
      const shipped = await tagRows(phrases, templates, signal);
      if (!shipped.ok) return shipped;
      if (shipped.value) return ok({ rows: shipped.value, dtype: tagDtype, fromBank: true });
      const dtype = await dtypeInUse(signal);
      if (!dtype.ok) return dtype;
      return embedWith(dtype.value, phrases, templates, signal);
    },
    async vocab(signal) {
      if (tagVocab) return ok(tagVocab);
      const base = vocabTerms();
      const shipped = await tagRows(base.terms, base.templates, signal);
      if (!shipped.ok) return shipped;
      if (shipped.value) {
        tagVocab = createVocab(shipped.value, base);
        return ok(tagVocab);
      }
      const dtype = await dtypeInUse(signal);
      if (!dtype.ok) return dtype;
      return vocabFor(dtype.value, signal);
    },
    async queries(texts, signal) {
      const dtype = await dtypeInUse(signal);
      if (!dtype.ok) return dtype;
      const embedded = await embedWith(dtype.value, texts, vocabTerms().templates, signal);
      if (!embedded.ok) return embedded;
      const vocab = await vocabFor(embedded.value.dtype, signal);
      if (!vocab.ok) return vocab;
      return ok({
        queries: texts.map((text, i) => ({ text, embedding: embedded.value.rows[i] ?? new Float32Array() })),
        vocab: vocab.value,
      });
    },
  };
}
