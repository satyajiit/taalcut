// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Idempotency keys for audio's Phase 3 write tools (SPEC P3.9): the tool's name and a sha256 of its input, so a
 * repeat in one run returns the first result and a resumed run can't apply (or pay for) the same change twice.
 * The input names the timeline; the command checks the stored revision when it applies.
 */
import { createHash } from 'node:crypto';

export function inputKey(tool: string, input: unknown): string {
  return `${tool}:${createHash('sha256').update(JSON.stringify(input)).digest('hex')}`;
}
