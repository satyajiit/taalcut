// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · Operate · DESIGN.md: an opening hook leads ideas; real video previews lead the collection.
 * States: research, empty, error, evidence disclosure, paged videos and knowledge; one Kaatu moment at a time. */

import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
import { PRODUCT_COMMANDS, type ProductId } from '@taalcut/core';
import { Button, cn, EmptyState, Input, KaatuMoment, UserContent, VERB_ICONS } from '@taalcut/ui';
import { Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useBackend } from '../../backend/backend';
import { useCommand } from '../../backend/use-command';
import { useBackendEvents } from '../../backend/use-events';
import { useRpcQuery } from '../../backend/use-rpc';
import { Loading, LoadError } from '../settings/fields';
import { ProductHeading } from './product-layout';
import { ProductVideo } from './product-video';

const CAMPAIGN_STATUS = {
  draft: msg`Draft`,
  ready: msg`Ready to review`,
  approved: msg`Approved`,
  scheduled: msg`Scheduled`,
  published: msg`Published`,
  failed: msg`Needs attention`,
};

export function ProductIdeas({ productId }: { productId: ProductId }) {
  const { t } = useLingui();
  const backend = useBackend();
  const command = useCommand();
  const navigate = useNavigate();
  const [researching, setResearching] = useState(false);
  const ideas = useRpcQuery(
    (signal) => backend.products.ideas({ productId }, { signal }),
    [backend, productId],
  );
  useBackendEvents(['command.changed'], ({ payload }) => {
    if (payload.name.startsWith('product.')) ideas.reload();
  });
  useBackendEvents(['library.changed'], () => ideas.reload());
  return (
    <section className="flex flex-col gap-6" aria-label={t`Video ideas`}>
      <ProductHeading
        title={t`What’s worth showing next?`}
        action={
          <Button
            icon={VERB_ICONS.findSimilar}
            variant={ideas.data?.items.some((idea) => idea.status === 'suggested') ? 'secondary' : 'primary'}
            loading={researching}
            disabled={command.pending}
            onClick={async () => {
              setResearching(true);
              try {
                await command.run({ name: PRODUCT_COMMANDS.research, payload: { productId } });
                ideas.reload();
              } finally {
                setResearching(false);
              }
            }}
          >{t`Find video ideas`}</Button>
        }
      >{t`Ideas are grounded in your sources, preferences and previous videos. Choose a story to make it into your next video.`}</ProductHeading>
      {researching ? (
        <KaatuMoment tone="wait">{t`Looking through your sources for the next useful story.`}</KaatuMoment>
      ) : null}
      {ideas.status === 'loading' && !ideas.data ? <Loading /> : null}
      {ideas.status === 'error' ? (
        <LoadError error={ideas.error} onRetry={ideas.reload} what={t`Ideas didn’t load.`} />
      ) : null}
      {ideas.data?.items.filter((idea) => idea.status === 'suggested').length === 0 ? (
        <EmptyState
          className="py-8"
          kaatu={!researching}
          title={t`Your next story starts with a source.`}
          description={t`No new ideas to review. Research your sources to find the next strong story. If there’s no strong new angle, Taalcut skips a draft.`}
          action={
            <Button variant="ghost" asChild icon={VERB_ICONS.settings}>
              <Link
                to="/products/$productId"
                params={{ productId }}
                search={{ view: 'settings' }}
              >{t`Review product sources`}</Link>
            </Button>
          }
        />
      ) : null}
      {ideas.data?.items
        .filter((idea) => idea.status === 'suggested')
        .map((idea, index) => (
          <article
            key={idea.id}
            className={cn(
              'flex flex-col gap-5 border-t border-rule py-6',
              index === 0 && 'rounded-xl border-0 bg-well p-6 sm:p-8',
            )}
          >
            <div>
              <h3
                className={cn(
                  'm-0 max-w-prose text-balance text-ink',
                  index === 0 ? 'type-headline' : 'type-section',
                )}
              >
                <UserContent>{idea.hook}</UserContent>
              </h3>
              <p className="mt-3 mb-0 type-body text-ink-2">
                <UserContent>{idea.title}</UserContent>
              </p>
            </div>
            <p className="m-0 type-body text-ink-2">
              <UserContent>{idea.rationale}</UserContent>
            </p>
            <details className="type-body text-ink-2">
              <summary className="cursor-pointer rounded-sm type-label text-ink underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-focus">{t`Why this idea fits`}</summary>
              <p className="my-3">
                <UserContent>{idea.angle}</UserContent>
              </p>
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {idea.evidence.map((evidence) => (
                  <li key={`${evidence.knowledgeId}:${evidence.locator}`}>
                    <UserContent className="block type-meta text-ink-3">{evidence.locator}</UserContent>
                    <UserContent className="block">{evidence.excerpt}</UserContent>
                  </li>
                ))}
              </ul>
            </details>
            <div className="flex flex-wrap gap-2">
              <Button
                variant={index === 0 ? 'primary' : 'secondary'}
                icon={VERB_ICONS.makeVideo}
                disabled={command.pending}
                onClick={async () => {
                  const chosen = await command.run({
                    name: PRODUCT_COMMANDS.choose,
                    payload: { productId, ideaId: idea.id },
                  });
                  if (chosen.ok)
                    await navigate({
                      to: '/products/$productId',
                      params: { productId },
                      search: { view: 'videos' },
                    });
                }}
              >{t`Make this video`}</Button>
              <Button
                variant="ghost"
                disabled={command.pending}
                onClick={async () => {
                  await command.run({
                    name: PRODUCT_COMMANDS.reject,
                    payload: { productId, ideaId: idea.id, feedback: '' },
                  });
                  ideas.reload();
                }}
              >{t`Skip idea`}</Button>
            </div>
          </article>
        ))}
    </section>
  );
}

