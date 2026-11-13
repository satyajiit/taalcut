// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The `c2pa-sidecar` component's client (SPEC P3.3): `taalcut-c2pa` speaks the mac helper's JSON-lines
 * protocol, one process for reads and signs. Everything it answers is untrusted (manifest text comes from
 * other people's files), so each reply is parsed with zod before anyone reads it.
 */
import type { AsyncResult, Result } from '@taalcut/core';
import type { JsonLineSidecar, JsonValue } from '@taalcut/media';
import { z } from 'zod';
import { parsedAs } from '../validate';

/** The sidecar's version and the c2pa crate it is built on (native/c2pa-sidecar/Cargo.toml pins it). */
export const C2PA_SIDECAR = {
  componentId: 'c2pa-sidecar',
  version: '1.0.0',
  c2pa: '0.91.2',
  binary: 'taalcut-c2pa',
} as const;

export const C2PA_READ_STATES = ['absent', 'valid', 'trusted', 'invalid'] as const;

const text = z.string().max(200);

/** `c2pa.read`'s answer (and `c2pa.sign`'s, for the signed file). */
export const c2paReadSummarySchema = z.object({
  state: z.enum(C2PA_READ_STATES),
  generator: text.nullable(),
  issuer: text.nullable(),
  digitalSourceTypes: z.array(text).max(8),
  actions: z.array(text).max(32),
  actionsV2: z.boolean(),
  ingredients: z.int().nonnegative(),
  /** Each ingredient's relationship and whether it carried its own manifest (titles stay out: untrusted). */
  ingredientDetails: z
    .array(z.object({ relationship: text.nullable(), hasManifest: z.boolean() }))
    .max(32)
    .default([]),
  failures: z.array(text).max(32),
});
export type C2paReadSummary = z.output<typeof c2paReadSummarySchema>;

export const INGREDIENT_RELATIONSHIPS = ['parentOf', 'componentOf', 'inputTo'] as const;
export type IngredientRelationship = (typeof INGREDIENT_RELATIONSHIPS)[number];

/** A source file whose own Content Credentials join the export as an ingredient. */
export interface SignIngredientFile {
  readonly path: string;
  /** 'clip 3', 'voiceover', 'music': never a file name. */
  readonly title: string;
  readonly relationship: IngredientRelationship;
  /** What the manifest's actions name it by. */
  readonly label?: string;
}

/** A manifest definition as the sidecar takes it (manifest.ts builds it). */
export type ManifestDefinition = { readonly [key: string]: JsonValue };

export interface C2paSignRequest {
  /** The finished, progressive MP4. */
  readonly input: string;
  /** A new file next to it; the sidecar writes `<output>.part` and renames. */
  readonly output: string;
  readonly manifest: ManifestDefinition;
  readonly ingredients: readonly SignIngredientFile[];
}

export interface C2paSidecar {
  read(path: string, signal?: AbortSignal): AsyncResult<C2paReadSummary>;
  /** Signs `input` into `output` with the test signer; answers with the signed file's read summary. */
  sign(request: C2paSignRequest, signal?: AbortSignal): AsyncResult<C2paReadSummary>;
  /** Ends the process (it finishes what is in flight). */
  close(): Promise<void>;
}

/** A read covers a whole file: a long one still answers in seconds. Signing hashes it once more. */
const READ_TIMEOUT_MS = 60_000;
const SIGN_TIMEOUT_MS = 5 * 60_000;

const parsed = (value: JsonValue): Result<C2paReadSummary> => parsedAs(c2paReadSummarySchema, value, 'c2pa');

export function createC2paSidecarClient(sidecar: JsonLineSidecar): C2paSidecar {
  return {
    async read(path, signal) {
      const answer = await sidecar.request(
        'c2pa.read',
        { path },
        { timeoutMs: READ_TIMEOUT_MS, ...(signal ? { signal } : {}) },
      );
      return answer.ok ? parsed(answer.value) : answer;
    },
    async sign(request, signal) {
      const params: JsonValue = {
        input: request.input,
        output: request.output,
        manifest: request.manifest,
        ingredients: request.ingredients.map((ingredient) => ({
          path: ingredient.path,
          title: ingredient.title,
          relationship: ingredient.relationship,
          ...(ingredient.label ? { label: ingredient.label } : {}),
        })),
      };
      const answer = await sidecar.request('c2pa.sign', params, {
        timeoutMs: SIGN_TIMEOUT_MS,
        ...(signal ? { signal } : {}),
      });
      return answer.ok ? parsed(answer.value) : answer;
    },
    close: () => sidecar.close(),
  };
}
