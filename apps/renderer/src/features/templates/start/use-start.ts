// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Start from…'s two verbs, the same for every source (UX4 tpl, the owner's decision of 2026-10-28):
 * - **Use for a video** opens a chat that makes a video from it. A starter or a community template is copied into
 *   your templates first (a copy you already have is used as it is), so the chat starts from a template of yours
 *   (`{ path: 'template' }`, as the opening card and Templates that fit do). A format has nothing to copy: its ask
 *   goes into a new chat's composer, unsent, so the person can say which clips first.
 * - **Copy to my templates** only copies it, and says where it went.
 * Both are commands from 'ui', so ⌘Z takes a copy back.
 */
import { useLingui } from '@lingui/react/macro';
import { newId, ok, type Result, type TemplateId } from '@taalcut/core';
import { useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';
import { useBackend } from '../../../backend/backend';
import { addStarterTemplate } from '../../../chat/starter-actions';
import { sendWhenOpen } from '../../../chat/handoff';
import { forkFromHub, type ForkRequest } from '../hub/use-fork';

/** A ready-made thing that can be copied into your templates: a starter, or a community template. */
export type Copyable =
  | { readonly kind: 'starter'; readonly starterId: string }
  | ({ readonly kind: 'community'; readonly forkedAs: TemplateId | null } & ForkRequest);

export function useStartActions() {
  const { t } = useLingui();
  const backend = useBackend();
  const navigate = useNavigate();

  /** Copies it into your templates, or names the copy this Mac already has. */
  const copy = useCallback(
    async (source: Copyable): Promise<Result<{ readonly templateId: TemplateId }>> => {
      if (source.kind === 'starter') return addStarterTemplate(backend, source.starterId);
      if (source.forkedAs) return ok({ templateId: source.forkedAs });
      return forkFromHub(backend, { hubId: source.hubId, version: source.version, sha256: source.sha256 });
    },
    [backend],
  );

  /** A new chat that makes a video from a template of yours, started at once. */
  const makeVideo = useCallback(
    (templateId: TemplateId, name: string) => {
      const conversationId = newId<'Conversation'>();
      sendWhenOpen(conversationId, t`Make a video with my template “${name}”`, undefined, {
        path: 'template',
        templateId,
      });
      void navigate({ to: '/chat/$conversationId', params: { conversationId } });
    },
    [navigate, t],
  );

  /** Use for a video: copy (or reuse the copy), then the chat. The failure is the caller's to show. */
  const use = useCallback(
    async (source: Copyable, name: string): Promise<Result<{ readonly templateId: TemplateId }>> => {
      const copied = await copy(source);
      if (copied.ok) makeVideo(copied.value.templateId, name);
      return copied;
    },
    [copy, makeVideo],
  );

  const open = useCallback(
    (templateId: TemplateId) => void navigate({ to: '/templates/$templateId', params: { templateId } }),
    [navigate],
  );

  return { copy, use, makeVideo, open };
}
