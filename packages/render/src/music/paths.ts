// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The music paths' render side (P2-M10, P3-V6, REF1; SPEC sections 8 and P3.9):
 * preflight finds what the timeline's choice needs on disk before anything
 * renders (path c's warped track, path d's kept reel), and path a's "add this
 * sound in the app" steps.
 *
 * Path d needs no acknowledgement since REF1 (the owner's decision of
 * 2026-10-29): the reel's music is the default. It needs only the reel the
 * template keeps; when that is gone, the error's fix fetches it again.
 */
import {
  err,
  ok,
  platformSoundStepsSchema,
  PLATFORMS,
  type AssetId,
  type AsyncResult,
  type MusicChoice,
  type Platform,
  type PlatformSoundSteps,
  type TemplateId,
  type TaalcutError,
} from '@taalcut/core';
import type { AudioSourceMap } from '../audio/mix-plan';
import { MediaMissing } from '../errors';
import type { ReferenceAudioSource } from '../ports';

export interface MusicPreflightDeps {
  /** Path d: the reel the template keeps (music/reference-audio.ts). */
  readonly referenceAudio: ReferenceAudioSource;
  /** Path b: the user's track on disk. TODO(library): the asset's location. */
  readonly ownTrackPath?: (assetId: AssetId) => AsyncResult<string | null>;
  /**
   * Path c (P3-V6): the warped 48 kHz FLAC the choice names (`warpedKey`, DERIVED_KINDS 'warpedMusic') in the
   * media cache, or null when it was evicted or never made.
   */
  readonly generatedMusic?: (choice: GeneratedMusic) => AsyncResult<string | null>;
}

export type GeneratedMusic = Extract<MusicChoice, { path: 'generated' }>;

/** What the mix needs on disk for the choice. */
export interface MusicFiles {
  readonly ownTrack?: string;
  /** Path d: the kept reel (video and audio); the mix reads its audio stream. */
  readonly reference?: string;
  /** Path c: the warped generated track. */
  readonly generated?: string;
}

/** The music part of the mix's sources, from what preflight found. */
export function musicSources(
  files: MusicFiles,
): Pick<AudioSourceMap, 'ownTrack' | 'reference' | 'generated'> {
  return {
    ...(files.ownTrack ? { ownTrack: { path: files.ownTrack } } : {}),
    ...(files.reference ? { reference: { path: files.reference } } : {}),
    ...(files.generated ? { generated: { path: files.generated } } : {}),
  };
}

/**
 * Fetches a template's reel again (anonymous first) and keeps it: core's `templates.fetchMedia` (REF1), a call on
 * the templates router rather than a bus command, so the window runs it for this fix (`payload` is its input).
 */
export const FETCH_TEMPLATE_MEDIA = 'templates.fetchMedia';

/** The template's reel isn't here (never kept, silent, or deleted): the fix is "Get the reel's video and music". */
export function referenceAudioMissing(templateId: TemplateId): TaalcutError {
  return MediaMissing(
    { name: 'reference audio' },
    { fix: { command: FETCH_TEMPLATE_MEDIA, labelKey: 'fix.getReelMedia', payload: { id: templateId } } },
  );
}

/** The file a lookup found, under `key`, or `missing` (MediaMissing naming it by default). */
async function required(
  name: string,
  key: keyof MusicFiles,
  lookup: AsyncResult<string | null>,
  missing: () => TaalcutError = () => MediaMissing({ name }),
): AsyncResult<MusicFiles> {
  const found = await lookup;
  if (!found.ok) return found;
  return found.value ? ok({ [key]: found.value }) : err(missing());
}

const NOTHING_FOUND: AsyncResult<string | null> = Promise.resolve(ok(null));

/** Checks the choice's preconditions and finds its files. Path a needs nothing and gets nothing. */
export async function musicPreflight(choice: MusicChoice, deps: MusicPreflightDeps): AsyncResult<MusicFiles> {
  switch (choice.path) {
    case 'none':
    case 'platformSound':
      return ok({});
    case 'ownTrack':
      return required('music track', 'ownTrack', deps.ownTrackPath?.(choice.assetId) ?? NOTHING_FOUND);
    case 'referenceAudio':
      return required('reference audio', 'reference', deps.referenceAudio.file(choice.templateId), () =>
        referenceAudioMissing(choice.templateId),
      );
    case 'generated':
      // The warped file is a media-cache entry and nothing warps it again: gone (evicted, never written, a copied
      // library) stops the export here with render.media_missing; generating the music again makes a new one.
      return required('generated music', 'generated', deps.generatedMusic?.(choice) ?? NOTHING_FOUND);
  }
}

/**
 * How many steps each app's "use this sound" flow has. Copy is the UI lane's, under
 * 'music.platformSound.steps.<platform>.<n>' (1-based):
 * - shorts: open the Short in YouTube Studio or the app, add sound, search or open the sound, set it to start at 0;
 * - reels: open the Reel draft, tap audio, search or paste the sound, keep the start at 0;
 * - tiktok: open the draft, tap Add sound, search or open the sound, keep the start at 0.
 */
export const PLATFORM_SOUND_STEP_COUNTS: Readonly<Record<Platform, number>> = {
  shorts: 4,
  reels: 4,
  tiktok: 4,
};

/** Path a's steps for every platform, with the reference's link and sound label when known. */
export function platformSoundSteps(source: {
  readonly referenceUrl: string | null;
  readonly soundLabel: string | null;
}): PlatformSoundSteps {
  return platformSoundStepsSchema.parse({
    referenceUrl: source.referenceUrl,
    // Plain text from the platform's page: trimmed to the contract's limit, never markup.
    soundLabel: source.soundLabel === null ? null : source.soundLabel.slice(0, 200),
    steps: PLATFORMS.map((platform) => ({
      platform,
      stepKeys: Array.from(
        { length: PLATFORM_SOUND_STEP_COUNTS[platform] },
        (_, index) => `music.platformSound.steps.${platform}.${index + 1}`,
      ),
    })),
  });
}
