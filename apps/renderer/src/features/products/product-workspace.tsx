// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · Operate · DESIGN.md: product context anchors the video shelf and secondary tools.
 * States: loading, failure, active view, dirty settings; keyboard selection and reduced-motion arrival. */

import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
import { PRODUCT_COMMANDS, type Product, type ProductId, type ProductInput } from '@taalcut/core';
import { Button, cn, CONCEPT_ICONS, UserContent, VERB_ICONS } from '@taalcut/ui';
import { useState } from 'react';
import { useBackend } from '../../backend/backend';
import { useCommand } from '../../backend/use-command';
import { useBackendEvents } from '../../backend/use-events';
import { useRpcQuery } from '../../backend/use-rpc';
import { Page } from '../../shell/page';
import { Loading, LoadError } from '../settings/fields';
import { ProductIdeas, ProductKnowledgeView, ProductVideos } from './product-content';
import { ProductFields } from './product-fields';
import { ProductActivity, ProductScheduleView } from './product-schedule';
import { ProductSources } from './product-sources';
import { ProductPublishing } from './product-publishing';
import { ProductArrival, ProductFacts, ProductHeading } from './product-layout';

export const PRODUCT_VIEWS = [
  'ideas',
  'videos',
  'publishing',
  'knowledge',
  'schedule',
  'activity',
  'settings',
] as const;
export type ProductView = (typeof PRODUCT_VIEWS)[number];
const WORDS = {
  ideas: msg`Ideas`,
  videos: msg`Videos`,
  publishing: msg`Publishing`,
  knowledge: msg`Knowledge`,
  schedule: msg`Schedule`,
  activity: msg`Activity`,
  settings: msg`Product settings`,
};
const ICONS = {
  ideas: VERB_ICONS.findSimilar,
  videos: CONCEPT_ICONS.project,
  publishing: VERB_ICONS.share,
  knowledge: CONCEPT_ICONS.memory,
  schedule: CONCEPT_ICONS.date,
  activity: CONCEPT_ICONS.version,
  settings: CONCEPT_ICONS.general,
};

export function ProductWorkspace({
  productId,
  view,
  onView,
}: {
  productId: ProductId;
  view: ProductView;
  onView: (view: ProductView) => void;
}) {
  const { t } = useLingui();
  const backend = useBackend();
  const [dirty, setDirty] = useState(false);
  const product = useRpcQuery(
    (signal) => backend.products.get({ productId }, { signal }),
    [backend, productId],
  );
  useBackendEvents(['command.changed'], ({ payload }) => {
    if (payload.name.startsWith('product.') && !dirty) product.reload();
  });
  return (
    <Page
      title={t`Products`}
      detail={product.data ? <UserContent>{product.data.name}</UserContent> : undefined}
      width="wide"
    >
      {product.status === 'loading' && !product.data ? <Loading /> : null}
      {product.status === 'error' ? (
        <LoadError error={product.error} onRetry={product.reload} what={t`This product didn’t load.`} />
      ) : null}
      {product.data ? (
        <div className="grid min-w-0 gap-8 xl:grid-cols-[208px_minmax(0,1fr)] xl:gap-10">
          <aside className="flex min-w-0 flex-col gap-5 xl:border-r xl:border-rule xl:pr-7">
            <div className="flex flex-col gap-3">
              <h2 className="m-0 type-page-title text-ink">
                <UserContent className="break-words">{product.data.name}</UserContent>
              </h2>
              {product.data.description ? (
                <UserContent className="line-clamp-3 type-body text-ink-2">
                  {product.data.description}
                </UserContent>
              ) : null}
              <ProductFacts product={product.data} />
            </div>
            <ProductNavigation view={view} onView={onView} dirty={dirty} />
            {dirty ? (
              <p className="m-0 type-meta text-ink-2">{t`Save or discard your changes to switch views.`}</p>
            ) : null}
          </aside>
          <ProductArrival key={view} className="min-w-0">
            {view === 'ideas' ? <ProductIdeas productId={productId} /> : null}
            {view === 'videos' ? <ProductVideos productId={productId} /> : null}
            {view === 'publishing' ? <ProductPublishing productId={productId} /> : null}
            {view === 'knowledge' ? <ProductKnowledgeView productId={productId} /> : null}
            {view === 'schedule' ? <ProductScheduleView productId={productId} /> : null}
            {view === 'activity' ? <ProductActivity productId={productId} /> : null}
            {view === 'settings' ? (
              <ProductSettings
                key={`${productId}:${product.data.revision}`}
                product={product.data}
                onDirty={setDirty}
                onSaved={product.reload}
              />
            ) : null}
          </ProductArrival>
        </div>
      ) : null}
    </Page>
  );
}

