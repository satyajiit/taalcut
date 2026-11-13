// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { join } from 'node:path';

/** ADR 0001: the catalog lives in userData/catalog (Application Support/Taalcut when packaged). */
export function libraryPath(userData: string): string {
  return join(userData, 'catalog', 'library.sqlite');
}
