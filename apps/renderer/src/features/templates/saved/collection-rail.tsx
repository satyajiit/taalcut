// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · Operate · component: Saved collections rail (Saved on Instagram; UX3, UX4 tpl) · system: DESIGN.md
 *   v0.6 + UX4 (the folder rail's recipe: folder-rail.tsx)
 * the Instagram collections as the library's folder rail draws its folders, so the two pages read alike: no box, a
 *   small heading, then one link each (UX4: a collection is a page, /templates/saved/$collectionId; All Saved is
 *   /templates/saved), led by its icon (All Saved a stack, a collection a bookmark), its name as written, an eye
 *   when it is watched (said in words for screen readers) and how many reels it holds. The search and the filter
 *   go with you to the next collection
 * states: default (ink-2) · hover (hover surface, ink) · focus-visible (base ring) · active (pressed, the row's
 *   give) · current (the views' raised thumb, ink, aria-current="page") · disabled, loading, error, success: n/a
 * contrast: ink-2 on canvas and hover ≥ 7:1; ink on raised ≥ 7:1; count ink-3 ≥ 4.5:1
 */
import { Trans, useLingui } from '@lingui/react/macro';
import { ALL_SAVED_COLLECTION_ID, type InstagramCollection } from '@taalcut/core';
import { cn, PRESS_ROW, renderIcon, useFormatters } from '@taalcut/ui';
import { Link } from '@tanstack/react-router';
import { TEMPLATE_ICONS } from '../template-icons';
import { CollectionName } from './watch-bar';

const ITEM = cn(
  'flex h-8 w-full min-w-0 cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-start type-label text-ink-2',
  PRESS_ROW,
  'hover:bg-hover hover:text-ink active:bg-pressed [&_[data-slot=glyph]]:text-ink-3',
  'aria-[current=page]:bg-raised aria-[current=page]:text-ink aria-[current=page]:shadow-xs aria-[current=page]:ring-1 aria-[current=page]:ring-rule',
  'aria-[current=page]:[&_[data-slot=glyph]]:text-ink-2',
);

export function CollectionRail({
  collections,
  active,
}: {
  readonly collections: readonly InstagramCollection[];
  readonly active: string;
}) {
  const { t } = useLingui();
  const formatters = useFormatters();
  return (
    // data-view-links: a collection picked here swaps the list like a view, so the shell's page turn can skip it.
    <nav
      aria-label={t`Saved collections`}
      className="flex flex-col gap-2"
      data-slot="saved-collections"
      data-view-links=""
    >
      <p className="m-0 px-2.5 type-caption text-ink-2">{t`Collections`}</p>
      <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
        {collections.map((col) => {
          const isAll = col.id === ALL_SAVED_COLLECTION_ID;
          const current = col.id === active ? ('page' as const) : undefined;
          const body = (
            <>
              {renderIcon(isAll ? TEMPLATE_ICONS.all : TEMPLATE_ICONS.saved, 'md')}
              <span className="min-w-0 flex-1 truncate">
                <CollectionName collection={col} />
              </span>
              {col.watched ? (
                <>
                  <TEMPLATE_ICONS.watched aria-hidden className="size-4 shrink-0 text-ink-2" />
                  <span className="sr-only">
                    <Trans>Watched</Trans>
                  </span>
                </>
              ) : null}
              <span className="shrink-0 type-meta text-ink-3 tabular-nums">
                {formatters.count(col.mediaCount)}
              </span>
            </>
          );
          return (
            <li key={col.id}>
              {isAll ? (
                <Link
                  activeOptions={{ exact: true }}
                  to="/templates/saved"
                  search={true}
                  aria-current={current}
                  className={ITEM}
                >
                  {body}
                </Link>
              ) : (
                <Link
                  activeOptions={{ exact: true }}
                  to="/templates/saved/$collectionId"
                  params={{ collectionId: col.id }}
                  search={true}
                  aria-current={current}
                  className={ITEM}
                >
                  {body}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
