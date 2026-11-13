// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What the GeneratedAssetSink accepts (core GeneratedFile), checked at the boundary: a listed media type, a file
 * name the caller made from ids, the project (or null), a provenance that isn't `captured` and, when the
 * generator knows its words, a transcript core's transcriptSchema accepts. The bytes are kept
 * exactly as given, so nothing here reads or changes them beyond their length.
 */
import {
  assetProvenanceSchema,
  err,
  GENERATED_MEDIA_TYPES,
  idSchema,
  ok,
  transcriptSchema,
  rationalTimeSchema,
  ValidationError,
  type AssetKind,
  type GeneratedFile,
  type RecordedFile,
  type GeneratedMediaType,
  type Result,
} from '@taalcut/core';
import { z } from 'zod';

/** Larger than any generated still, line, track or effect; the same ceiling as a stock import. */
export const MAX_GENERATED_BYTES = 500 * 1024 * 1024;

const EXTENSIONS: Readonly<Record<GeneratedMediaType, string>> = {
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/flac': 'flac',
  'audio/ogg': 'ogg',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
};

const fileSchema = z.object({
  mediaType: z.enum(GENERATED_MEDIA_TYPES),
  // Made by the caller from ids; kept as the asset's original name, never used as a path.
  fileName: z
    .string()
    .min(1)
    .max(255)
    .refine((name) => !/[/\\\0]/.test(name) && !name.startsWith('.'), { message: 'not a plain file name' }),
  projectId: idSchema<'Project'>().nullable(),
  provenance: assetProvenanceSchema.refine((provenance) => provenance.kind !== 'captured', {
    message: 'a generated file is never captured',
  }),
  // The generator's exact words (round P3-3); a malformed one is the caller's bug, refused like any field.
  transcript: transcriptSchema.optional(),
});

export function checkGeneratedFile<T extends GeneratedFile | RecordedFile>(
  file: T,
  recorded = false,
): Result<T> {
  if (!(file.bytes instanceof Uint8Array) || file.bytes.byteLength === 0)
    return err(ValidationError({ field: 'bytes' }));
  if (file.bytes.byteLength > MAX_GENERATED_BYTES)
    return err(ValidationError({ field: 'bytes' }, { detail: `${file.bytes.byteLength} bytes` }));
  const schema = recorded
    ? fileSchema.extend({
        mediaType: z.literal('audio/wav'),
        provenance: z.object({ kind: z.literal('captured') }),
        duration: rationalTimeSchema.refine((time) => time.value > 0),
      })
    : fileSchema;
  const parsed = schema.safeParse(file);
  if (!parsed.success) {
    const field = String(parsed.error.issues[0]?.path[0] ?? 'file');
    return err(ValidationError({ field }, { detail: z.prettifyError(parsed.error).slice(0, 2000) }));
  }
  return ok(file);
}

export const extensionOf = (mediaType: GeneratedMediaType): string => EXTENSIONS[mediaType];

export const assetKindOf = (mediaType: GeneratedMediaType): AssetKind =>
  mediaType.startsWith('image/') ? 'image' : mediaType.startsWith('video/') ? 'video' : 'audio';
