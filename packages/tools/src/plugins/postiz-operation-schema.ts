// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { z } from 'zod';

export interface PostizOperation {
  readonly name: string;
  readonly description: string;
  readonly method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  readonly path: string;
  readonly access: string[];
  readonly schema: z.ZodType<Record<string, unknown>>;
  readonly external?: boolean;
  readonly multipart?: boolean;
}
