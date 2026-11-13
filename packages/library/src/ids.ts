// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Entity ids this package needs that @taalcut/core doesn't have yet. They move
 * to core's ids.ts when its owner next changes it; then this file re-exports them.
 */
import type { Id } from '@taalcut/core';

export type AcknowledgementId = Id<'Acknowledgement'>;
/** ADR 0001: one row per place an asset's bytes live. */
export type AssetLocationId = Id<'AssetLocation'>;
