// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Path d's source (REF1, SPEC section 8): the reel a template keeps on this Mac. The composition root gives the
 * template's kept media and its file's path (core's TemplateMediaStore `get`); this decides what counts. No kept
 * media, a silent reel (`hasAudio` false) or a file that is gone all read as nothing, so an export stops with `render.media_missing`, whose fix fetches the reel again,
 * and a preview plays without the music. Render reads the audio stream of the kept file itself (`[n:a:0]`): its
 * first sample is the beat map's zero, because the breakdown measured both from that file.
 *
 * It also reads the reel's link and its sound's credit from the template version, for the "add this sound in
 * the app" steps.
 */
import { stat } from 'node:fs/promises';
import { z } from 'zod';
import { ok, type AsyncResult, type TemplateMediaStore, type TemplateRef } from '@taalcut/core';
import type { ReferenceAudioSource, ReferenceCredit } from '../ports';

export interface KeptReferenceDeps {
  /** The template's kept media and its file's absolute path; null when it keeps none (TemplateMediaStore's get). */
  readonly kept: TemplateMediaStore['get'];
  /** The template version as stored (its JSON), for the link and the credit. Absent: neither is known. */
  readonly version?: (ref: TemplateRef) => AsyncResult<unknown>;
  /** True when the file is there; default: a regular file on disk. */
  readonly isFile?: (path: string) => Promise<boolean>;
}

const regularFile = async (path: string): Promise<boolean> =>
  (await stat(path).catch(() => null))?.isFile() ?? false;

/** The two facts of a stored template version the steps need; older or odd versions just lack them. */
const creditFields = z.object({
  origin: z.object({ url: z.string().nullable().optional() }).optional(),
  audio: z
    .object({
      sound: z
        .object({ title: z.string().nullable().optional(), artist: z.string().nullable().optional() })
        .nullable()
        .optional(),
    })
    .optional(),
});

const NO_CREDIT: ReferenceCredit = { referenceUrl: null, soundLabel: null };

/** Only an https link goes into the steps; anything else reads as none. */
function httpsLink(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).protocol === 'https:' ? value : null;
  } catch {
    return null;
  }
}

/**
 * The reel's link and the sound's credit ("Title · Artist", or whichever is known) from a stored template version.
 * Both are someone else's text: plain strings, never markup (platformSoundSteps trims the label).
 */
export function referenceCredit(json: unknown): ReferenceCredit {
  const parsed = creditFields.safeParse(json);
  if (!parsed.success) return NO_CREDIT;
  const sound = parsed.data.audio?.sound;
  const parts = [sound?.title, sound?.artist].map((part) => part?.trim() ?? '').filter((part) => part !== '');
  return {
    referenceUrl: httpsLink(parsed.data.origin?.url),
    soundLabel: parts.length > 0 ? parts.join(' · ') : null,
  };
}

export function keptReferenceAudio(deps: KeptReferenceDeps): ReferenceAudioSource {
  const isFile = deps.isFile ?? regularFile;
  const version = deps.version;
  return {
    async file(templateId) {
      const found = await deps.kept(templateId);
      if (!found.ok) return found;
      const kept = found.value;
      if (!kept || !kept.media.hasAudio) return ok(null);
      return ok((await isFile(kept.path)) ? kept.path : null);
    },
    ...(version
      ? {
          async credit(template: TemplateRef): AsyncResult<ReferenceCredit> {
            const stored = await version(template);
            return stored.ok ? ok(referenceCredit(stored.value)) : stored;
          },
        }
      : {}),
  };
}

/** No composition root gave a source: no template's reel is here. */
export const NO_REFERENCE_AUDIO: ReferenceAudioSource = { file: async () => ok(null) };
