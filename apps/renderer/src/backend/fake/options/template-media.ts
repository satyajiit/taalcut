// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { readTemplateMediaScenario } from '../templates/template-media';
import type { AreaOptionsReader } from './area-options';

/**
 * REF1: an older template's "Get the reel's video and music" from `taalcut.fake`: `{ "templateMedia": "failsOnce" }`
 * (the download fails, then Try again works) or `"unavailable"` (no downloader for this Mac); `templateMediaTickMs`
 * paces the fetch's job (0: at once). Absent, the fetch works at its own pace. `{ "templateWaveform": "flat" }`
 * gives Slow morning routine the flat waveform of a template read before keep's `04e87739` (keep's request 41).
 */
export const templateMediaOptions: AreaOptionsReader = (stored) => {
  const scenario = readTemplateMediaScenario(stored['templateMedia']);
  const tick = stored['templateMediaTickMs'];
  const tickMs = typeof tick === 'number' && tick >= 0 ? tick : undefined;
  const flat = stored['templateWaveform'] === 'flat';
  if (!scenario && tickMs === undefined && !flat) return {};
  return {
    phase2: {
      ...(scenario || tickMs !== undefined
        ? {
            templateMedia: { ...(scenario ? { scenario } : {}), ...(tickMs !== undefined ? { tickMs } : {}) },
          }
        : {}),
      ...(flat ? { templates: { flatWaveform: true } } : {}),
    },
  };
};
