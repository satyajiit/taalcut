// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';

/**
 * The words for the errors reading and making pictures and sound can end with (@taalcut/media, @taalcut/audio and
 * @taalcut/vision): what happened, then what to do. FIX-ERRWORDS: these showed "Something went wrong"
 * (apps/desktop's error-words test checks every code has words). No tool names: FFmpeg, ONNX and the helpers are
 * "video tools", "on-device models" and "a helper". `name` and `path` parameters can be paths, so none is shown.
 */
export const MEDIA_ERROR_WORDS: Readonly<Record<string, MessageDescriptor>> = {
  // @taalcut/media
  'errors.media.ffmpeg_not_found': msg({
    id: 'errors.media.ffmpeg_not_found',
    message: 'Taalcut’s video tools are missing. Reinstall Taalcut.',
  }),
  'errors.media.ffmpeg_licence_rejected': msg({
    id: 'errors.media.ffmpeg_licence_rejected',
    message:
      'Taalcut’s video tools aren’t the version it ships with, so it won’t use them. Reinstall Taalcut.',
  }),
  'errors.media.ffmpeg_build_mismatch': msg({
    id: 'errors.media.ffmpeg_build_mismatch',
    message: 'Taalcut’s video tools are damaged or the wrong version. Reinstall Taalcut.',
  }),
  'errors.media.ffmpeg_failed': msg({
    id: 'errors.media.ffmpeg_failed',
    message: 'The video tools couldn’t work with this file. Try again, or try another clip.',
  }),
  'errors.media.spawn_failed': msg({
    id: 'errors.media.spawn_failed',
    message: 'Taalcut couldn’t start its video tools. Quit some other apps, then try again.',
  }),
  'errors.media.no_encoder': msg({
    id: 'errors.media.no_encoder',
    message: 'Taalcut can’t make that kind of video file here. Pick another format, then export again.',
  }),
  'errors.media.cancelled': msg({
    id: 'errors.media.cancelled',
    message: 'The video work stopped before it finished.',
  }),
  'errors.media.timeout': msg({
    id: 'errors.media.timeout',
    message: 'The video work took too long and was stopped. Try again.',
  }),
  'errors.media.output_too_large': msg({
    id: 'errors.media.output_too_large',
    message: 'This file gave back more than Taalcut can read at once. Try another clip.',
  }),
  'errors.media.cache_unavailable': msg({
    id: 'errors.media.cache_unavailable',
    message:
      'Taalcut couldn’t reach the folder where it keeps previews. If it’s on a drive, plug the drive in, then try again.',
  }),
  'errors.media.cache_pinned_over_cap': msg({
    id: 'errors.media.cache_pinned_over_cap',
    message:
      'The previews in use right now take more space than Taalcut sets aside for them. Let the current work finish, then try again.',
  }),
  'errors.media.onnx_unavailable': msg({
    id: 'errors.media.onnx_unavailable',
    message: 'A part that on-device models need isn’t downloaded yet. Try again once downloads finish.',
  }),
  'errors.media.onnx_failed': msg({
    id: 'errors.media.onnx_failed',
    message: 'An on-device model stopped while it was working. Try again.',
  }),
  'errors.media.sidecar_failed': msg({
    id: 'errors.media.sidecar_failed',
    message: 'A helper Taalcut uses stopped unexpectedly. Try again.',
  }),
  'errors.media.sidecar_rejected': msg({
    id: 'errors.media.sidecar_rejected',
    message: 'A helper Taalcut uses couldn’t do that with this file. Try another clip.',
  }),
  'errors.media.sidecar_not_found': msg({
    id: 'errors.media.sidecar_not_found',
    message: 'A helper Taalcut needs is missing. Reinstall Taalcut.',
  }),
  'errors.media.sidecar_pin_mismatch': msg({
    id: 'errors.media.sidecar_pin_mismatch',
    message: 'A helper Taalcut needs doesn’t match this version, so it didn’t run. Reinstall Taalcut.',
  }),
  'errors.media.still_unreadable': msg({
    id: 'errors.media.still_unreadable',
    message: 'Taalcut couldn’t read this picture. It may be damaged, or in a format Taalcut doesn’t know.',
  }),

  // @taalcut/audio: speech, beats, music, sound effects and voice-overs.
  'errors.audio.no_audio': msg({
    id: 'errors.audio.no_audio',
    message: 'This clip has no sound to work with.',
  }),
  'errors.audio.model_missing': msg({
    id: 'errors.audio.model_missing',
    message: 'A sound model Taalcut needs isn’t downloaded yet. Try again once downloads finish.',
  }),
  'errors.audio.language_detect_failed': msg({
    id: 'errors.audio.language_detect_failed',
    message: 'Couldn’t tell which language is spoken. Try again, or choose the language yourself.',
  }),
  'errors.audio.transcription_failed': msg({
    id: 'errors.audio.transcription_failed',
    message: 'Couldn’t turn the speech into text. Try again.',
  }),
  'errors.audio.no_transcript': msg({
    id: 'errors.audio.no_transcript',
    message: 'This clip’s speech isn’t written out yet. Wait for indexing to finish, then try again.',
  }),
  'errors.audio.vad_failed': msg({
    id: 'errors.audio.vad_failed',
    message: 'Couldn’t find where people speak in this clip. Try again.',
  }),
  'errors.audio.beat_tracking_failed': msg({
    id: 'errors.audio.beat_tracking_failed',
    message: 'Couldn’t find the beats in this music. Try again, or pick another track.',
  }),
  'errors.audio.write_failed': msg({
    id: 'errors.audio.write_failed',
    message: 'Couldn’t save the sound file. Check the disk has space, then try again.',
  }),
  'errors.audio.generation_failed': msg({
    id: 'errors.audio.generation_failed',
    message: 'Couldn’t make that sound. Try again.',
  }),
  // Core's GENERATION_UNAVAILABLE_REASONS: a voice-over, a music track or a sound that can't be made now.
  'errors.audio.voice_unavailable': msg({
    id: 'errors.audio.voice_unavailable',
    message:
      '{reason, select, local_only {Local only is on, so Taalcut can’t make this with a cloud service. Turn it off in Settings › Privacy to make it.} not_configured {Add an ElevenLabs or OpenAI key in Settings › Accounts to make voice-overs and music.} no_model {No model is set for this. Pick one in Settings › Models.} plan_required {Your plan with that service doesn’t include this. Upgrade it, or add another service in Settings › Accounts.} other {Taalcut can’t make this right now. Try again later.}}',
  }),
  'errors.audio.loudness_failed': msg({
    id: 'errors.audio.loudness_failed',
    message: 'Couldn’t measure how loud the sound is. Try again.',
  }),
  'errors.audio.ducking_unmet': msg({
    id: 'errors.audio.ducking_unmet',
    message:
      'The voice can’t stay clearly above the music, even with the music turned right down. Pick quieter music, or record the voice louder.',
  }),
  'errors.audio.music_off_grid': msg({
    id: 'errors.audio.music_off_grid',
    message:
      'The new music doesn’t land on the cuts. Keep the track, and Taalcut moves the cuts to its beats.',
  }),
  'errors.audio.warp_out_of_range': msg({
    id: 'errors.audio.warp_out_of_range',
    message: 'The music would have to stretch too far to fit the beats. Pick another track.',
  }),
  'errors.audio.music_library_empty': msg({
    id: 'errors.audio.music_library_empty',
    message: 'There’s no music to choose from yet. Try again once the music pack has downloaded.',
  }),
  'errors.audio.music_track_unknown': msg({
    id: 'errors.audio.music_track_unknown',
    message: 'That track isn’t in the music library any more. Pick another.',
  }),
  'errors.audio.sfx_pack_missing': msg({
    id: 'errors.audio.sfx_pack_missing',
    message: 'The sound effects aren’t downloaded yet. Try again once they are.',
  }),
  // EAR1: listening to sound (CLAP and AST are "the on-device models that listen"), the SFX bank and its kits.
  'errors.audio.listen_model_missing': msg({
    id: 'errors.audio.listen_model_missing',
    message: 'The on-device models that listen to sound aren’t downloaded yet. Try again once they are.',
  }),
  'errors.audio.listen_failed': msg({
    id: 'errors.audio.listen_failed',
    message: 'Couldn’t listen to this sound. Try again.',
  }),
  'errors.audio.listen_unavailable': msg({
    id: 'errors.audio.listen_unavailable',
    message: 'Taalcut can’t listen to sound right now. Try again in a moment.',
  }),
  'errors.audio.listen_bad_input': msg({
    id: 'errors.audio.listen_bad_input',
    message: 'There’s no sound here Taalcut can listen to. Try another clip or file.',
  }),
  'errors.audio.listen_near_silent': msg({
    id: 'errors.audio.listen_near_silent',
    message: 'This is almost silent, so there’s nothing to listen to. Turn it up, or pick another sound.',
  }),
  'errors.audio.sfx_bank_missing': msg({
    id: 'errors.audio.sfx_bank_missing',
    message: 'The sound effect library isn’t downloaded yet. Try again once it is.',
  }),
  'errors.audio.kit_invalid': msg({
    id: 'errors.audio.kit_invalid',
    message: 'That set of sound effects can’t be used. Pick another kit.',
  }),
  'errors.audio.reel_sfx_unavailable': msg({
    id: 'errors.audio.reel_sfx_unavailable',
    message:
      '{reason, select, no_template {This video wasn’t made from a template, so there are no reel sound effects to copy. Pick sounds or a kit instead.} no_effects {The template’s reel has no sound effects on its cuts to copy. Pick sounds or a kit instead.} cuts_changed {This video’s cuts no longer match its template, so the reel’s sound effects can’t go on them. Pick sounds or a kit instead.} other {Taalcut can’t copy the reel’s sound effects right now. Pick sounds or a kit instead.}}',
  }),
  'errors.audio.sfx_no_fitting_cuts': msg({
    id: 'errors.audio.sfx_no_fitting_cuts',
    message:
      'These sound effects don’t fit any of this video’s cuts, so nothing was changed. Pick other sounds or a kit, or put effects on every cut.',
  }),
  'errors.audio.cloud_critique_consent_required': msg({
    id: 'errors.audio.cloud_critique_consent_required',
    message:
      'Sending the sound to a cloud model needs your OK first. Read the warning, allow it, then try again.',
  }),
  'errors.audio.cut_unknown': msg({
    id: 'errors.audio.cut_unknown',
    message: 'That cut isn’t in the video any more, so the sound wasn’t added.',
  }),
  'errors.audio.stretch_unavailable': msg({
    id: 'errors.audio.stretch_unavailable',
    message: 'The music would have to change speed too much to fit. Pick a track closer to the video’s pace.',
  }),
  'errors.audio.stretch_failed': msg({
    id: 'errors.audio.stretch_failed',
    message: 'Couldn’t fit the music to the video’s length. Try again.',
  }),
  'errors.audio.translation_failed': msg({
    id: 'errors.audio.translation_failed',
    message: 'The translation came back unusable. Try again.',
  }),
  'errors.audio.translation_mismatch': msg({
    id: 'errors.audio.translation_mismatch',
    message: 'The translation left out or added lines. Try again.',
  }),
  'errors.audio.script_too_long': msg({
    id: 'errors.audio.script_too_long',
    message: 'A line is too long for its spot in the video. Shorten it, or give it more time.',
  }),
  // The media cards' words, word for word (media-errors.ts kept them until FIX-ERRWORDS), so chat says them too.
  'errors.audio.voice_consent_required': msg({
    id: 'errors.audio.voice_consent_required',
    message: 'Your voice needs a saved consent first. Record the consent again.',
  }),
  'errors.audio.consent_mismatch': msg({
    id: 'errors.audio.consent_mismatch',
    message: 'Taalcut didn’t hear the consent line with your name in it. Record it again.',
  }),
  'errors.audio.clone_source_refused': msg({
    id: 'errors.audio.clone_source_refused',
    message: 'Only a recording made in Taalcut’s consent card can become your voice. Record it there.',
  }),
  'errors.audio.voice_line_unknown': msg({
    id: 'errors.audio.voice_line_unknown',
    message: 'That line isn’t in the voiceover now.',
  }),
  'errors.audio.no_voiceover': msg({
    id: 'errors.audio.no_voiceover',
    message: 'There’s no voiceover in this video now.',
  }),
  'errors.audio.consent_recording_length': msg({
    id: 'errors.audio.consent_recording_length',
    message:
      'A consent recording is one to ten minutes long; this one was {seconds, plural, one {# second} other {# seconds}}. Record it again.',
  }),

  // @taalcut/vision: looking at clips, reading on-screen text, fonts and looks.
  'errors.vision.no_local_model': msg({
    id: 'errors.vision.no_local_model',
    message:
      'No on-device model can look at clips right now, so nothing was sent. Pick one in Settings › Models.',
  }),
  'errors.vision.empty_description': msg({
    id: 'errors.vision.empty_description',
    message: '{model} looked at the clip but wrote nothing. Try again.',
  }),
  'errors.vision.model_output_invalid': msg({
    id: 'errors.vision.model_output_invalid',
    message: 'The model’s answer about this clip didn’t make sense. Try again.',
  }),
  'errors.vision.model_missing': msg({
    id: 'errors.vision.model_missing',
    message: 'An on-device model this step needs isn’t downloaded yet. Taalcut carries on once it is.',
  }),
  'errors.vision.ocr_unavailable': msg({
    id: 'errors.vision.ocr_unavailable',
    message: 'Taalcut can’t read on-screen text in this language yet.',
  }),
  'errors.vision.ocr_failed': msg({
    id: 'errors.vision.ocr_failed',
    message: 'Couldn’t read the text on screen. Try again.',
  }),
  'errors.vision.embedder_unavailable': msg({
    id: 'errors.vision.embedder_unavailable',
    message: 'Clip search isn’t ready yet: its model is still downloading. Try again in a moment.',
  }),
  'errors.vision.embedding_failed': msg({
    id: 'errors.vision.embedding_failed',
    message: 'Couldn’t add this clip to search. Try again.',
  }),
  'errors.vision.space_mismatch': msg({
    id: 'errors.vision.space_mismatch',
    message:
      'Clip search was built with another model and needs rebuilding. Try again once indexing finishes.',
  }),
  'errors.vision.shot_model_failed': msg({
    id: 'errors.vision.shot_model_failed',
    message: 'The shot detector didn’t run, so Taalcut found the cuts a simpler way. They may be less exact.',
  }),
  'errors.vision.font_match_withheld': msg({
    id: 'errors.vision.font_match_withheld',
    message:
      'The words in this frame are too unclear to match their font. Try a frame where they’re sharper.',
  }),
  'errors.vision.font_render_failed': msg({
    id: 'errors.vision.font_render_failed',
    message: 'Couldn’t draw the fonts to compare them. Try again.',
  }),
  'errors.vision.look_unavailable': msg({
    id: 'errors.vision.look_unavailable',
    message: 'Couldn’t read this video’s look: its frames are missing or too dark.',
  }),
  'errors.vision.grade_failed': msg({
    id: 'errors.vision.grade_failed',
    message: 'Couldn’t copy the reference’s colour look. Try again.',
  }),
  'errors.vision.subject_detect_failed': msg({
    id: 'errors.vision.subject_detect_failed',
    message: 'Couldn’t find where the people are in this clip. Try again.',
  }),
};
