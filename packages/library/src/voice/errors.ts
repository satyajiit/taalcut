// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Errors of the voice consent store (P3-B6). Each code's i18n key is `errors.<code>`. */
import { defineError } from '@taalcut/core';

/** The claimed capture isn't the recording the consent was checked against (its sha256 differs). */
export const VoiceRecordingMismatch = defineError('library.voice_recording_mismatch');
