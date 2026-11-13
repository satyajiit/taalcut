// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { FakeFilePicksOptions } from '../phase3/fake-file-picks';
import type { AreaOptionsReader } from './area-options';

/**
 * The brand area's fake options from `taalcut.fake`: `styles` ('empty': no brand kits or looks;
 * 'uncaptioned': two of Golden hour market's videos have no captions) and `brandImage`, the path main's file
 * dialog answers for a brand image (null: cancelled; phase3/styles/style-images.ts lists the names it refuses).
 */
export const brandOptions: AreaOptionsReader = (stored) => {
  const brandImage = stored['brandImage'];
  const files: FakeFilePicksOptions | undefined =
    typeof brandImage === 'string' || brandImage === null ? { picks: { brandImage } } : undefined;
  const scenario = stored['styles'];
  return {
    phase3: {
      ...(scenario === 'empty' ? { styles: { empty: true } } : {}),
      ...(scenario === 'uncaptioned' ? { styles: { uncaptioned: true } } : {}),
      ...(files ? { files } : {}),
    },
  };
};
