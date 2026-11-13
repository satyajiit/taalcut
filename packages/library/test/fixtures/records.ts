// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Valid records for tests, with overrides. */
import { newId, type CloudCallRecord, type NewAuditEntry } from '@taalcut/core';

export function cloudCall(overrides: Partial<CloudCallRecord> = {}): CloudCallRecord {
  return {
    id: newId<'CloudCall'>(),
    module: 'agent',
    provider: 'openai',
    model: 'gpt-5',
    reasoning: 'medium',
    local: false,
    startedAt: Date.UTC(2026, 9, 12),
    latencyMs: 900,
    bytesSent: 4096,
    bytesReceived: 2048,
    inputTokens: 1000,
    outputTokens: 200,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    costUsd: 0.0123456,
    outcome: 'ok',
    attempt: 1,
    ...overrides,
  };
}

export function auditEntry(overrides: Partial<NewAuditEntry> = {}): NewAuditEntry {
  return {
    id: newId<'Command'>(),
    projectId: null,
    name: 'project.rename',
    payload: { name: 'x' },
    inverse: { name: 'project.rename', payload: { name: 'old' } },
    source: 'ui',
    actor: 'user',
    sideEffect: 'write',
    createdAt: Date.UTC(2026, 9, 12),
    idempotencyKey: null,
    result: null,
    ...overrides,
  };
}