function ProductNavigation({
  view,
  onView,
  dirty,
}: {
  view: ProductView;
  onView: (view: ProductView) => void;
  dirty: boolean;
}) {
  const { t, i18n } = useLingui();
  return (
    <div
      role="radiogroup"
      aria-label={t`Product workspace`}
      className="flex flex-wrap gap-1 xl:flex-col"
      onKeyDown={(event) => {
        if (dirty) return;
        const at = PRODUCT_VIEWS.indexOf(view);
        const next =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? PRODUCT_VIEWS.length - 1
              : ['ArrowDown', 'ArrowRight'].includes(event.key)
                ? (at + 1) % PRODUCT_VIEWS.length
                : ['ArrowUp', 'ArrowLeft'].includes(event.key)
                  ? (at + PRODUCT_VIEWS.length - 1) % PRODUCT_VIEWS.length
                  : null;
        if (next === null) return;
        event.preventDefault();
        onView(PRODUCT_VIEWS[next]!);
        event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
      }}
    >
      {PRODUCT_VIEWS.map((value) => {
        const Icon = ICONS[value];
        return (
          <Button
            key={value}
            role="radio"
            aria-checked={view === value}
            tabIndex={view === value ? 0 : -1}
            variant="ghost"
            icon={Icon}
            disabled={dirty && value !== view}
            onClick={() => onView(value)}
            className={cn(
              'h-auto min-h-9 justify-start py-2 text-left whitespace-normal [&>span]:break-words',
              view === value && 'bg-well text-ink',
              value === 'knowledge' && 'xl:mt-5',
            )}
          >
            {i18n._(WORDS[value])}
          </Button>
        );
      })}
    </div>
  );
}

function ProductSettings({
  product,
  onDirty,
  onSaved,
}: {
  product: Product;
  onDirty: (dirty: boolean) => void;
  onSaved: () => void;
}) {
  const { t } = useLingui();
  const command = useCommand();
  const [value, setValue] = useState<ProductInput>(product);
  const set = (next: ProductInput) => {
    setValue(next);
    onDirty(true);
  };
  return (
    <form
      className="flex flex-col gap-8"
      onSubmit={async (event) => {
        event.preventDefault();
        const result = await command.run({
          name: PRODUCT_COMMANDS.update,
          payload: { productId: product.id, revision: product.revision, product: value },
        });
        if (result.ok) {
          onDirty(false);
          onSaved();
        }
      }}
    >
      <ProductHeading
        title={t`Product settings`}
      >{t`Keep the context and sources behind every new video up to date.`}</ProductHeading>
      <ProductFields value={value} onChange={set} disabled={command.pending}>
        <ProductSources
          sources={value.sources}
          onChange={(sources) => set({ ...value, sources })}
          disabled={command.pending}
        />
      </ProductFields>
      <div className="flex flex-wrap gap-3 border-t border-rule pt-6">
        <Button
          type="submit"
          variant="primary"
          loading={command.pending}
          disabled={!value.name.trim()}
        >{t`Save product`}</Button>
        <Button
          type="button"
          variant="ghost"
          disabled={command.pending}
          onClick={() => {
            setValue(product);
            onDirty(false);
          }}
        >{t`Discard changes`}</Button>
      </div>
    </form>
  );
}
