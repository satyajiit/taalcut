// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * VideoToolbox (macOS): frames stay on the GPU (`videotoolbox_vld`), turned
 * with `transpose_vt` before the split and scaled per branch with `scale_vt`,
 * then downloaded in the surface format the decoder produced. An HDR source
 * downloads p010le and tone-maps once before the split; its branches scale
 * on the CPU (normalise/graph.ts does the same for one output; frames match
 * it byte for byte).
 */
import type { DecodeRoute } from './route';
import { surfaceRoute } from './surface-route';

export function videoToolboxRoute(surfaceFormat: string): DecodeRoute {
  return surfaceRoute({ backend: 'videotoolbox', surfaceFormat });
}
