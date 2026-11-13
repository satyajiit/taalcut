// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { msg } from '@lingui/core/macro';
import { createFileRoute } from '@tanstack/react-router';
import { Starters } from '../../../../features/starters/starters-row';
import { StartFrame } from '../../../../features/templates/start/start-frame';

/** Start from… (UX4 tpl): the owner's one place for everything ready-made. Its first view is the starters. */
export const Route = createFileRoute('/_shell/templates/start/')({
  // A crumb: Formats and Community show "Templates › Start from… ›" (shell/nav).
  staticData: { crumb: msg`Start from…` },
  component: StartStarters,
});

function StartStarters() {
  return (
    <StartFrame view="starters">
      <Starters />
    </StartFrame>
  );
}
