// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The style profile reads on the templates service (LRN1-STY): `styleProfile` and `writeStyleSummary` of
 * appContract.templates, served by the profiles service where the agent process has one. Without it the contract
 * answers core.not_implemented (the service leaves the two out).
 */
import type { TemplatesService } from '@taalcut/core';
import type { StyleProfiles } from './style-profiles';

export function withStyleProfileReads<S extends TemplatesService>(
  service: S,
  profiles: Pick<StyleProfiles, 'view' | 'writeSummary'>,
): S & Required<Pick<TemplatesService, 'styleProfile' | 'writeStyleSummary'>> {
  return {
    ...service,
    styleProfile: ({ source }) => profiles.view(source),
    writeStyleSummary: ({ source }) => profiles.writeSummary(source),
  };
}
