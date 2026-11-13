// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { useLingui } from '@lingui/react/macro';
import {
  callRpc,
  type ConversationSummary,
  type ProjectSummary,
  type SearchHit,
  type TemplateSummary,
} from '@taalcut/core';
import { CONCEPT_ICONS, toSeconds, useFormatters, type PaletteItem } from '@taalcut/ui';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { useBackend } from '../../backend/backend';
import { useServices } from '../../services/provider';
import { templateName } from '../templates/library/library-words';
import { clipFinds } from './clip-finds';

/** Typing settles for this long before the app is asked for templates and clips. */
const SETTLE_MS = 150;
/** The most clips one search lists (several shots of one clip are one clip). */
const CLIPS = 5;
const TEMPLATES = 5;

interface Lists {
  readonly chats: readonly ConversationSummary[];
  readonly projects: readonly ProjectSummary[];
}

/** Your chats and projects, read each time ⌘K opens: few enough to search here, letter by letter. */
function useLists(opened: number): Lists | null {
  const backend = useBackend();
  const { chat } = useServices();
  const [lists, setLists] = useState<Lists | null>(null);
  useEffect(() => {
    if (opened === 0) return;
    const controller = new AbortController();
    void Promise.all([
      chat.listConversations(),
      callRpc(backend.projects.list({ archived: false, limit: 200 }, { signal: controller.signal })),
    ]).then(([chats, projects]) => {
      if (controller.signal.aborted) return;
      setLists({
        chats: chats.ok ? chats.value : [],
        projects: projects.ok ? projects.value.items : [],
      });
    });
    return () => controller.abort();
  }, [backend, chat, opened]);
  return lists;
}

interface Finds {
  readonly query: string;
  readonly templates: readonly TemplateSummary[];
  /** The library search's shots, best first; clip-finds.ts picks the clips to list from them. */
  readonly hits: readonly SearchHit[];
}

/** Templates by name and clips by name or what is in them, for what is typed once it settles. */
function useFinds(query: string): { finds: Finds | null; searching: boolean } {
  const backend = useBackend();
  const [finds, setFinds] = useState<Finds | null>(null);
  const words = query.trim();
  useEffect(() => {
    if (words === '') return;
    const controller = new AbortController();
    const { signal } = controller;
    const timer = window.setTimeout(() => {
      void Promise.all([
        callRpc(backend.templates.list({ query: words, limit: TEMPLATES }, { signal })),
        callRpc(backend.library.search({ query: words, limit: 30 }, { signal })),
      ]).then(([templates, clips]) => {
        if (signal.aborted) return;
        setFinds({
          query: words,
          templates: templates.ok ? templates.value.items : [],
          hits: clips.ok ? clips.value.hits : [],
        });
      });
    }, SETTLE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [backend, words]);
  const current = finds?.query === words ? finds : null;
  return { finds: current, searching: words !== '' && current === null };
}

/**
 * ⌘K's finds (UX4, B15): your chats, projects, clips and templates by name, each a way to its page. Chats and
 * projects are searched here as you type; templates and clips are asked of the app once typing settles (clips by what
 * is said or shown in them too, with that passage under the name: clip-finds.ts). They are listed only once
 * something is typed, each under its own heading with its glyph.
 */
export function useFoundItems(query: string, opened: number): { items: PaletteItem[]; searching: boolean } {
  const { t, i18n } = useLingui();
  const navigate = useNavigate();
  const format = useFormatters();
  const lists = useLists(opened);
  const { finds, searching } = useFinds(query);

  const listed = useMemo<PaletteItem[]>(() => {
    if (!lists) return [];
    const ChatIcon = CONCEPT_ICONS.chat;
    const ProjectIcon = CONCEPT_ICONS.project;
    return [
      ...lists.chats
        .filter((chat) => chat.title.trim() !== '')
        .map<PaletteItem>((chat) => ({
          id: `chat.${chat.id}`,
          title: chat.title,
          group: t`Chats`,
          scope: 'search',
          icon: <ChatIcon aria-hidden />,
          detail: format.relativeDay(chat.updatedAt),
          run: () => void navigate({ to: '/chat/$conversationId', params: { conversationId: chat.id } }),
        })),
      ...lists.projects.map<PaletteItem>((project) => ({
        id: `project.${project.id}`,
        title: project.name,
        group: t`Projects`,
        scope: 'search',
        icon: <ProjectIcon aria-hidden />,
        detail: format.relativeDay(project.updatedAt),
        run: () => void navigate({ to: '/projects/$projectId/timeline', params: { projectId: project.id } }),
      })),
    ];
  }, [lists, t, format, navigate]);

  const found = useMemo<PaletteItem[]>(() => {
    if (!finds) return [];
    const TemplateIcon = CONCEPT_ICONS.template;
    const ClipIcon = CONCEPT_ICONS.clip;
    return [
      ...finds.templates.map<PaletteItem>((template) => ({
        id: `template.${template.id}`,
        title: templateName(i18n, template),
        group: t`Templates`,
        scope: 'search',
        found: true,
        icon: <TemplateIcon aria-hidden />,
        run: () => void navigate({ to: '/templates/$templateId', params: { templateId: template.id } }),
      })),
      ...clipFinds(i18n, finds.hits, finds.query, CLIPS).map<PaletteItem>(({ asset: clip, why }) => ({
        id: `clip.${clip.id}`,
        title: clip.name,
        group: t`Clips`,
        scope: 'search',
        found: true,
        ...(why ? { why } : {}),
        icon: <ClipIcon aria-hidden />,
        ...(clip.duration ? { detail: format.duration(toSeconds(clip.duration) * 1000) } : {}),
        run: () => void navigate({ to: '/library/$assetId', params: { assetId: clip.id } }),
      })),
    ];
  }, [finds, t, i18n, format, navigate]);

  return { items: useMemo(() => [...listed, ...found], [listed, found]), searching };
}
