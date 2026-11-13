// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LRN1-CTX: templates.resolveCuts cuts a page to the bytes a tool output may take before the agent's executor stores
 * it as an artifact (the model would get a summary instead of the slots). @taalcut/templates can't import
 * @taalcut/tools, so the composition holds the two equal here.
 */
import { PAGE_MAX_BYTES } from '@taalcut/templates';
import { DEFAULT_INLINE_OUTPUT_LIMIT } from '@taalcut/tools';
import { describe, expect, it } from 'vitest';

describe("templates.resolveCuts' page size in bytes", () => {
  it("is the executor's inline output limit", () => {
    expect(PAGE_MAX_BYTES).toBe(DEFAULT_INLINE_OUTPUT_LIMIT);
  });
});
