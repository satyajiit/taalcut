// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { queryCapabilities, type EditorCapability } from '@taalcut/core';

export const audioEditorCapabilities: readonly EditorCapability[] = [
  ...queryCapabilities(['music.findLibraryTrack', 'voice.fitScript', 'voice.listVoices']),
  ...(['music.generate', 'music.useLibraryTrack'] as const).map((id): EditorCapability => ({
    id,
    commands: ['music.choosePath'],
    tools: [id],
    access: 'ai',
  })),
  { id: 'music.setDucking', commands: ['music.setDucking'], tools: ['music.setDucking'], access: 'ai' },
  ...(['sfx.addHits', 'sfx.generateHit'] as const).map((id): EditorCapability => ({
    id,
    commands: ['sfx.setHits'],
    tools: [id],
    access: 'ai',
  })),
  ...(['voice.generate', 'voice.editLine', 'voice.place', 'voice.finalize'] as const).map(
    (id): EditorCapability => ({ id, commands: ['voice.applyVoiceover'], tools: [id], access: 'ai' }),
  ),
  {
    id: 'captions.translate',
    commands: ['captions.applyTranslation'],
    tools: ['captions.translate'],
    access: 'ai',
  },
];
