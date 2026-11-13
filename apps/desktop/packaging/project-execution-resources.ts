// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { realpathSync } from 'node:fs';
import type { FileSet } from 'electron-builder';

/** npm and pnpm include their pinned dependencies; the Node executable comes from the component manager. */
export function projectExecutionResources(projectDir: string): FileSet[] {
  const require = createRequire(join(projectDir, 'package.json'));
  return ['npm', 'pnpm'].map((manager) => ({
    from: realpathSync(dirname(require.resolve(manager === 'pnpm' ? 'pnpm' : 'npm/package.json'))),
    to: `project-tools/${manager}`,
    filter: ['**/*', '!**/test/**', '!**/tests/**'],
  }));
}
