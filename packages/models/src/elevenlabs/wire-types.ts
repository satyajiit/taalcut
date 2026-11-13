// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** One request to ElevenLabs as the fetch path takes it, and the answer it gives back. */
import { jsonFromText, type Billed, type GenerationTrace, type TaalcutError } from '@taalcut/core';

export interface WireResponse {
  readonly status: number;
  readonly headers: Headers;
  readonly bytes: Uint8Array;
}

export interface WireCall {
  readonly module: 'voice' | 'music';
  /** The model on the row; endpoints with no model name their API (`api:voices`). */
  readonly model: string;
  readonly method: 'GET' | 'POST' | 'DELETE';
  readonly path: string;
  readonly query?: Readonly<Record<string, string>>;
  readonly json?: unknown;
  readonly form?: FormData;
  /** Bytes a form body puts on the wire (the meter can't size FormData). */
  readonly formBytes?: number;
  /** 404 is success (idempotent deletes). */
  readonly notFoundOk?: boolean;
  /** What the answer billed and cost; absent: a free call. */
  readonly bill?: (response: WireResponse) => { readonly billed?: Billed; readonly costUsd: number };
  readonly signal?: AbortSignal;
  readonly trace?: GenerationTrace;
}

/** How one request ended: an answer the caller reads, or an error. */
export type WireOutcome = { readonly response: WireResponse } | { readonly error: TaalcutError };

/** The answer's JSON; undefined when it isn't JSON, which the caller's schema check reports. */
export function wireJson(response: WireResponse): unknown {
  return jsonFromText(new TextDecoder().decode(response.bytes));
}
