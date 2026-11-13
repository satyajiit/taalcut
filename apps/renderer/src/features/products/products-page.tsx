// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · Operate · DESIGN.md: product dossiers with actual sources and formats, then a source-first setup.
 * States: loading, error, empty, populated/paged, form pending; Kaatu stays beside the task, never on media. */

import { useLingui } from '@lingui/react/macro';
import {
  newId,
  PRODUCT_COMMANDS,
  productInputSchema,
  type ProductInput,
  type ProductId,
} from '@taalcut/core';
import { Button, cn, CONCEPT_ICONS, KaatuMoment, UserContent, VERB_ICONS } from '@taalcut/ui';
import { Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useBackend } from '../../backend/backend';
import { useCommand } from '../../backend/use-command';
import { useBackendEvents } from '../../backend/use-events';
import { useRpcQuery } from '../../backend/use-rpc';
import { Page } from '../../shell/page';
import { Loading, LoadError } from '../settings/fields';
import { ProductFields } from './product-fields';
import { ProductSources } from './product-sources';
import { ProductFacts, ProductFormatSummary } from './product-layout';
import { ProductCollectionEmpty } from './product-collection-empty';

export function ProductsPage() {
  const { t, i18n } = useLingui();
  const backend = useBackend();
  const Next = VERB_ICONS.next;
  const Source = CONCEPT_ICONS.source;
  const [pages, setPages] = useState<ProductId[]>([]);
  const after = pages.at(-1);
  const list = useRpcQuery(
    (signal) => backend.products.list({ ...(after ? { after } : {}), limit: 50 }, { signal }),
    [backend, after],
  );
  useBackendEvents(['command.changed'], ({ payload }) => {
    if (payload.name.startsWith('product.')) list.reload();
  });
  return (
    <Page
      title={t`Products`}
      width="wide"
      description={t`Turn what you’re building into videos worth sharing.`}
      actions={
        <Button size="sm" variant="primary" asChild icon={VERB_ICONS.add}>
          <Link to="/products/new">{t`Add product`}</Link>
        </Button>
      }
    >
      {list.status === 'loading' && !list.data ? <Loading /> : null}
      {list.status === 'error' ? (
        <LoadError error={list.error} onRetry={list.reload} what={t`Your products didn’t load.`} />
      ) : null}
      {list.data?.items.length === 0 ? (
        <ProductCollectionEmpty />
      ) : (
        <div className="flex flex-col gap-6">
          <div className="grid gap-5 lg:grid-cols-2">
            {list.data?.items.map((product, index) => (
              <Link
                key={product.id}
                to="/products/$productId"
                params={{ productId: product.id }}
                className={cn(
                  'group flex min-w-0 flex-col rounded-xl border border-rule bg-raised p-6 transition-[transform,background-color] duration-200 hover:bg-hover focus-visible:outline-2 focus-visible:outline-focus motion-safe:hover:-translate-y-0.5 motion-safe:active:translate-y-0 motion-reduce:transition-none',
                  index === 0 && 'lg:col-span-2 lg:p-8',
                )}
              >
                <div
                  className={cn('flex min-w-0 flex-1 flex-col gap-5', index === 0 && 'lg:flex-row lg:gap-12')}
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-3">
                    <h2 className={cn('m-0 text-ink', index === 0 ? 'type-headline' : 'type-page-title')}>
                      <UserContent className="break-words">{product.name}</UserContent>
                    </h2>
                    <UserContent className="line-clamp-3 max-w-prose type-body text-ink-2">
                      {product.description}
                    </UserContent>
                    <ProductFacts product={product} />
                  </div>
                  <div
                    className={cn(
                      'flex min-w-0 flex-col gap-3',
                      index === 0 && 'lg:w-64 lg:border-l lg:border-rule lg:pl-8',
                    )}
                  >
                    <ProductFormatSummary formats={product.preferences.formats} />
                    <span className="type-meta text-ink-2">
                      {product.preferences.ideaPolicy === 'auto-draft'
                        ? t`Drafts prepared for you`
                        : t`You choose each idea`}
                    </span>
                    {product.sources.length ? (
                      product.sources.slice(0, 3).map((source) => (
                        <div key={source.id} className="flex min-w-0 items-center gap-2 type-meta text-ink-2">
                          <Source aria-hidden className="size-3.5 shrink-0" />
                          <UserContent className="truncate">{source.label}</UserContent>
                        </div>
                      ))
                    ) : (
                      <span className="type-meta text-ink-2">{t`Add sources to find your next story.`}</span>
                    )}
                  </div>
                </div>
                <div className="mt-6 flex items-center justify-between gap-4 border-t border-rule pt-4">
                  <time className="type-meta text-ink-3" dateTime={new Date(product.updatedAt).toISOString()}>
                    {i18n.date(product.updatedAt, { dateStyle: 'medium' })}
                  </time>
                  <span className="inline-flex items-center gap-2 type-label text-ink">
                    {t`Explore ideas`}
                    <Next
                      aria-hidden
                      className="size-4 transition-transform group-hover:translate-x-0.5 motion-reduce:transform-none"
                    />
                  </span>
                </div>
              </Link>
            ))}
          </div>
          <div className="flex gap-3">
            {pages.length ? (
              <Button
                variant="ghost"
                onClick={() => setPages((value) => value.slice(0, -1))}
              >{t`Previous products`}</Button>
            ) : null}
            {list.data?.nextCursor ? (
              <Button
                variant="ghost"
                onClick={() => setPages((value) => [...value, list.data!.nextCursor!])}
              >{t`More products`}</Button>
            ) : null}
          </div>
        </div>
      )}
    </Page>
  );
}

export function NewProductPage() {
  const { t, i18n } = useLingui();
  const command = useCommand();
  const navigate = useNavigate();
  const [value, setValue] = useState<ProductInput>(() => ({
    ...productInputSchema.parse({ name: t`New product`, preferences: { language: i18n.locale } }),
    name: '',
  }));
  return (
    <Page
      title={t`Add product`}
      width="wide"
      description={t`Set the context once. Every video and conversation can build on it.`}
    >
      <div className="grid min-w-0 gap-10 xl:grid-cols-[minmax(0,1fr)_240px] xl:gap-14">
        <form
          className="flex min-w-0 flex-col gap-8"
          onSubmit={async (event) => {
            event.preventDefault();
            const productId = newId<'Product'>();
            const result = await command.run({
              name: PRODUCT_COMMANDS.create,
              payload: { productId, product: value },
            });
            if (result.ok) await navigate({ to: '/products/$productId', params: { productId } });
          }}
        >
          <ProductFields value={value} onChange={setValue} disabled={command.pending}>
            <ProductSources
              sources={value.sources}
              onChange={(sources) => setValue({ ...value, sources })}
              disabled={command.pending}
            />
            <Button
              type="submit"
              variant="primary"
              className="self-start"
              loading={command.pending}
              disabled={!value.name.trim()}
            >{t`Create product`}</Button>
          </ProductFields>
        </form>
        <aside className="flex flex-col gap-6 border-t border-rule pt-6 xl:border-t-0 xl:border-l xl:pt-0 xl:pl-7">
          <div>
            <h2 className="m-0 type-section text-ink">{t`Your next video starts here`}</h2>
            <p className="mt-3 mb-0 type-body text-ink-2">{t`Describe the product and attach a source. You can refine the video preferences whenever you need.`}</p>
          </div>
          <ProductFacts product={value} />
          <KaatuMoment tone="tip">{t`A real source gives every idea something to build on.`}</KaatuMoment>
        </aside>
      </div>
    </Page>
  );
}
