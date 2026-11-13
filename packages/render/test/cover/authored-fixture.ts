// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { coverDesignSchema } from '@taalcut/core';

/** A reference-led hierarchy with actual editable illustration, accents and branding. */
export const airportDesign = () =>
  coverDesignSchema.parse({
    version: 1,
    palette: { ink: '#17252a', paper: '#e9dfcb', accent: '#ed751b', muted: '#baa68b' },
    layers: [
      {
        kind: 'text',
        text: 'Never\ngets old.',
        font: 'montserrat',
        weight: 800,
        fontSize: 0.18,
        box: { x: 0.07, y: 0.19, width: 0.86, height: 0.24 },
      },
      {
        kind: 'shape',
        shape: 'rectangle',
        fill: 'accent',
        box: { x: 0.07, y: 0.425, width: 0.65, height: 0.009 },
      },
      {
        kind: 'text',
        text: 'WINDOW SEAT',
        font: 'notoSans',
        fontSize: 0.024,
        letterSpacing: 0.12,
        box: { x: 0.65, y: 0.47, width: 0.29, height: 0.04 },
      },
      {
        kind: 'path',
        stroke: 'muted',
        strokeWidth: 0.018,
        dashed: true,
        box: { x: 0.37, y: 0.55, width: 0.43, height: 0.28 },
        commands: [
          { command: 'M', x: 0.05, y: 0.98 },
          { command: 'C', c1x: 0.95, c1y: 0.85, c2x: 0.2, c2y: 0.45, x: 0.84, y: 0.04 },
        ],
      },
      {
        kind: 'path',
        fill: 'ink',
        stroke: 'transparent',
        box: { x: 0.69, y: 0.51, width: 0.12, height: 0.06 },
        commands: [
          { command: 'M', x: 0.95, y: 0.05 },
          { command: 'L', x: 0.65, y: 0.95 },
          { command: 'L', x: 0.45, y: 0.56 },
          { command: 'L', x: 0.02, y: 0.4 },
          { command: 'Z' },
        ],
      },
      {
        kind: 'shape',
        shape: 'rectangle',
        fill: 'ink',
        box: { x: 0.58, y: 0.89, width: 0.36, height: 0.068 },
      },
      {
        kind: 'text',
        text: 'Created with',
        font: 'notoSans',
        fontSize: 0.018,
        weight: 500,
        color: 'paper',
        box: { x: 0.61, y: 0.9, width: 0.31, height: 0.022 },
      },
      {
        kind: 'text',
        text: '@taalcut.app',
        font: 'notoSans',
        fontSize: 0.032,
        color: 'paper',
        box: { x: 0.61, y: 0.922, width: 0.31, height: 0.028 },
      },
    ],
  });
