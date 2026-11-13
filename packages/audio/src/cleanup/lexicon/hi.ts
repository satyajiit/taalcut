// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Hindi fillers (SPEC P3.7). Whisper drops most of them, so Hindi leans on the untranscribed-burst rule. */
export const HI = {
  fillers: ['अ', 'आ', 'उम', 'उम्म', 'हम्म', 'अम्म'],
  ambiguous: ['तो', 'मतलब', 'वो', 'यानी', 'बस'],
} as const;
