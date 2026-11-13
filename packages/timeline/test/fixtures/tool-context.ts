// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What `@taalcut/agent` gives a timeline tool, for the tests: an artifact store in memory, and a tool context whose
 * dispatch sends the tool's declared command to a bus as the agent.
 */
import {
  err,
  newId,
  NotFoundError,
  ok,
  type AnyTool,
  type ArtifactId,
  type ArtifactRef,
  type ArtifactStore,
  type CommandBus,
  type CommandToolContext,
  type StoredArtifact,
} from '@taalcut/core';

export interface MemoryArtifacts extends ArtifactStore {
  /** How many artifacts it holds. */
  readonly size: number;
  /** Keeps `text` under `id` as it is, so a test can plant a broken plan. */
  raw(id: ArtifactId, text: string): void;
}

export function memoryArtifactStore(): MemoryArtifacts {
  const kept = new Map<string, StoredArtifact>();
  const keep = (id: ArtifactId, mediaType: string, data: Uint8Array, summary: string): ArtifactRef => {
    const ref = { id, mediaType, bytes: data.byteLength, summary };
    kept.set(id, { ref, data });
    return ref;
  };
  return {
    async put(input) {
      const data = typeof input.data === 'string' ? new TextEncoder().encode(input.data) : input.data;
      return ok(keep(newId<'Artifact'>(), input.mediaType, data, input.summary));
    },
    async get(id) {
      const found = kept.get(id);
      return found ? ok(found) : err(NotFoundError({ entity: 'artifact', id }));
    },
    raw(id, text) {
      keep(id, 'application/json', new TextEncoder().encode(text), 'raw');
    },
    get size() {
      return kept.size;
    },
  };
}

/** What `@taalcut/agent`'s dispatcher gives a tool: its declared command on the bus, as the agent. */
export function agentToolContext(
  bus: CommandBus,
  tool: AnyTool,
  artifacts: ArtifactStore = memoryArtifactStore(),
): CommandToolContext {
  return {
    signal: new AbortController().signal,
    callId: newId<'ToolRun'>(),
    attempt: 1,
    artifacts,
    reportUsage: () => undefined,
    reportProgress: () => undefined,
    async dispatch(payload) {
      const receipt = await bus.dispatch(tool.command ?? tool.name, payload, {
        source: 'agent',
        actor: 'agent:test',
      });
      return receipt.ok ? ok(receipt.value.result) : receipt;
    },
  };
}
