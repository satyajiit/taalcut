// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

export const RENDERER_INPUTS: readonly string[];

export function staleRenderer(options: {
  readonly root: string;
  readonly dist: string;
  readonly inputs?: readonly string[];
}): string | null;
