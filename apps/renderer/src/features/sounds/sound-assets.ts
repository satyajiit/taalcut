// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import promptSent from './assets/prompt-sent.m4a';
import editApplied from './assets/edit-applied.m4a';
import undo from './assets/undo.m4a';
import redo from './assets/redo.m4a';
import importDone from './assets/import-done.m4a';
import draftAssembled from './assets/draft-assembled.m4a';
import complete from './assets/complete.m4a';
import { audioVoice, type SoundName } from './sound-player';

export const SOUND_VOLUME = 0.6;
const URLS: Readonly<Record<SoundName, string>> = {
  promptSent,
  editApplied,
  undo,
  redo,
  importDone,
  draftAssembled,
  complete,
};

export const interfaceSoundVoice = (name: SoundName) => audioVoice(URLS[name], SOUND_VOLUME);
