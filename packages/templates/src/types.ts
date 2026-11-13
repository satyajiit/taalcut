// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Names for the enum members of core's Template v1 that core exports only as arrays. */
import type {
  AUDIO_KINDS,
  CUT_METHODS,
  REFERENCE_INPUTS,
  REFERENCE_PLATFORMS,
  TemplateSlot,
  TextOverlay,
  TRANSITION_KINDS,
} from '@taalcut/core';

export type SlotRole = TemplateSlot['role'];
export type TextRole = TextOverlay['role'];
export type ReferenceInputKind = (typeof REFERENCE_INPUTS)[number];
export type ReferencePlatform = (typeof REFERENCE_PLATFORMS)[number];
export type CutMethod = (typeof CUT_METHODS)[number];
export type TransitionKind = (typeof TRANSITION_KINDS)[number];
export type AudioKind = (typeof AUDIO_KINDS)[number];
