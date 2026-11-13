// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The formats the agent offers the model for a describe start. @taalcut/templates plans all eight core lists
 * (P3-V1, one registered module per format), so the model may pick any of them. Should a format ever be listed
 * before templates can plan it, this list narrows to the ones it can, so the model never picks one that can't be
 * planned.
 */
import { FORMAT_IDS } from '@taalcut/core';

export const OFFERED_FORMATS = FORMAT_IDS;
