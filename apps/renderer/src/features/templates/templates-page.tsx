// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · Operate · page: Your templates (/templates and /templates/folders/$folderId; P2-T6, P3-V14, UX3, UX4
 *   tpl) · system: DESIGN.md v0.6 + UX4 (Page, ViewLinks, PageTip; design-tpl.md)
 * one job: find and open one of your templates. The area's views first; a first-visit tip (what the list holds and
 *   where the other jobs went); then the managed library: the folder list (each a link, so a folder has a URL and
 *   Back works), search, one row of filters and the sort over the windowed list, a bulk bar while some are picked,
 *   and a drop anywhere imports files. Making one (New) and starting from something ready-made (Start from…) are
 *   views of their own now. The window bar reads "Templates", or "Templates › Travel" in a folder. LRN1-TPL,
 *   LRN1-FIX: with words in the field the list is templates.search's one answer (search/). LRN1-STY: a folder's
 *   view, or one tag's, has its set's style profile above the list
 * states: the library's (library-section.tsx) · before the first template, the page is the empty state (Kaatu, the
 *   link field, Import; templates-empty.tsx) and the tip doesn't show (the empty state teaches)
 * motion: the views' thumb; rows arrive once; the bulk bar rises; the drop panel fades
 */
import { useLingui } from '@lingui/react/macro';
import type { TemplateFolder } from '@taalcut/core';
import { UserContent } from '@taalcut/ui';
import type { ReactNode } from 'react';
import { PageTip } from '../kaatu/page-tip';
import { Page } from '../../shell/page';
import { LibrarySection } from './library/library-section';
import { hasFilters, type TemplateSearch } from './library/template-search';
import { useSearchText } from './library/use-search-text';
import { useTemplateLibrary } from './library/use-template-library';
import { SearchSuggestionsContext } from './search/search-suggestions';
import { searchViewOf } from './search/search-view';
import { useSearchSuggestions } from './search/use-search-suggestions';
import { styleSourceOfView } from './profiles/view-style-source';
import { EmptyLibrary } from './templates-empty';
import { TemplatesViews } from './templates-views';

export interface TemplatesPageProps {
  /** The view's search; its folder comes from the path (/templates/folders/$folderId). */
  readonly search: TemplateSearch;
  /** A new view: `replace` for typing and filters. */
  readonly onSearch: (next: Partial<TemplateSearch>, replace: boolean) => void;
  readonly now?: number;
}

/** The folder's name in the window bar, after "Templates ›". */
function useFolderTitle(
  folder: TemplateSearch['folder'],
  folders: readonly TemplateFolder[] | undefined,
): ReactNode {
  const { t } = useLingui();
  if (!folder) return undefined;
  if (folder === 'favourites') return t`Favourites`;
  if (folder === 'unfiled') return t`Not in a folder`;
  const name = folders?.find((each) => each.id === folder)?.name;
  return name ? <UserContent translate="no">{name}</UserContent> : undefined;
}

export function TemplatesPage({ search, onSearch, now = Date.now() }: TemplatesPageProps) {
  const { t } = useLingui();
  const { text, setText, words } = useSearchText(search, onSearch);
  // One answer for the list, its count and the panel: templates.search with words, templates.list without.
  const library = useTemplateLibrary(search, words);
  const suggestions = useSearchSuggestions(searchViewOf(library, words));
  const filtered = Boolean(words) || hasFilters(search);
  const styleSource = styleSourceOfView(search, words, library.folders.data, library.list.data?.items.length);
  const empty =
    library.facets?.total === 0 && library.list.data?.items.length === 0 && !filtered && !search.folder;
  const detail = useFolderTitle(search.folder, library.folders.data);

  return (
    <Page
      title={t`Templates`}
      width="wide"
      views={<TemplatesViews current="mine" />}
      {...(detail ? { detail } : {})}
    >
      <div className="flex flex-col gap-8" data-slot="templates-page">
        {empty ? (
          <EmptyLibrary />
        ) : (
          <>
            {search.folder ? null : (
              <PageTip id="templates">
                {t`Your templates live here. Open one to make a video with it; New makes one from a reel, and Start from… has ready-made ones.`}
              </PageTip>
            )}
            <SearchSuggestionsContext.Provider value={suggestions}>
              <LibrarySection
                search={search}
                onSearch={onSearch}
                library={library}
                text={text}
                onText={setText}
                filtered={filtered}
                styleSource={styleSource}
                now={now}
              />
            </SearchSuggestionsContext.Provider>
          </>
        )}
      </div>
    </Page>
  );
}
