// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * JSON text read at a boundary: a TEXT column, a cache body or a provider's
 * response. Text that is not JSON reads as `undefined`, which every zod schema
 * refuses, so the caller's schema decides; nothing here trusts the shape.
 */
import { jsonFromText, parseJsonWith } from '@taalcut/core';

/** Core's helpers under the names library's modules use (`parseJsonText` is core's `parseJsonWith`). */
export { jsonFromText, parseJsonWith as parseJsonText };

export function jsonFromBytes(body: Uint8Array): unknown {
  return jsonFromText(new TextDecoder('utf-8', { fatal: false }).decode(body));
}
