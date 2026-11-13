// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The shipped starter manifest, checked at load (P3-B3). */
import raw from '../../starters/manifest.json' with { type: 'json' };
import { starterManifestSchema, type StarterEntry } from './manifest-schema';

export const STARTER_MANIFEST: readonly StarterEntry[] = starterManifestSchema.parse(raw);
