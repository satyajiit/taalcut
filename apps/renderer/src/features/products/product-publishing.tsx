// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · Operate · DESIGN.md: choose a video before reviewing its destinations.
 * States: loading, empty, failure and selected campaign; URL and publishing gates stay unchanged. */
import { useLingui } from '@lingui/react/macro';
import type { ProductId } from '@taalcut/core';
import { Button, EmptyState, Select, VERB_ICONS } from '@taalcut/ui';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useBackend } from '../../backend/backend';
import { useBackendEvents } from '../../backend/use-events';
import { useRpcQuery } from '../../backend/use-rpc';
import { Field, Loading, LoadError } from '../settings/fields';
import { CampaignPublisher } from './product-campaign-publisher';
import { ProductHeading } from './product-layout';

export function ProductPublishing({ productId }: { productId: ProductId }) {
  const { t } = useLingui();
  const backend = useBackend();
  const history = useRpcQuery(
    (signal) => backend.products.history({ productId }, { signal }),
    [backend, productId],
  );
  const product = useRpcQuery(
    (signal) => backend.products.get({ productId }, { signal }),
    [backend, productId],
  );
  const ideas = useRpcQuery(
    (signal) => backend.products.ideas({ productId }, { signal }),
    [backend, productId],
  );
  const [campaignId, setCampaignId] = useState('');
  const campaign = history.data?.items.find((item) => item.id === campaignId) ?? history.data?.items[0];
  useBackendEvents(['command.changed'], ({ payload }) => {
    if (payload.name.startsWith('product.') || payload.name.startsWith('creation.')) {
      history.reload();
      product.reload();
    }
  });
  return (
    <section className="flex flex-col gap-6" aria-label={t`Publishing`}>
      <ProductHeading
        title={t`Review, then publish`}
      >{t`Keep your 4K master and review each platform’s delivery, copy, account and time. Publication uses your connected Postiz account after approval.`}</ProductHeading>
      {history.status === 'error' ? (
        <LoadError error={history.error} onRetry={history.reload} what={t`Videos didn’t load.`} />
      ) : null}
      {product.status === 'error' ? (
        <LoadError error={product.error} onRetry={product.reload} what={t`Product didn’t load.`} />
      ) : null}
      {history.status === 'loading' && !history.data ? <Loading /> : null}
      {!campaign && history.data ? (
        <EmptyState
          className="py-8"
          title={t`A finished video deserves a good send-off.`}
          description={t`Finish a product video to prepare its posts.`}
          action={
            <Button variant="primary" asChild icon={VERB_ICONS.makeVideo}>
              <Link
                to="/products/$productId"
                params={{ productId }}
                search={{ view: 'videos' }}
              >{t`Go to your videos`}</Link>
            </Button>
          }
        />
      ) : null}
      {campaign && product.data ? (
        <>
          <Field htmlFor="publish-campaign" label={t`Video`}>
            <Select
              id="publish-campaign"
              value={campaign.id}
              onChange={(event) => setCampaignId(event.target.value)}
            >
              {history.data?.items.map((item) => (
                <option key={item.id} value={item.id}>
                  {ideas.data?.items.find((idea) => idea.id === item.ideaId)?.title ?? t`Product video`}
                </option>
              ))}
            </Select>
          </Field>
          <CampaignPublisher
            key={campaign.id}
            campaign={campaign}
            product={product.data}
            onProductSaved={product.reload}
          />
        </>
      ) : null}
    </section>
  );
}
