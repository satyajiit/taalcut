// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  commandCapabilities,
  queryCapabilities,
  EDITOR_COMMANDS,
  AUDIO_EDIT_COMMANDS,
  SIMPLE_EDITOR_COMMANDS,
  type EditorCapability,
} from '@taalcut/core';

export const timelineEditorCapabilities: readonly EditorCapability[] = [
  ...commandCapabilities([
    ...Object.values(EDITOR_COMMANDS),
    ...Object.values(AUDIO_EDIT_COMMANDS),
    ...Object.values(SIMPLE_EDITOR_COMMANDS),
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
  ...queryCapabilities(['timeline.get', 'timeline.transcript']),
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
