// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { extname } from 'node:path';

/** Click track written beside a render, same basename, `.wav`. */
export function wavPathFor(videoPath: string): string {
  const ext = extname(videoPath);
  const stem = ext.length > 0 ? videoPath.slice(0, -ext.length) : videoPath;
  return `${stem}.wav`;
}
