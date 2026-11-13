// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createFileRoute } from '@tanstack/react-router';
import { Formats } from '../../../../features/templates/start/formats';
import { StartFrame } from '../../../../features/templates/start/start-frame';

/** Start from… › Formats (UX4 tpl): the formats Taalcut plans itself. */
export const Route = createFileRoute('/_shell/templates/start/formats')({
  component: StartFormats,
});

function StartFormats() {
  return (
    <StartFrame view="formats">
      <Formats />
    </StartFrame>
  );
}
