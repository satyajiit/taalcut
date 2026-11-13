// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What lane A's listening tools (EAR1-A3) share: their dependencies, a sound to listen to (a library asset or an
 * audio artifact, optionally trimmed) and its resolution into files the jobs process reads (lane B's
 * resolveListenSource: an artifact's copy is removed after the call), and the spilled-output shape. EAR1-G1:
 * `audio.compare` also takes a template's reference reel (`{ templateId }`), the file the template keeps (REF1).
 */
import { z } from 'zod';
import {
  artifactRefSchema,
  err,
  ok,
  SOUND_REALNESS_VERDICTS,
  timeRangeSchema,
  ulidSchema,
  ULID_PATTERN,
  type ArtifactId,
  type ArtifactStore,
  type AssetId,
  type AsyncResult,
  type JobRunner,
  type SoundRealness,
  type TemplateId,
  type TemplateListening,
  type TimeRange,
} from '@taalcut/core';
import type { ListenSourceRef } from '../listen/analysis/queries';
import { ListenBadInput, ListenUnavailable } from '../listen/errors';
import { resolveListenSource, type ListenAssetFiles, type ResolvedSource } from './listen-sources';

export interface ListenQaToolDeps {
  readonly jobs: Pick<JobRunner, 'run'>;
  readonly assets: ListenAssetFiles;
  /** A folder of Taalcut's own where an artifact is copied for the job; each copy is removed after it. */
  readonly scratch: string;
  /** A template's reel as its breakdown heard it (`audio.critique`'s reference profile); null when it has none. */
  readonly templateListening?: (templateId: TemplateId) => AsyncResult<TemplateListening | null>;
  /**
   * EAR1-G1: the file of a template's reference reel (its video with sound) for the jobs process; null when the
   * template keeps none, or a silent one.
   */
  readonly templateReel?: (templateId: TemplateId) => AsyncResult<string | null>;
}

const assetId = ulidSchema('Asset').optional().describe('A library sound');
const artifactId = z
  .string()
  .regex(ULID_PATTERN)
  .optional()
  .describe('Or an audio artifact from an earlier tool');
const range = timeRangeSchema.optional().describe('Only this part of it');

export const listenSourceSchema = z
  .object({ assetId, artifactId, range })
  .refine((input) => (input.assetId === undefined) !== (input.artifactId === undefined), {
    message: 'Give exactly one of assetId and artifactId',
  });

/** EAR1-G1: `audio.compare`'s sound: a listen source, or a template's reference reel. */
export const compareSourceSchema = z
  .object({
    assetId,
    artifactId,
    templateId: ulidSchema('Template')
      .optional()
      .describe("Or a template: the sound of the reference reel it was made from (the project's template)"),
    range,
  })
  .refine(
    (input) =>
      [input.assetId, input.artifactId, input.templateId].filter((id) => id !== undefined).length === 1,
    { message: 'Give exactly one of assetId, artifactId and templateId' },
  );
export interface ListenSourceInput {
  readonly assetId?: AssetId;
  readonly artifactId?: string;
  readonly templateId?: TemplateId;
  readonly range?: TimeRange;
}

export const spilledSchema = z.object({ artifact: artifactRefSchema, summary: z.string() });

/** Realness as the tools hand it back (JSON Schema can show it: no RationalTime windows). */
export const realnessJsonSchema = z.object({
  pReal: z.number().min(0).max(1).nullable().describe('Real recording or pro production; null for silence'),
  verdict: z.enum(SOUND_REALNESS_VERDICTS),
  borderline: z.boolean().optional().describe('Near a threshold: the verdict may read either way'),
});

export function realnessOut(r: SoundRealness | null): z.output<typeof realnessJsonSchema> | null {
  return r ? { pReal: r.pReal, verdict: r.verdict, ...(r.borderline ? { borderline: true } : {}) } : null;
}

/** A template's reference reel, read where the template keeps it (nothing to remove after). */
async function templateReel(
  templateId: TemplateId,
  deps: Pick<ListenQaToolDeps, 'templateReel'>,
): AsyncResult<ResolvedSource> {
  if (!deps.templateReel) return err(ListenUnavailable({ reason: 'no_templates' }));
  const path = await deps.templateReel(templateId);
  if (!path.ok) return path;
  if (!path.value)
    return err(ListenBadInput(undefined, { detail: `template ${templateId} keeps no reel with sound` }));
  return ok({ path: path.value, name: `template ${templateId}'s reel`, done: async () => undefined });
}

/** Every source as a file the jobs process reads, named for results (never a path), and one cleanup for all. */
export async function resolveAll(
  sources: readonly ListenSourceInput[],
  deps: Pick<ListenQaToolDeps, 'assets' | 'scratch' | 'templateReel'>,
  artifacts: ArtifactStore,
): AsyncResult<{ readonly refs: ListenSourceRef[]; done(): Promise<void> }> {
  const cleanups: (() => Promise<void>)[] = [];
  const done = async () => {
    for (const cleanup of cleanups) await cleanup();
  };
  const refs: ListenSourceRef[] = [];
  for (const [i, source] of sources.entries()) {
    const resolved = source.templateId
      ? await templateReel(source.templateId, deps)
      : await resolveListenSource(
          { assetId: source.assetId, artifactId: source.artifactId as ArtifactId | undefined },
          { assets: deps.assets, artifacts, scratch: deps.scratch },
        );
    if (!resolved.ok) {
      await done();
      return resolved;
    }
    cleanups.push(resolved.value.done);
    refs.push({
      path: resolved.value.path,
      name: `${i + 1}: ${resolved.value.name}`.slice(0, 200),
      ...(source.range ? { range: source.range } : {}),
    });
  }
  return ok({ refs, done });
}
