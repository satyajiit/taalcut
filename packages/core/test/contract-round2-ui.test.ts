// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Contract round 2 (SPEC 14.7), UI round 2b's requests (renderer R15). */
import { describe, expect, it } from 'vitest';
import {
  ALPHA_TERMS,
  chatStartSchema,
  componentSchema,
  privacyOverviewSchema,
  REFERENCE_DOWNLOAD_WARNING,
} from '../src/index';

describe('UI round 2b', () => {
  it('names the alpha terms like the reel-link warning', () => {
    expect(ALPHA_TERMS).toEqual({ featureId: 'alpha.terms', termsVersion: '2026-10-13' });
    expect(Object.keys(ALPHA_TERMS)).toEqual(Object.keys(REFERENCE_DOWNLOAD_WARNING));
  });

  it('keeps the saved privacy switches beside the effective flows', () => {
    const overview = { localOnly: true, modules: [], other: [] };
    const switches = { telemetry: true, crashReports: false, cohort: 'GOA26X' };
    expect(privacyOverviewSchema.parse({ ...overview, switches })).toMatchObject({ switches });
    expect(privacyOverviewSchema.safeParse(overview).success).toBe(false);
    expect(
      privacyOverviewSchema.safeParse({ ...overview, switches: { ...switches, cohort: 'nope' } }).success,
    ).toBe(false);
  });

  it('starts the describe flow from a bundled format', () => {
    expect(chatStartSchema.parse({ path: 'describe', formatId: 'vlog' })).toEqual({
      path: 'describe',
      formatId: 'vlog',
    });
    expect(chatStartSchema.parse({ path: 'describe' })).toEqual({ path: 'describe' });
    expect(chatStartSchema.safeParse({ path: 'describe', formatId: 'opera' }).success).toBe(false);
  });

  it('marks the components this Mac needs', () => {
    const component = {
      id: 'embeddinggemma-2',
      name: 'EmbeddingGemma 2',
      version: '2',
      licence: 'Gemma',
      sizeBytes: 300_000_000,
      status: 'not-installed',
      usedBy: ['embeddings'],
    };
    expect(componentSchema.parse({ ...component, needed: true }).needed).toBe(true);
    expect(componentSchema.parse(component).needed).toBeUndefined();
  });
});
