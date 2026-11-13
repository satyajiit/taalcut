// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Build time (tools/components/listen/build-text-embeddings.mjs): every phrase set through one text build, into the
 * bank format of text-bank.ts. The runtime lookups and this share the phrase lists (phrase-sets.ts), so a bank always
 * answers what the code asks for.
 */
import { ok, type AsyncResult } from '@taalcut/core';
import type { ListenDtype } from '../config';
import type { ClapTextEncoder } from '../models/clap-text';
import { listenPhraseSets } from './phrase-sets';
import { encodeTextBank, type TextBankIndex, type TextBankSet } from './text-bank';

/** The checkpoint the banks describe: the upstream weights and Xenova's export (tools/components/listen/README.md). */
export const TEXT_BANK_MODEL = 'laion/larger_clap_general@16c8cc31 (Xenova/larger_clap_general@d78c3994)';

export async function buildTextBank(
  encoder: ClapTextEncoder,
  dtype: ListenDtype,
  signal?: AbortSignal,
): AsyncResult<{ index: TextBankIndex; data: Uint8Array }> {
  const sets: TextBankSet[] = [];
  for (const set of listenPhraseSets()) {
    const rows = await encoder.embedPhrases(set.phrases, set.templates, signal);
    if (!rows.ok) return rows;
    sets.push({ ...set, rows: rows.value });
  }
  const textComponent = dtype === 'fp16' ? 'clap-general-text-fp16' : 'clap-general-text';
  return ok(encodeTextBank({ model: TEXT_BANK_MODEL, textComponent, dtype }, sets));
}
