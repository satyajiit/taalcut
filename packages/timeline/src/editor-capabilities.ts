// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  commandCapabilities,
  queryCapabilities,
  EDITOR_COMMANDS,
  AUDIO_EDIT_COMMANDS,
  SIMPLE_EDITOR_COMMANDS,
  POST_CAPTION_COMMAND,
  TEXT_DESIGN_COMMAND,
  TEXT_PLACE_COMMAND,
  LENGTHEN_SLOT_COMMAND,
  type EditorCapability,
} from '@taalcut/core';

export const timelineEditorCapabilities: readonly EditorCapability[] = [
  ...commandCapabilities([
    ...Object.values(EDITOR_COMMANDS),
    ...Object.values(AUDIO_EDIT_COMMANDS),
    ...Object.values(SIMPLE_EDITOR_COMMANDS),
    // CAP1: the caption to post under the video.
    POST_CAPTION_COMMAND,
    // TXT1: the video's text looks, and where its text sits.
    TEXT_DESIGN_COMMAND,
    TEXT_PLACE_COMMAND,
    // LONG1: a clip lengthened by whole bars of the reel's music.
    LENGTHEN_SLOT_COMMAND,
    'timeline.setCover',
    'timeline.swapClip',
    'timeline.trimClip',
    'timeline.moveClip',
    'timeline.editText',
    'timeline.moveText',
    'timeline.lockClip',
    'timeline.setClipFit',
    'timeline.setReframe',
    'timeline.setVisualLayout',
    'timeline.resyncBeats',
    'timeline.trimToDuration',
    'timeline.applyCleanup',
    'timeline.applyEnergyCurve',
    'timeline.setStyle',
    'timeline.exportInterchange',
    'timeline.fillGap',
    'timeline.dropSlot',
    'timeline.markForFilming',
    'timeline.applyCast',
  ]),
  // LONG1: timeline.musicBars reads the music's bars and each clip's spare footage.
  ...queryCapabilities(['timeline.get', 'timeline.transcript', 'timeline.musicBars']),
  ...commandCapabilities(['timeline.prepareNarration']),
  ...queryCapabilities([
    'timeline.findAlternates',
    'timeline.planCleanup',
    'timeline.planEnergyCurve',
    'timeline.fitTemplates',
  ]),
  {
    id: 'timeline.makeVariants',
    commands: ['timeline.create'],
    tools: ['timeline.makeVariants'],
    access: 'ai',
  },
  {
    id: 'timeline.applyStyleToMany',
    commands: ['batch.applyStyle'],
    tools: ['timeline.applyStyleToMany'],
    access: 'ai',
  },
  {
    id: 'narration.record',
    commands: [],
    tools: [],
    access: 'person',
    reason: 'editor.microphone_requires_person',
  },
  { id: 'editor.navigation', commands: [], tools: [], access: 'person', reason: 'editor.local_view_state' },
];
