// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createFileRoute } from '@tanstack/react-router';
import { ThisMacSettings } from '../../features/settings/about/this-mac-settings';

/** Settings › General › This Mac (UX4): the hardware, where work runs, the GPU and the installed parts. */
export const Route = createFileRoute('/settings/this-mac')({
  staticData: { up: '/settings/general' },
  component: ThisMacSettings,
});
