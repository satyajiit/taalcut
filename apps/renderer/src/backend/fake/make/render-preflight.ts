// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The export's preflight as far as the fake can know it (render's musicPreflight): a generated-music choice needs
 * its warped FLAC in the media cache. Nothing warps it again when it is gone, so the real export stops at preflight
 * with `render.media_missing` and the person generates the music again; the fake fails the same render the same way.
 * REF1: the reel's music needs the template's kept reel with sound. Without it render stops the same way, naming
 * 'reference audio', with the fix that gets the reel again (packages/render `referenceAudioMissing`).
 */
import type { TaalcutError, TemplateId, Timeline } from '@taalcut/core';

/** Whether the fake's media cache holds this warped music file (export-state.ts's `warpedMusic`). */
export type WarpedMusicCache = (warpedKey: string) => boolean;

/** Whether the template keeps its reel with sound (the fake templates' `media`). */
export type KeptReelMusic = (templateId: TemplateId) => boolean;

/** Why this timeline's export would stop at preflight, or null when it gets past it. */
export function preflightFailure(
  timeline: Timeline,
  warpedMusic: WarpedMusicCache,
  keptReelMusic: KeptReelMusic = () => true,
): TaalcutError | null {
  const music = timeline.music;
  if (music.path === 'referenceAudio')
    return keptReelMusic(music.templateId)
      ? null
      : {
          code: 'render.media_missing',
          messageKey: 'errors.render.media_missing',
          retryable: false,
          params: { name: 'reference audio' },
          fix: {
            command: 'templates.fetchMedia',
            labelKey: 'fix.getReelMedia',
            payload: { id: music.templateId },
          },
        };
  if (music.path !== 'generated' || warpedMusic(music.warpedKey)) return null;
  return {
    code: 'render.media_missing',
    messageKey: 'errors.render.media_missing',
    retryable: false,
    params: { name: 'generated music' },
  };
}
