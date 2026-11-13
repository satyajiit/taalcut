// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { defineCommand, ok, type AnyCommand, type ThemePreference } from '@taalcut/core';
import { z } from 'zod';

export interface FakeThemeTarget {
  getPreference(): ThemePreference;
  setPreference(preference: ThemePreference): unknown;
}

/** Apply theme commands to the browser preview's live theme engine, with the usual undo value. */
export function themeCommand(theme: FakeThemeTarget): AnyCommand {
  return defineCommand({
    name: 'settings.setTheme',
    payload: z.object({ preference: z.enum(['system', 'light', 'dark']) }),
    sideEffect: 'write',
    project: () => null,
    handle: async ({ preference }) => {
      const before = theme.getPreference();
      await theme.setPreference(preference);
      return ok({ result: null, inverse: { name: 'settings.setTheme', payload: { preference: before } } });
    },
  });
}
