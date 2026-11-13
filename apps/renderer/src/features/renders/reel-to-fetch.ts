// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * REF1 (sound's request): when an export's music is the reel's and the template no longer keeps the reel, the
 * export stops at preflight with `render.media_missing` { name: 'reference audio' } and the fix
 * `templates.fetchMedia` { id }. That fix isn't a bus command: the export's end and the chat's runFix call the
 * templates service for it. Its words are `errors.render.media_missing.reference_audio` (render-messages.ts), which
 * the kit's errorMessage picks by `params.name`.
 */
import { idSchema, type FixAction, type TaalcutError, type TemplateId } from '@taalcut/core';

/** The fix render attaches (packages/render `referenceAudioMissing`). */
export const FETCH_MEDIA_FIX = 'templates.fetchMedia';

const templateIdSchema = idSchema<'Template'>();

/** The template whose reel this fix gets again; null for any other fix. */
export function reelOfFix(fix: FixAction | null | undefined): TemplateId | null {
  if (fix?.command !== FETCH_MEDIA_FIX) return null;
  const id = templateIdSchema.safeParse((fix.payload as { id?: unknown } | undefined)?.id);
  return id.success ? id.data : null;
}

/** The template whose reel to get again, when this is the failure; else null. */
export const reelToFetch = (error: TaalcutError | null | undefined): TemplateId | null =>
  reelOfFix(error?.fix);
