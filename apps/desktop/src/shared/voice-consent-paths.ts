// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The own-voice consent folders (P3-B6), agreed between main (which writes captures) and the agent process's
 * consent store (which keeps a claimed capture as the consent's recording). Only those two read `voice-consent`.
 * No Electron and no Node beyond path.
 */
import { join } from 'node:path';

/** Main's captures: `<id>.wav.part` while recording, `<id>.wav` once stopped. */
export const voiceCapturesDir = (userData: string): string => join(userData, 'voice-consent', 'captures');

/** The consent store's recordings, one per consent. */
export const voiceRecordingsDir = (userData: string): string => join(userData, 'voice-consent', 'recordings');
