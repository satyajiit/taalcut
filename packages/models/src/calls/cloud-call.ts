// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * One row per outbound model request (G9, P1-F5), as core's CloudCallRecord:
 * ModelClient hands every record to core's CloudCallSink, which
 * packages/library persists. Records hold sizes and counts only: never
 * prompts, outputs, keys or tokens.
 */
import { ok, type CloudCallRecord, type CloudCallSink } from '@taalcut/core';

/** Writes one row. A sink that fails or throws never fails the model call; developers see a warning. */
export async function recordCloudCall(sink: CloudCallSink, record: CloudCallRecord): Promise<void> {
  try {
    const recorded = await sink.record(record);
    if (!recorded.ok) console.warn(`models: cloud call not recorded: ${recorded.error.code}`);
  } catch (cause) {
    console.warn('models: cloud-call sink failed', cause);
  }
}

/** Keeps records in memory. For tests and as the default where nothing persists them. */
export interface MemoryCloudCallSink extends CloudCallSink {
  readonly records: readonly CloudCallRecord[];
  clear(): void;
}

export function createMemoryCloudCallSink(): MemoryCloudCallSink {
  const records: CloudCallRecord[] = [];
  return {
    get records() {
      return records;
    },
    async record(record) {
      records.push(record);
      return ok(undefined);
    },
    clear() {
      records.length = 0;
    },
  };
}
