// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * "Open the Share dialog for this template" from outside its page (P3-B12): the agent's hub.openShare (main sends
 * `ui.action` 'hub.openShare'), a card's Share, the palette. The request waits here while the window opens the
 * template's page; ShareToHub there takes it and opens the dialog. One at a time: a newer request replaces it.
 */
import type { TemplateId } from '@taalcut/core';
import type { useNavigate } from '@tanstack/react-router';
import { useSyncExternalStore } from 'react';

export interface ShareRequest {
  readonly templateId: TemplateId;
  readonly version?: number | undefined;
}

let pending: ShareRequest | null = null;
const listeners = new Set<() => void>();

const emit = () => {
  for (const listener of listeners) listener();
};

export function requestShare(request: ShareRequest): void {
  pending = request;
  emit();
}

/** Takes the request for this template, if there is one (the dialog opens once). */
export function takeShareRequest(templateId: TemplateId): ShareRequest | null {
  if (pending?.templateId !== templateId) return null;
  const taken = pending;
  pending = null;
  emit();
  return taken;
}

/** The waiting request, re-rendering when it changes. */
export function useShareRequest(): ShareRequest | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => pending,
  );
}

/** Opens the template's page with its Share dialog open (`ui.action` hub.openShare, a card's Share). */
export function openHubShare(
  navigate: ReturnType<typeof useNavigate>,
  templateId: TemplateId,
  version?: number,
): void {
  requestShare({ templateId, version });
  void navigate({ to: '/templates/$templateId/details', params: { templateId } });
}
