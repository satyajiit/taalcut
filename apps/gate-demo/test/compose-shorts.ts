// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { defineToolModule, err, NotImplementedError, ok } from '@taalcut/core';
import { createShortsImportTool, createShortsProjectTool, shortsToolModule } from '@taalcut/shorts';

/** Existing recorded journeys don't create shorts, but tool discovery must see the production catalogue. */
export function demoShortsModule() {
  const unavailable = async () => err(NotImplementedError({ feature: 'recorded shorts composition' }));
  const editorial = shortsToolModule({
    service: () => ({ generate: unavailable, regenerate: unavailable, get: async () => ok(null) }),
    get: async () => ok(null),
    placement: 'cloud',
  });
  return defineToolModule({
    id: 'shorts',
    tools: [
      createShortsProjectTool({ run: unavailable }),
      createShortsImportTool({ run: unavailable }),
      ...editorial.tools,
    ],
  });
}
