// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { defineConfig } from '@lingui/conf';

// Only for this package's own tests, so the macro transform can run here. The
// UI kit's strings are extracted into the renderer's catalogue: see
// apps/renderer/lingui.config.ts, which includes packages/ui/src.
export default defineConfig({
  sourceLocale: 'en',
  locales: ['en'],
  catalogs: [],
});
