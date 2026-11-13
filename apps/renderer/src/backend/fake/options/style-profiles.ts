// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  FAKE_STYLE_PROFILE_SCENARIOS,
  type FakeStyleProfileScenario,
} from '../templates/fake-style-profiles';
import type { AreaOptionsReader } from './area-options';

/**
 * The style profiles' fake options from `taalcut.fake` (LRN1-STY): `styleProfiles` is 'local', 'cloud',
 * 'noModel', 'notYet', 'failed', 'writing', 'slow' or 'failing' (templates/fake-style-profiles.ts says what each
 * does). Anything else: written on this Mac.
 */
export const styleProfileOptions: AreaOptionsReader = (stored) => {
  const scenario = stored['styleProfiles'];
  const known = FAKE_STYLE_PROFILE_SCENARIOS.find(
    (name): name is FakeStyleProfileScenario => name === scenario,
  );
  return known ? { phase2: { styleProfiles: { scenario: known } } } : {};
};
