// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { ReactNode } from 'react';
import { createSoundActivity } from '../../src/features/sounds/sound-activity';
import { SoundActivityProvider } from '../../src/features/sounds/sound-activity-context';

export function soundActivityHarness() {
  const activity = createSoundActivity();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SoundActivityProvider activity={activity}>{children}</SoundActivityProvider>
  );
  return { activity, wrapper };
}
