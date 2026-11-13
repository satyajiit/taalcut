// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { describe, expect, it } from 'vitest';
import { QA_CHECK_IDS, qaCheckIdSchema, SLOT_MATCH_CHECK_IDS } from '../src';

describe('AGT2-MATCH contract', () => {
  it('adds the slot-match checks after every earlier check', () => {
    // EAR1-K0's sound checks come after them, so they sit right after graphicCoversFace.
    expect(QA_CHECK_IDS.slice(32, 32 + SLOT_MATCH_CHECK_IDS.length)).toEqual([...SLOT_MATCH_CHECK_IDS]);
    expect(QA_CHECK_IDS.indexOf('graphicCoversFace')).toBe(31);
    for (const id of SLOT_MATCH_CHECK_IDS) expect(qaCheckIdSchema.parse(id)).toBe(id);
  });
});

describe('AGT2-MATCH render services', () => {
  it("gives the render process main's forwarded query embedder", async () => {
    const { MAIN_SERVICE_CONTRACTS, embeddingsContract } = await import('../src');
    expect(MAIN_SERVICE_CONTRACTS.render.embeddings).toBe(embeddingsContract);
  });
});
