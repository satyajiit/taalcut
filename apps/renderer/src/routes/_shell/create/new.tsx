// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { createFileRoute } from '@tanstack/react-router';
import { NewCreationPage } from '../../../features/create/create-page';

export interface NewCreationSearch {
  category?: 'product-launch' | 'custom';
  title?: string;
  prompt?: string;
  duration?: number;
  audioAssetId?: string;
}

export const Route = createFileRoute('/_shell/create/new')({
  validateSearch: (search: Record<string, unknown>): NewCreationSearch => ({
    category: search.category === 'custom' ? 'custom' : 'product-launch',
    ...(typeof search.title === 'string' && search.title.trim() ? { title: search.title.trim() } : {}),
    ...(typeof search.prompt === 'string' && search.prompt.trim() ? { prompt: search.prompt.trim() } : {}),
    ...(typeof search.duration === 'number' && Number.isFinite(search.duration) && search.duration > 0
      ? { duration: search.duration }
      : {}),
    ...(typeof search.audioAssetId === 'string' && search.audioAssetId.trim()
      ? { audioAssetId: search.audioAssetId.trim() }
      : {}),
  }),
  component: NewCreation,
});
function NewCreation() {
  const search = Route.useSearch();
  return (
    <NewCreationPage
      category={search.category}
      initialTitle={search.title}
      initialPrompt={search.prompt}
      initialDurationSeconds={search.duration}
      audioAssetId={search.audioAssetId}
    />
  );
}