export function ProductVideos({ productId }: { productId: ProductId }) {
  const { t, i18n } = useLingui();
  const backend = useBackend();
  const [pages, setPages] = useState<string[]>([]);
  const before = pages.at(-1);
  const history = useRpcQuery(
    (signal) => backend.products.history({ productId, ...(before ? { before } : {}), limit: 50 }, { signal }),
    [backend, productId, before],
  );
  const ideas = useRpcQuery(
    (signal) => backend.products.ideas({ productId }, { signal }),
    [backend, productId],
  );
  useBackendEvents(['command.changed'], ({ payload }) => {
    if (payload.name.startsWith('product.') || payload.name.startsWith('creation.')) history.reload();
  });
  useBackendEvents(['library.changed'], () => history.reload());
  return (
    <section className="flex flex-col gap-4" aria-label={t`Product videos`}>
      <ProductHeading
        title={t`Your product videos`}
      >{t`Pick up a draft or revisit a finished story. Every video helps shape what comes next.`}</ProductHeading>
      {history.status === 'loading' && !history.data ? <Loading /> : null}
      {history.status === 'error' ? (
        <LoadError error={history.error} onRetry={history.reload} what={t`Video history didn’t load.`} />
      ) : null}
      {history.data?.items.length === 0 ? (
        <EmptyState
          className="py-8"
          title={t`Make the first story yours.`}
          description={t`Choose an idea to start your first product video.`}
          action={
            <Button asChild variant="primary" icon={VERB_ICONS.findSimilar}>
              <Link
                to="/products/$productId"
                params={{ productId }}
                search={{ view: 'ideas' }}
              >{t`Explore video ideas`}</Link>
            </Button>
          }
        />
      ) : null}
      <div className="grid min-w-0 gap-x-6 gap-y-9 lg:grid-cols-2">
        {history.data?.items.map((campaign, index) => (
          <ProductVideo
            key={campaign.id}
            campaign={campaign}
            title={ideas.data?.items.find((idea) => idea.id === campaign.ideaId)?.title ?? t`Product video`}
            status={i18n._(CAMPAIGN_STATUS[campaign.status])}
            featured={index === 0}
          />
        ))}
      </div>
      <div className="flex gap-3">
        {pages.length ? (
          <Button
            variant="ghost"
            onClick={() => setPages((value) => value.slice(0, -1))}
          >{t`Newer videos`}</Button>
        ) : null}
        {history.data?.items.length === 50 ? (
          <Button
            variant="ghost"
            onClick={() => setPages((value) => [...value, history.data!.items.at(-1)!.id])}
          >{t`Older videos`}</Button>
        ) : null}
      </div>
    </section>
  );
}

export function ProductKnowledgeView({ productId }: { productId: ProductId }) {
  const { t, i18n } = useLingui();
  const backend = useBackend();
  const [query, setQuery] = useState('');
  const [pages, setPages] = useState<string[]>([]);
  const after = pages.at(-1);
  const knowledge = useRpcQuery(
    (signal) =>
      backend.products.knowledge({ productId, query, ...(after ? { after } : {}), limit: 50 }, { signal }),
    [backend, productId, query, after],
  );
  return (
    <section className="flex flex-col gap-4" aria-label={t`Product knowledge`}>
      <ProductHeading
        title={t`The sources behind your stories`}
      >{t`Evidence belongs to this product and is available across its videos and chats. Research refreshes changed sources.`}</ProductHeading>
      <Input
        aria-label={t`Search product knowledge`}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setPages([]);
        }}
      />
      {knowledge.status === 'loading' && !knowledge.data ? <Loading /> : null}
      {knowledge.status === 'error' ? (
        <LoadError
          error={knowledge.error}
          onRetry={knowledge.reload}
          what={t`Product knowledge didn’t load.`}
        />
      ) : null}
      {knowledge.data?.items.length === 0 ? (
        <EmptyState
          className="py-6"
          title={query ? t`No matching knowledge` : t`A shared memory for every video`}
          description={
            query
              ? t`Try a different search to find evidence in this product’s sources.`
              : t`Research your sources to build the product’s knowledge.`
          }
        />
      ) : null}
      {knowledge.data?.items.map((item) => (
        <details key={item.id} className="border-b border-rule py-5">
          <summary className="cursor-pointer rounded-sm type-label text-ink focus-visible:outline-2 focus-visible:outline-focus">
            <UserContent>{item.title}</UserContent>
          </summary>
          <UserContent className="mt-2 block break-all type-meta text-ink-3">{item.locator}</UserContent>
          <time className="type-meta text-ink-3" dateTime={new Date(item.capturedAt).toISOString()}>
            {i18n.date(item.capturedAt, { dateStyle: 'medium', timeStyle: 'short' })}
          </time>
          <p className="mb-0 whitespace-pre-wrap type-body text-ink-2">
            <UserContent>{item.text}</UserContent>
          </p>
        </details>
      ))}
      <div className="flex gap-3">
        {pages.length ? (
          <Button
            variant="ghost"
            onClick={() => setPages((value) => value.slice(0, -1))}
          >{t`Previous sources`}</Button>
        ) : null}
        {knowledge.data?.nextCursor ? (
          <Button
            variant="ghost"
            onClick={() => setPages((value) => [...value, knowledge.data!.nextCursor!])}
          >{t`More sources`}</Button>
        ) : null}
      </div>
    </section>
  );
}
