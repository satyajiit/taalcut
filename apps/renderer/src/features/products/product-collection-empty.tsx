// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · Operate · DESIGN.md: an empty dossier teaches the collection's real structure.
 * State: no products; the diagram is illustrative, with one Kaatu beside the welcome. */
import { useLingui } from '@lingui/react/macro';
import { CONCEPT_ICONS, EmptyState, VERB_ICONS } from '@taalcut/ui';
import { ProductArrival, ProductFormatSummary } from './product-layout';

export function ProductCollectionEmpty() {
  const { t } = useLingui();
  const Website = CONCEPT_ICONS.hub;
  const Folder = CONCEPT_ICONS.folder;
  const Next = VERB_ICONS.next;
  return (
    <ProductArrival className="grid items-center gap-10 py-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:gap-14">
      <div className="flex flex-col gap-6">
        <EmptyState
          title={t`One product. More stories to tell.`}
          description={t`Keep its sources, ideas and videos together. Taalcut remembers what you’ve shared and looks for the next useful story.`}
        />
        <p className="m-0 max-w-prose type-body text-ink-2">{t`Start with your website or project folder. Choose a fresh angle, make a video, then approve exactly what gets shared.`}</p>
      </div>
      <figure className="m-0 flex min-w-0 flex-col gap-5">
        <div className="rounded-xl border border-dashed border-rule-strong bg-raised p-6 sm:p-8">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div className="min-w-0 flex-1">
              <p className="m-0 type-page-title text-ink-2">{t`Your product`}</p>
              <div aria-hidden className="mt-5 flex flex-col gap-2">
                <span className="h-1.5 w-3/4 rounded-sm bg-rule" />
                <span className="h-1.5 w-1/2 rounded-sm bg-rule" />
              </div>
            </div>
            <ProductFormatSummary formats={['9:16', '16:9']} />
          </div>
          <div className="mt-7 flex flex-col gap-4 border-t border-rule pt-5">
            <div className="flex items-center gap-3 type-body text-ink-2">
              <Website aria-hidden className="size-4" />
              <span>{t`Your website`}</span>
            </div>
            <div className="flex items-center gap-3 type-body text-ink-2">
              <Folder aria-hidden className="size-4" />
              <span>{t`Your project folder`}</span>
            </div>
          </div>
          <div className="mt-7 flex flex-wrap items-center gap-3 border-t border-rule pt-5 type-label text-ink-2">
            <span>{t`Sources`}</span>
            <Next aria-hidden className="size-4" />
            <span>{t`Video ideas`}</span>
            <Next aria-hidden className="size-4" />
            <span>{t`Your videos`}</span>
          </div>
        </div>
        <figcaption className="type-meta text-ink-2">{t`A place for the sources, formats and stories behind your product.`}</figcaption>
      </figure>
    </ProductArrival>
  );
}
