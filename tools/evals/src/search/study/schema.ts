// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The search ranking study's inputs (IX2-U1): probes with labels that name what the footage is known to contain
 * (`search-study/probes.json`), and the query vectors cached once per embedder (`query-vectors.json`).
 */
import { z } from 'zod';
import { readJson } from '../../files';
import { parseNamed } from '../../schema';
import { searchLanguageSchema } from '../schema';

/** The footage sets the study knows how to label: the bench's ix-v1 and the search eval's synthetic library. */
export const STUDY_SETS = ['ix-v1', 'synthetic-search'] as const;
export type StudySet = (typeof STUDY_SETS)[number];

export const PROBE_KINDS = ['speech', 'on-screen', 'visual', 'description'] as const;
export type ProbeKind = (typeof PROBE_KINDS)[number];

/** ix-v1's shot looks (tools/bench-footage `Look`). */
const lookSchema = z.enum(['fractal', 'pattern', 'life', 'cells', 'gradient', 'pan', 'zoom', 'bars']);

/**
 * What a probe should find, as the footage's makers know it:
 * - `{ clip }` any shot of the clip;
 * - `{ clip, onScreen }` the shots showing that on-screen line, at its planned times;
 * - `{ clip, spokenToo }` any shot of the clip, allowed only when the clip's speech says those words (speech
 *   repeats over the whole clip, so every shot of it is an answer);
 * - `{ look }` every shot planned with that look, in any clip.
 */
export const selectorSchema = z.union([
  z.object({ clip: z.string().min(1), onScreen: z.string().min(1) }).strict(),
  z.object({ clip: z.string().min(1), spokenToo: z.string().min(1) }).strict(),
  z.object({ clip: z.string().min(1) }).strict(),
  z.object({ look: lookSchema }).strict(),
]);
export type Selector = z.infer<typeof selectorSchema>;

export const probeSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    set: z.enum(STUDY_SETS),
    language: searchLanguageSchema,
    kind: z.enum(PROBE_KINDS),
    text: z.string().min(1),
    relevant: z.array(selectorSchema).min(1),
  })
  .strict();
export type StudyProbe = z.infer<typeof probeSchema>;

export const probeFileSchema = z
  .object({ v: z.literal(1), about: z.string(), probes: z.array(probeSchema).min(1) })
  .strict()
  .superRefine((file, ctx) => {
    const seen = new Set<string>();
    for (const [index, probe] of file.probes.entries()) {
      if (seen.has(probe.id))
        ctx.addIssue({ code: 'custom', path: ['probes', index, 'id'], message: 'duplicate id' });
      seen.add(probe.id);
    }
  });

export function loadProbes(path: string): StudyProbe[] {
  return parseNamed(probeFileSchema, readJson(path), path).probes;
}

/** One cached query vector per text, base64 of little-endian float32. */
export const queryVectorFileSchema = z
  .object({
    v: z.literal(1),
    /** The embedding space's index name (e.g. eg2_q4_daa72c5): vectors from another space are not comparable. */
    space: z.string().min(1),
    dimensions: z.int().positive(),
    /** The device that embedded them (coreml, webgpu, cpu). */
    device: z.string().min(1),
    vectors: z.record(z.string(), z.string().min(1)),
  })
  .strict();
export type QueryVectorFile = z.infer<typeof queryVectorFileSchema>;
