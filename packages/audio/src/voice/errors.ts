// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Voice errors (SPEC P3.12). Provider errors (rate limits, quota, auth) pass through as models'. */
import { defineError } from '@taalcut/core';

/** A line can't fit its slot even with a one-beat pre-lap and 8 % compression: the skill shortens the text. */
export const ScriptTooLong = defineError<{ lineId: string; overByMs: number }>('audio.script_too_long');
/** Cloning needs a stored consent whose recording is the clone's source. */
export const VoiceConsentRequired = defineError('audio.voice_consent_required');
/** The consent recording's transcript doesn't match the consent line (or misses the speaker's name). */
export const ConsentMismatch = defineError<{ heard: string }>('audio.consent_mismatch');
/** A clone source that isn't the in-app consent recording (a dropped file, a library asset). */
export const CloneSourceRefused = defineError('audio.clone_source_refused');
/** No line to place, or a line id the voiceover doesn't have. */
export const VoiceLineUnknown = defineError<{ lineId: string }>('audio.voice_line_unknown');
/** The timeline has no voiceover to edit, place or finalise. */
export const NoVoiceover = defineError('audio.no_voiceover');
/** A consent recording must hold the line and at least 60 s of reading (at most 10 minutes). */
export const ConsentRecordingLength = defineError<{ seconds: number }>('audio.consent_recording_length');
