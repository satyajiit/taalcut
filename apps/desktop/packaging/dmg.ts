// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { join } from 'node:path';
import type { Configuration } from 'electron-builder';

/** Finder's real app and Applications link align with the TIFF's first, 1x representation in dmg/. */
export function dmgConfig(projectDir: string): NonNullable<Configuration['dmg']> {
  return {
    title: 'Taalcut ${version}',
    background: join(projectDir, 'packaging/dmg/background.tiff'),
    // electron-builder 26 derives this size from the background's first TIFF image when one is supplied.
    window: { width: 660, height: 440 },
    iconSize: 96,
    iconTextSize: 13,
    contents: [
      { x: 180, y: 240, type: 'file' },
      { x: 480, y: 240, type: 'link', path: '/Applications' },
    ],
    // The distribution hook signs, notarizes and staples the DMG with a timestamp.
    // Its bytes change after packaging; macOS updates use the zip instead.
    sign: false,
    writeUpdateInfo: false,
  };
}
