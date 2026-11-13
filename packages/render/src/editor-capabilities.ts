// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { commandCapabilities, queryCapabilities, type EditorCapability } from '@taalcut/core';

export const renderEditorCapabilities: readonly EditorCapability[] = [
  ...commandCapabilities([
    'captions.setEnabled',
    'captions.editText',
    'captions.setStyle',
    'captions.rebuild',
    'graphics.edit',
    'graphics.remove',
    'graphics.useProposal',
    'render.export',
    'render.exportCover',
    'render.cancel',
    'render.setExportPreset',
  ]),
  ...queryCapabilities([
    'graphics.list',
    'render.status',
    'render.list',
    'render.getQaReport',
    'render.listPresets',
    'timeline.captureFrame',
  ]),
  { id: 'graphics.design', commands: [], tools: ['graphics.design'], access: 'ai' },
];
