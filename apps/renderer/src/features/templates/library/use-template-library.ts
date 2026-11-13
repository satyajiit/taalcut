// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What the template library shows (P3-V14, LRN1-FIX): the view's one answer (library-answer.ts: the list without
 * words, templates.search's answer with them), the facts the filters offer (tags, languages, formats in the library)
 * and the folders. Each re-reads when a template or folder changes; a burst of changes (a move of 200) is one read.
 *
 * One search runs at a time: the newest words go as soon as the last answer is in, so the last key's words always
 * run next, nothing waits on a timer, and typing never queues a search per key behind the Search model.
 */
import type { TaalcutError, TemplateFolder, TemplateSummary } from '@taalcut/core';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useBackend } from '../../../backend/backend';
import { useBackendEvents } from '../../../backend/use-events';
import { useRpcQuery, type Loadable, type Reloadable } from '../../../backend/use-rpc';
import { searchScopeOf } from '../search/search-scope';
import { answerFor, listAll, viewOf, type LibraryAnswer } from './library-answer';
import { listQueryOf, type TemplateSearch } from './template-search';

/** A counter that moves (once per frame at most) when templates or folders change. */
function useLibraryRound(): number {
  const [round, setRound] = useState(0);
  const pending = useRef(false);
  const bump = () => {
    if (pending.current) return;
    pending.current = true;
    requestAnimationFrame(() => {
      pending.current = false;
      setRound((n) => n + 1);
    });
  };
  useBackendEvents(['library.changed', 'command.changed'], (event) => {
    if (
      event.type === 'library.changed'
        ? event.payload.entity === 'template'
        : /^template/.test(event.payload.name)
    )
      bump();
  });
  return round;
}

export interface LibraryFacets {
  /** Tags in use, most used first. */
  readonly tags: readonly string[];
  readonly languages: readonly string[];
  readonly formats: readonly NonNullable<TemplateSummary['formatId']>[];
  /** Templates in the library (archived ones aside). */
  readonly total: number;
}

function facetsOf(items: readonly TemplateSummary[]): LibraryFacets {
  const tags = new Map<string, number>();
  const languages = new Set<string>();
  const formats = new Set<NonNullable<TemplateSummary['formatId']>>();
  for (const item of items) {
    for (const tag of item.tags) tags.set(tag, (tags.get(tag) ?? 0) + 1);
    if (item.language) languages.add(item.language);
    if (item.formatId) formats.add(item.formatId);
  }
  return {
    tags: [...tags.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([tag]) => tag),
    languages: [...languages].sort(),
    formats: [...formats].sort(),
    total: items.length,
  };
}

export interface TemplateLibrary {
  /** The view's one answer; the last answer stays while the next loads. */
  readonly list: Reloadable<LibraryAnswer>;
  /** The answer on screen is for an older view (other words or filters) while the new one loads. */
  readonly settling: boolean;
  /** The read for this view failed (an older view's answer may still be on screen; it isn't this one's). */
  readonly failed: TaalcutError | null;
  readonly facets: LibraryFacets | undefined;
  readonly folders: Loadable<readonly TemplateFolder[]> & { reload: () => void };
}

/** The view's answer for `words` (the field's, trimmed), its facets and folders. */
export function useTemplateLibrary(search: TemplateSearch, words: string): TemplateLibrary {
  const backend = useBackend();
  const round = useLibraryRound();
  const query = useMemo(() => listQueryOf(search), [search]);
  const scope = useMemo(() => searchScopeOf(search), [search]);
  const key = JSON.stringify(query);
  const { length } = search;
  // The words asked: the newest whenever no answer is loading. While one loads, later keys wait for it; then the
  // newest words go at once.
  const [asked, setAsked] = useState(words);
  const list = useRpcQuery(
    (signal) => answerFor(backend.templates, { words: asked, query, scope, length }, signal),
    [backend, asked, key, length, round],
  );
  const loading = list.status === 'loading';
  useEffect(() => {
    if (!loading && asked !== words) setAsked(words);
  }, [loading, asked, words]);
  const everything = useRpcQuery((signal) => listAll(backend.templates, {}, signal), [backend, round]);
  const folders = useRpcQuery((signal) => backend.templates.folders(undefined, { signal }), [backend, round]);
  const facets = useMemo(() => (everything.data ? facetsOf(everything.data) : undefined), [everything.data]);
  const view = viewOf(words, query, length);
  const settling = list.data !== undefined && list.data.view !== view;
  const failed = list.status === 'error' && (list.data === undefined || settling) ? list.error : null;
  return { list, settling, failed, facets, folders };
}
