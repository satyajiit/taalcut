// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** One Taalcut-owned docs topic the workspace shell can read: its name and its text (taalcut-docs.ts lists them). */
export interface TaalcutDocsTopic {
  readonly topic: string;
  readonly text: string;
}
