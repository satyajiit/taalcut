// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The English for the keys @taalcut/render sends: its error codes, the QA
 * checks and their fixes, the export stages and presets, the render, caption
 * and music commands, the purge job's stage and the Reviewer skill (Phase 3's
 * in render-messages-phase3.ts). Render
 * carries keys, never English (render SPEC section 12), so the renderer owns
 * the words. Explicit ids: the backend names them.
 */
import type { I18n, MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { RENDER_MESSAGES_PHASE3 } from './render-messages-phase3';
import { RENDER_MESSAGES_LISTEN } from './render-messages-listen';

export const RENDER_MESSAGES: readonly MessageDescriptor[] = [
  // Errors (errors.<code>).
  msg({
    id: 'errors.render.timeline_invalid',
    message: 'This edit has something Taalcut can’t export. Undo the last change and try again.',
  }),
  msg({
    id: 'errors.render.unsupported_frame_rate',
    message: 'This frame rate can’t be exported. Use 24, 30 or 60 fps (or 29.97 or 59.94).',
  }),
  msg({
    id: 'errors.render.duration_out_of_range',
    message: 'This video is too long or too short for that platform. Trim it, or pick another export.',
  }),
  msg({
    id: 'errors.render.media_missing',
    message: 'A clip in this video is missing. Reconnect the drive or folder it was on.',
  }),
  // REF1: by what is missing (params.name, spaces as underscores; the kit's errorMessage picks these). A clip's name
  // is its id, so a clip keeps the sentence above.
  msg({
    id: 'errors.render.media_missing.reference_audio',
    message: 'The reel’s music isn’t kept with its template any more. Get it again to export with it.',
  }),
  msg({
    id: 'errors.render.media_missing.generated_music',
    message: 'The music made for this video is gone. Make it again, then export.',
  }),
  msg({
    id: 'errors.render.media_missing.music_track',
    message: 'Your own track’s file is missing. Reconnect the drive or folder it was on.',
  }),
  // REF1: render.media_missing for the reel's music carries this fix (templates.fetchMedia); a chat's error card
  // labels its button from here.
  msg({ id: 'fix.getReelMedia', message: 'Get the reel’s video and music' }),
  msg({
    id: 'errors.render.font_missing',
    message: 'A caption font is missing. Reinstall Taalcut to bring it back.',
  }),
  msg({
    id: 'errors.render.acknowledgement_required',
    message: 'Keeping the reference’s own audio needs your OK first.',
  }),
  msg({
    id: 'errors.render.engine_unavailable',
    message: 'The video engine isn’t installed yet. Taalcut will get it, then try again.',
  }),
  msg({ id: 'errors.render.capture_failed', message: 'A frame couldn’t be drawn. Taalcut will try again.' }),
  msg({
    id: 'errors.render.encode_failed',
    message: 'The video couldn’t be encoded. Try again, and restart your Mac if it keeps happening.',
  }),
  msg({
    id: 'errors.render.disk_full',
    message: 'There isn’t enough free space to export. Free some space and try again.',
  }),
  msg({
    id: 'errors.render.preview_session_expired',
    message: 'The preview was idle and closed. Open it again.',
  }),
  msg({ id: 'errors.render.not_ready', message: 'This export isn’t finished yet.' }),
  msg({
    id: 'errors.render.codec_unavailable',
    message: 'This computer can’t make that video format. Pick another one and export again.',
  }),
  msg({
    id: 'errors.render.qa_not_passed',
    message: 'This export didn’t pass its checks, so it wasn’t saved.',
  }),
  msg({ id: 'errors.render.override_refused', message: 'That check can’t be skipped.' }),
  msg({
    id: 'errors.render.timeline_changed',
    message: 'The video changed after you asked for the export. Export again.',
  }),
  msg({
    id: 'errors.render.qa_rounds_exhausted',
    message: 'Taalcut tried three times to fix this export. Decide what to do with it.',
  }),
  msg({
    id: 'errors.render.loudness_unmeasured',
    message: 'The sound’s loudness couldn’t be measured. Try again.',
  }),

  // QA checks (qa.checks.<id>).
  msg({ id: 'qa.checks.preflightMedia', message: 'All clips are here' }),
  msg({ id: 'qa.checks.preflightFonts', message: 'Caption fonts are intact' }),
  msg({ id: 'qa.checks.rightsReferenceAudio', message: 'Music rights' }),
  msg({ id: 'qa.checks.container', message: 'File type' }),
  msg({ id: 'qa.checks.codec', message: 'Video and audio format' }),
  msg({ id: 'qa.checks.resolution', message: 'Resolution' }),
  msg({ id: 'qa.checks.aspectRatio', message: 'Shape (9:16)' }),
  msg({ id: 'qa.checks.frameRate', message: 'Frame rate' }),
  msg({ id: 'qa.checks.duration', message: 'Length' }),
  msg({ id: 'qa.checks.bitrate', message: 'Quality' }),
  msg({ id: 'qa.checks.blackFrames', message: 'No unexpected black frames' }),
  msg({ id: 'qa.checks.frozenFrames', message: 'No frozen picture' }),
  msg({ id: 'qa.checks.blackBars', message: 'No black bars' }),
  msg({ id: 'qa.checks.avSync', message: 'Sound in sync' }),
  msg({ id: 'qa.checks.beatSync', message: 'Cuts on the beat' }),
  msg({ id: 'qa.checks.loudness', message: 'Loudness' }),
  msg({ id: 'qa.checks.silence', message: 'Sound is there' }),
  msg({ id: 'qa.checks.captionSafeZone', message: 'Captions clear of the app’s buttons' }),
  msg({ id: 'qa.checks.captionOverflow', message: 'Captions fit' }),
  msg({ id: 'qa.checks.captionGlyphs', message: 'Every caption letter shows' }),
  msg({ id: 'qa.checks.captionReadability', message: 'Captions are easy to read' }),

  // QA fixes (qa.fixes.<id>).
  msg({ id: 'qa.fixes.captionStroke', message: 'Outline the captions' }),
  msg({ id: 'qa.fixes.coveringFont', message: 'Use a font with these letters' }),
  msg({ id: 'qa.fixes.editCaptionText', message: 'Edit the caption' }),
  msg({ id: 'qa.fixes.largerCaptions', message: 'Make the captions larger' }),
  msg({ id: 'qa.fixes.lengthen', message: 'Make the video longer' }),
  msg({ id: 'qa.fixes.mediaChanged', message: 'Use the clip as it is now' }),
  msg({ id: 'qa.fixes.moveCaptions', message: 'Move the captions' }),
  msg({ id: 'qa.fixes.moveText', message: 'Move the text' }),
  msg({ id: 'qa.fixes.openOnPicture', message: 'Start on a picture' }),
  msg({ id: 'qa.fixes.rebuildCaptions', message: 'Rebuild the captions' }),
  msg({ id: 'qa.fixes.referenceAudioWarning', message: 'Review the music choice' }),
  msg({ id: 'qa.fixes.relinkMedia', message: 'Find the missing clip' }),
  msg({ id: 'qa.fixes.resyncBeats', message: 'Put cuts back on the beat' }),
  msg({ id: 'qa.fixes.setClipFitCover', message: 'Fill the frame' }),
  msg({ id: 'qa.fixes.shortenText', message: 'Shorten the text' }),
  msg({ id: 'qa.fixes.shrinkCaptions', message: 'Make the captions smaller' }),
  msg({ id: 'qa.fixes.swapFromAlternates', message: 'Swap in another take' }),
  msg({ id: 'qa.fixes.swapOrTrimDark', message: 'Swap or trim the dark part' }),
  msg({ id: 'qa.fixes.swapOrTrimStatic', message: 'Swap or trim the still part' }),
  msg({ id: 'qa.fixes.trimToDuration', message: 'Trim to fit' }),
  msg({ id: 'qa.fixes.usePlatformSound', message: 'Add sound in the app' }),

  // Export stages (render.stage.<stage>).
  msg({ id: 'render.stage.preflight', message: 'Checking clips' }),
  msg({ id: 'render.stage.conforming', message: 'Preparing clips' }),
  msg({ id: 'render.stage.composing', message: 'Laying out' }),
  msg({ id: 'render.stage.capturing', message: 'Exporting' }),
  msg({ id: 'render.stage.mixingAudio', message: 'Mixing sound' }),
  msg({ id: 'render.stage.finishing', message: 'Finishing' }),
  msg({ id: 'render.stage.checking', message: 'Checking the video' }),
  msg({ id: 'render.stage.fixing', message: 'Fixing' }),
  msg({ id: 'jobs.stage.render.purging', message: 'Clearing old export files' }),

  // Presets (render.presets.<id>) and why one can't be used.
  msg({ id: 'render.presets.shorts', message: 'YouTube Shorts' }),
  msg({ id: 'render.presets.reels', message: 'Instagram Reels' }),
  msg({ id: 'render.presets.tiktok', message: 'TikTok' }),
  msg({ id: 'render.presets.device', message: 'Save to this Mac' }),
  msg({ id: 'render.presets.deviceHevc', message: 'Save to this Mac (smaller file)' }),
  msg({ id: 'render.unavailable.frameRate', message: 'Not at this frame rate' }),
  msg({ id: 'render.unavailable.tooLong', message: 'Too long for this platform' }),
  msg({ id: 'render.unavailable.tooShort', message: 'Too short for this platform' }),
  // LNX1-AV1: the AV1 presets and the HEVC choice need the machine's hardware encoder.
  msg({ id: 'render.presets.youtubeAv1', message: 'YouTube Shorts (AV1)' }),
  msg({ id: 'render.presets.deviceAv1', message: 'Save to this computer (AV1)' }),
  msg({
    id: 'render.unavailable.noAv1Encoder',
    message: 'Needs a GPU that encodes AV1 (NVIDIA RTX 40 series or newer)',
    comment: 'AV1 is a video format; NVIDIA RTX 40 is a product name: keep as written.',
  }),
  msg({
    id: 'render.unavailable.noHevcEncoder',
    message: 'Needs a GPU that encodes HEVC',
    comment: 'HEVC is a video format.',
  }),

  // Commands (commands.<name>).
  msg({ id: 'commands.render.export', message: 'Export' }),
  msg({ id: 'commands.render.cancel', message: 'Stop the export' }),
  msg({ id: 'commands.render.setNotify', message: 'Notify me when it’s done' }),
  msg({ id: 'commands.render.setExportPreset', message: 'Choose where to export' }),
  msg({ id: 'commands.render.overrideQa', message: 'Export anyway' }),
  msg({ id: 'commands.render.delete', message: 'Delete the export' }),
  msg({ id: 'commands.render.restore', message: 'Bring the export back' }),
  msg({ id: 'commands.captions.setEnabled', message: 'Turn captions on or off' }),
  msg({ id: 'commands.captions.editText', message: 'Edit a caption' }),
  msg({ id: 'commands.captions.setStyle', message: 'Change the caption style' }),
  msg({ id: 'commands.captions.rebuild', message: 'Rebuild the captions' }),
  msg({ id: 'commands.captions.restore', message: 'Restore the captions' }),
  msg({ id: 'commands.music.openReferenceAudioWarning', message: 'Review keeping the reference’s audio' }),

  // Path a: adding the sound in each app (music.platformSound.steps.<platform>.<n>).
  msg({ id: 'music.platformSound.steps.shorts.1', message: 'Upload the video in the YouTube app.' }),
  msg({ id: 'music.platformSound.steps.shorts.2', message: 'Tap Sound before you post.' }),
  msg({ id: 'music.platformSound.steps.shorts.3', message: 'Search for the track and pick it.' }),
  msg({ id: 'music.platformSound.steps.shorts.4', message: 'Set where it starts, then post.' }),
  msg({
    id: 'music.platformSound.steps.reels.1',
    message: 'Start a new Reel in Instagram and pick this video.',
  }),
  msg({ id: 'music.platformSound.steps.reels.2', message: 'Tap the music note.' }),
  msg({ id: 'music.platformSound.steps.reels.3', message: 'Search for the track and pick it.' }),
  msg({ id: 'music.platformSound.steps.reels.4', message: 'Set where it starts, then share.' }),
  msg({ id: 'music.platformSound.steps.tiktok.1', message: 'Upload the video in TikTok.' }),
  msg({ id: 'music.platformSound.steps.tiktok.2', message: 'Tap Add sound.' }),
  msg({ id: 'music.platformSound.steps.tiktok.3', message: 'Search for the track and pick it.' }),
  msg({ id: 'music.platformSound.steps.tiktok.4', message: 'Trim where it starts, then post.' }),

  // Skills.
  msg({ id: 'skills.render.reviewer', message: 'Check the finished video' }),
  // HFW1: the Designer's step, after the Editor's, that designs the graphics asked for.
  msg({ id: 'skills.render.designer', message: 'Design the motion graphics' }),
];

const BY_ID: ReadonlyMap<string, MessageDescriptor> = new Map(
  [...RENDER_MESSAGES, ...RENDER_MESSAGES_PHASE3, ...RENDER_MESSAGES_LISTEN].flatMap((descriptor) =>
    descriptor.id ? [[descriptor.id, descriptor] as const] : [],
  ),
);

/** The words for a render key, or `fallback` for a key this file doesn't know. */
export function renderText(i18n: I18n, key: string, fallback: MessageDescriptor): string {
  return i18n._(BY_ID.get(key) ?? fallback);
}
