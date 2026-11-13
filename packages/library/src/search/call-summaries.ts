// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FIX-TOOLGROUPS: the library tools' words for one call, for people (`ToolSpec.describeCall`): which file it was
 * about, "IMG_0412.MOV · 0:48". File names and clock times only: never a folder, a shot's description, a transcript
 * or on-screen text, and never the model's words.
 */
import { callClock, fileNameOf } from '@taalcut/core';
import type { z } from 'zod';
import type { getAssetOutput } from './asset-tool';
import type { plainTimeSchema } from './tool-schemas';

const SEPARATOR = ' · ';
/** File names a findSimilar summary names before "+N". */
const NAMED_FILES = 2;

const seconds = (time: z.output<typeof plainTimeSchema>): number =>
  (time.value * time.rate.den) / time.rate.num;

/** library.getAsset: the file's name and length, "IMG_0412.MOV · 0:48"; a photo or a file not yet measured: its name. */
export function describeAssetCall(output: z.output<typeof getAssetOutput>): string | undefined {
  const name = fileNameOf(output.asset.fileName);
  if (!name) return undefined;
  const { duration } = output.asset;
  return duration && duration.value > 0 ? `${name}${SEPARATOR}${callClock(seconds(duration))}` : name;
}

/** library.findSimilar: the files its closest shots are in, nearest first, "IMG_0412.MOV, IMG_0419.MOV +3". */
export function describeSimilarCall(output: {
  readonly hits: readonly { readonly fileName: string }[];
}): string | undefined {
  const names = [...new Set(output.hits.map((hit) => fileNameOf(hit.fileName)).filter(Boolean))];
  if (names.length === 0) return undefined;
  const named = names.slice(0, NAMED_FILES).join(', ');
  const more = names.length - NAMED_FILES;
  return more > 0 ? `${named} +${more}` : named;
}
