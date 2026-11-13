// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { ArtifactStore } from '@taalcut/core';
import type { ToolCallState } from '../run-state';

/** Read only the completed result recorded by this run, never a model-supplied artifact. */
export async function recordedToolReceipt(call: ToolCallState, artifacts?: Pick<ArtifactStore, 'get'>) {
  const output = call.outcome?.kind === 'completed' ? call.outcome.payload.output : undefined;
  if (output?.kind === 'inline') return output.value;
  if (output?.kind !== 'artifact' || output.ref.mediaType !== 'application/json' || !artifacts)
    return undefined;
  try {
    const stored = await artifacts.get(output.ref.id);
    if (
      !stored.ok ||
      stored.value.ref.id !== output.ref.id ||
      stored.value.ref.mediaType !== 'application/json' ||
      stored.value.data.byteLength > 2 * 1024 * 1024
    )
      return undefined;
    return JSON.parse(new TextDecoder().decode(stored.value.data)) as unknown;
  } catch {
    return undefined;
  }
}
