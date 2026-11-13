// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A ToolContext for calling a tool's run() directly, with an in-memory
 * artifact store, the way @taalcut/tools' executor would. Domain packages
 * can't import @taalcut/tools, so this is a small stand-in.
 */
import {
  err,
  newId,
  NotFoundError,
  ok,
  type ArtifactStore,
  type StoredArtifact,
  type ToolContextBase,
  type ToolUsage,
} from '@taalcut/core';

export interface TestToolContext extends ToolContextBase {
  readonly progress: { fraction: number; note?: string }[];
  readonly usage: ToolUsage[];
  readonly stored: Map<string, StoredArtifact>;
}

export function memoryArtifacts(stored = new Map<string, StoredArtifact>()): ArtifactStore {
  return {
    put: async (artifact) => {
      const data =
        typeof artifact.data === 'string' ? new TextEncoder().encode(artifact.data) : artifact.data;
      const ref = {
        id: newId<'Artifact'>(),
        mediaType: artifact.mediaType,
        bytes: data.byteLength,
        summary: artifact.summary,
      };
      stored.set(ref.id, { ref, data });
      return ok(ref);
    },
    get: async (id) => {
      const found = stored.get(id);
      return found ? ok(found) : err(NotFoundError({ entity: 'artifact', id }));
    },
  };
}

export function testToolContext(
  options: { signal?: AbortSignal; artifacts?: ArtifactStore } = {},
): TestToolContext {
  const stored = new Map<string, StoredArtifact>();
  const progress: TestToolContext['progress'] = [];
  const usage: ToolUsage[] = [];
  return {
    signal: options.signal ?? new AbortController().signal,
    callId: newId<'ToolRun'>(),
    attempt: 1,
    artifacts: options.artifacts ?? memoryArtifacts(stored),
    reportUsage: (u) => usage.push(u),
    reportProgress: (fraction, note) => progress.push(note === undefined ? { fraction } : { fraction, note }),
    progress,
    usage,
    stored,
  };
}
