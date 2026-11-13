// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · page: settings memory (LRN1-MEM) · system: DESIGN.md v0.6 + UX4 · the kit's PageSections
 *   (features/settings/memory) */
import { createFileRoute } from '@tanstack/react-router';
import { MemorySettings } from '../../features/settings/memory/memory-settings';

export const Route = createFileRoute('/settings/memory')({
  component: () => <MemorySettings />,
});
