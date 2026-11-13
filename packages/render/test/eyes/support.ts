// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** AGT2 eyes tests: a tool context over an in-memory artifact store, and a tool's run with its schemas checked. */
import {
  err,
  newId,
  NotFoundError,
  ok,
  type AnyTool,
  type ArtifactId,
  type ArtifactInput,
  type ArtifactRef,
  type ToolContextBase,
} from '@taalcut/core';

export function eyesContext() {
  const stored = new Map<string, { input: ArtifactInput; ref: ArtifactRef; data: Uint8Array }>();
  const ctx: ToolContextBase = {
    signal: new AbortController().signal,
    callId: newId<'ToolRun'>(),
    runId: newId<'AgentRun'>(),
    attempt: 1,
    artifacts: {
      async put(input) {
        const data = typeof input.data === 'string' ? Buffer.from(input.data) : input.data;
        const ref = {
          id: newId<'Artifact'>() as ArtifactId,
          mediaType: input.mediaType,
          bytes: data.byteLength,
          summary: input.summary,
        };
        stored.set(ref.id, { input, ref, data });
        return ok(ref);
      },
      async get(id) {
        const found = stored.get(id);
        return found
          ? ok({ ref: found.ref, data: found.data })
          : err(NotFoundError({ entity: 'artifact', id }));
      },
    },
    reportUsage: () => undefined,
    reportProgress: () => undefined,
  };
  return { ctx, stored };
}

/** Runs a tool as the registry would: the input parsed, the output checked against its schema. */
export async function runTool(tool: AnyTool, input: unknown, ctx: ToolContextBase) {
  const parsed = tool.input.parse(input);
  const result = await tool.run(parsed, ctx as never);
  if (!result.ok) return result;
  return ok(tool.output.parse(result.value) as Record<string, unknown>);
}
